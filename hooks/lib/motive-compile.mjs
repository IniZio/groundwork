/**
 * motive-compile.mjs — Pure versioned fold: ordered event array → compiled spec view.
 *
 * PURITY CONTRACT (grep-enforced by test S2-AC3):
 *   - Zero import/require statements in this file.
 *   - No node:fs, node:child_process, Date.now(), new Date(), Math.random(), process.*
 *   - The fold is a pure function of its inputs; callers inject all I/O.
 *
 * FIELD CONTRACT (S2-AC4 / F2):
 *   Hook-written fields this fold reads (verified against real emitters in hooks/):
 *     TASK_COMPLETE  d.slice             — hooks/ledger.mjs emits { slice }
 *     GATE           d.which, d.verdict  — hooks/ledger.mjs emits { which, verdict }
 *                    d.citation, d.rubric — optional; model-written via gate object
 *     SPEC_DRIFT     d.kind, d.path, d.spec_ref, d.rfc_uid, d.detail
 *                                         — hooks/spec-guard.mjs emits { kind, path, rfc_uid }
 *     FAILURE        d.fingerprint, d.kind, d.cmd, d.target, d.count, d.attempts,
 *                    d.last_error, d.slice — hooks/struggle-detector.mjs emits
 *                                           { kind, fingerprint, cmd, count }
 *     SESSION_END    d.outcome, d.reason, d.gate — hooks/stop-gate.mjs emits { outcome }
 *     SESSION_START  d.resumed_from      — hook-written; may be absent
 *     AC_COVERAGE    coverage form: d.ac, d.slice — hooks/ledger.mjs emits per (slice, AC) pair
 *                    declaration form: d.ac, d.covering:[] — hooks/migrate.mjs emits for
 *                                      ACs declared with empty covering arrays (unmet-empty)
 *   Model-written / optional (may be entirely absent; fold degrades honestly):
 *     DECISION       d.decision, d.rationale, d.alternatives, d.slice
 *                    decision_log[].slices built from: (a) DECISION data.slice and
 *                    (b) reverse index of groundTruth.ledger.slices[].decisions; union deduped.
 *     HANDOFF        d.pointer, d.summary, d.next_actions  (legacy — kept for back-compat)
 *     PAUSE          d.pointer, d.summary, d.next_actions  (supersedes HANDOFF)
 *     VERIFICATION   d.claim, d.evidence, d.result
 *     MILESTONE      d.objective
 *     SPEC_CHANGE    d.spec_ref, d.change, d.reason
 *     LINT_DRIFT     d.kind, d.path, d.spec_ref, d.detail
 *     PROTOTYPE_RESULT d.claim, d.evidence, d.result
 *     WAIVER         (full d spread)
 *   FAILURE events read ev.msg (top-level) — recorded as the narrative text for the
 *   Trouble section; absent from most hook-only events so degrades to null gracefully.
 *
 * USAGE:
 *   compile(events, opts?) -> view
 *
 *   events  — motive-filtered, sorted array produced by readOrderedEvents
 *             (journal-order.mjs assigns _order.{shard,line}; ord is derived here)
 *   opts.at — positive integer: fold only events[0..at-1] (truncation equivalence)
 *   opts.groundTruth — injected from collectGroundTruth (motive-ground-truth.mjs); omit for
 *             --no-ground-truth mode (divergence_checked:false)
 *   opts.malformedLines — count from the reader; default 0
 */

export const COMPILER_VERSION = 'motive-compile/1.4.0'

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 }

/**
 * compile(events, opts) — pure versioned fold.
 * Returns { compiler_version, agent, human, provenance, divergence }.
 */
export function compile(events, opts = {}) {
  const at = opts.at != null ? Math.floor(opts.at) : null
  const stream = at != null ? events.slice(0, at) : events

  // Assign per-motive ordinals (1..N) after truncation
  const ordered = stream.map((e, i) => Object.assign({}, e, { ord: i + 1 }))

  // ── fold state ────────────────────────────────────────────────────────────
  const sessions = []
  // Map<id, {ord, ts}>
  const completedSlices = new Map()
  // Map<compositeKey, {ord, ts}> — composite key is `${session_id}::${sliceId}` when session known
  const completedSlicesComposite = new Map()
  // Map<which, record>
  const gates = new Map()
  const drift = []
  // Map<fingerprint, record>  — highest ord per fingerprint wins
  const failuresMap = new Map()
  const decisions = []
  // Map<id, decision record> — keyed ADR decisions (id present)
  const decisionLogMap = new Map()
  // Map<decisionId, Set<sliceId>> — slice refs from DECISION data.slice (source a)
  const decisionSliceFromEvent = new Map()
  // insertion order for decision_log output
  const decisionLogOrder = []
  // Map<id, number> — count of same-id merge hits (second+ event for a keyed id)
  const decisionMergeHits = new Map()
  // Set<id> — ids for which at least one merge event carried revises === id
  const decisionRevisesMarked = new Set()
  // Set of decision ids that resolved an open item (accepted only)
  const resolvedByDecisions = new Map() // resolves-id → decision-id
  let lastHandoff = null
  let lastPause = null
  const verifications = []
  const milestones = []
  const specChanges = []
  const waivers = []
  const baselines = []
  // Map<ac_key, Set<sliceId>> — built from AC_COVERAGE events
  const acCoverageMap = new Map()

  let objective = null
  let objectiveSource = 'absent'
  let modelWrittenCount = 0
  let unknownTypeEvents = 0

  for (const ev of ordered) {
    const { ord, ts } = ev
    const session_id = ev.session ?? null
    const type = ev.type
    const d = ev.data ?? {}

    switch (type) {
      case 'SESSION_START': {
        const rec = { ord, ts, session_id, event: 'start' }
        if (d.resumed_from != null) rec.resumed_from = d.resumed_from
        sessions.push(rec)
        break
      }

      case 'TASK_COMPLETE': {
        // d.slice — hooks/ledger.mjs emits { slice }. No wave, no paths (F2/D1).
        completedSlices.set(d.slice, { ord, ts })
        if (session_id != null && d.slice != null) {
          completedSlicesComposite.set(`${session_id}::${String(d.slice)}`, { ord, ts })
        }
        break
      }

      case 'GATE': {
        // d.which, d.verdict — hooks/ledger.mjs; d.citation, d.rubric optional.
        const rec = { ord, ts, which: d.which, verdict: d.verdict }
        if (d.citation != null) rec.citation = d.citation
        if (d.rubric != null) rec.rubric = d.rubric
        gates.set(d.which, rec)
        break
      }

      case 'SPEC_DRIFT': {
        // d.spec_ref ?? d.rfc_uid — spec-guard writes rfc_uid; CLI append writes spec_ref
        drift.push({
          ord,
          kind: d.kind ?? 'spec',
          path: d.path ?? null,
          spec_ref: d.spec_ref ?? d.rfc_uid ?? null,
          detail: d.detail ?? null,
          resolved: false, // resolved in post-pass below
        })
        break
      }

      case 'FAILURE': {
        // Highest ord per fingerprint wins (struggle-detector re-emits as count climbs).
        // d.cmd ?? d.target — struggle-detector writes cmd; other emitters may write target.
        // d.count ?? d.attempts — struggle-detector writes count.
        const fp = d.fingerprint
        const existing = failuresMap.get(fp)
        if (!existing || ord > existing.ord) {
          failuresMap.set(fp, {
            ord,
            kind: d.kind ?? null,
            fingerprint: fp,
            target: d.cmd ?? d.target ?? null,
            attempts: d.count ?? d.attempts ?? null,
            last_error: d.last_error ?? null,
            msg: ev.msg ?? null,
            slice: d.slice ?? null,
            resolved: false, // resolved in post-pass below
          })
        }
        break
      }

      case 'SESSION_END': {
        // d.outcome ?? d.reason — stop-gate writes outcome
        const rec = { ord, ts, session_id, event: 'end', outcome: d.outcome ?? d.reason ?? null }
        if (d.gate != null) rec.gate = d.gate
        sessions.push(rec)
        break
      }

      case 'DECISION': {
        modelWrittenCount++
        if (d.id != null) {
          // ADR lifecycle: keyed by id; first-seen order preserved
          const existing = decisionLogMap.get(d.id)
          if (existing == null) {
            // First appearance — create the entry
            const entry = {
              id: d.id,
              status: d.status ?? 'proposed',
              title: d.title ?? d.decision ?? null,
              decision: d.decision ?? null,
              rationale: d.rationale ?? null,
              alternatives: Array.isArray(d.alternatives) ? d.alternatives : [],
              ord,
              ts,
              supersedes: d.supersedes ?? null,
              superseded_by: d.superseded_by ?? null,
              resolves: d.resolves ?? null,
            }
            decisionLogMap.set(d.id, entry)
            decisionLogOrder.push(d.id)
            // If this event supersedes another, mark that one superseded
            if (d.supersedes != null) {
              const target = decisionLogMap.get(d.supersedes)
              if (target != null) {
                target.status = 'superseded'
                target.superseded_by = d.id
              }
            }
            // data.retires is the authoring vocabulary for retraction (D-36).
            // Compile: mark the retired decision superseded/retired by this one.
            if (d.retires != null) {
              entry.retires = d.retires
              const target = decisionLogMap.get(d.retires)
              if (target != null) {
                target.status = 'superseded'
                target.superseded_by = d.id
              }
            }
          } else {
            // Update existing entry's status (and other optional fields)
            if (d.status != null) existing.status = d.status
            if (d.title != null) existing.title = d.title
            else if (d.decision != null) existing.title = d.decision
            if (d.decision != null) existing.decision = d.decision
            if (d.rationale != null) existing.rationale = d.rationale
            if (Array.isArray(d.alternatives)) existing.alternatives = d.alternatives
            if (d.superseded_by != null) existing.superseded_by = d.superseded_by
            if (d.resolves != null) existing.resolves = d.resolves
            // Change B: track same-id merges; revises === id marks the merge intentional
            decisionMergeHits.set(d.id, (decisionMergeHits.get(d.id) ?? 0) + 1)
            if (d.revises === d.id) {
              decisionRevisesMarked.add(d.id)
              existing.revises = d.revises
            }
            if (d.supersedes != null) {
              existing.supersedes = d.supersedes
              const target = decisionLogMap.get(d.supersedes)
              if (target != null) {
                target.status = 'superseded'
                target.superseded_by = d.id
              }
            }
            if (d.retires != null) {
              existing.retires = d.retires
              const target = decisionLogMap.get(d.retires)
              if (target != null) {
                target.status = 'superseded'
                target.superseded_by = d.id
              }
            }
          }
          // Track slice from data.slice (source a of the decision→slice join)
          if (d.slice != null) {
            if (!decisionSliceFromEvent.has(d.id)) decisionSliceFromEvent.set(d.id, new Set())
            decisionSliceFromEvent.get(d.id).add(String(d.slice))
          }
          // Track accepted resolves for open-item burn-down
          const entry = decisionLogMap.get(d.id)
          if (entry.status === 'accepted' && entry.resolves != null) {
            resolvedByDecisions.set(entry.resolves, d.id)
          } else if (entry.status !== 'accepted' && entry.resolves != null) {
            // Remove previous resolution if status downgraded (e.g. rejected)
            if (resolvedByDecisions.get(entry.resolves) === d.id) {
              resolvedByDecisions.delete(entry.resolves)
            }
          }
        } else {
          // Legacy DECISION with no id — keep in agent.decisions unchanged
          decisions.push({
            decision: d.decision ?? null,
            rationale: d.rationale ?? null,
            rationale_source: d.rationale != null ? 'recorded' : 'absent',
            alternatives: Array.isArray(d.alternatives) ? d.alternatives : [],
            slice: d.slice ?? null,
          })
        }
        break
      }

      case 'HANDOFF': {
        modelWrittenCount++
        lastHandoff = {
          pointer: d.pointer ?? null,
          summary: d.summary ?? null,
          next_actions: Array.isArray(d.next_actions) ? d.next_actions : [],
        }
        break
      }

      case 'PAUSE': {
        modelWrittenCount++
        lastPause = {
          pointer: d.pointer ?? null,
          summary: d.summary ?? null,
          next_actions: Array.isArray(d.next_actions) ? d.next_actions : [],
        }
        break
      }

      case 'VERIFICATION': {
        modelWrittenCount++
        verifications.push({ claim: d.claim ?? null, evidence: d.evidence ?? null, result: d.result ?? null })
        break
      }

      case 'MILESTONE': {
        modelWrittenCount++
        milestones.push({ ord, ts, objective: d.objective ?? null })
        // Only set objective from MILESTONE if not already set by MOTIVE_CREATED (S2-AC5)
        if (objectiveSource !== 'charter' && objective === null && d.objective != null) {
          objective = d.objective
          objectiveSource = 'recorded:MILESTONE'
        }
        break
      }

      case 'SPEC_CHANGE': {
        modelWrittenCount++
        specChanges.push({ spec_ref: d.spec_ref ?? null, change: d.change ?? null, reason: d.reason ?? null })
        break
      }

      case 'LINT_DRIFT': {
        drift.push({
          ord,
          kind: 'lint',
          path: d.path ?? null,
          spec_ref: d.spec_ref ?? null,
          detail: d.detail ?? null,
          resolved: false,
        })
        break
      }

      case 'PROTOTYPE_RESULT': {
        verifications.push({
          claim: d.claim ?? null,
          evidence: d.evidence ?? null,
          result: d.result ?? null,
          result_kind: 'prototype',
        })
        break
      }

      case 'WAIVER': {
        waivers.push({ ord, ts, ...d })
        break
      }

      case 'MOTIVE_CREATED': {
        // Highest-precedence objective source (S2-AC5)
        if (d.objective != null) {
          objective = d.objective
          objectiveSource = 'charter'
        }
        break
      }

      case 'BASELINE': {
        baselines.push({
          name: d.name ?? null,
          ord,
          ts,
          shard: ev._order?.shard ?? null,
          line: ev._order?.line ?? null,
        })
        break
      }

      case 'AC_COVERAGE': {
        // Three payload forms:
        //   Single-AC form:   { ac, slice }              — registers slice as covering the AC
        //   Array-covers form:{ slice, covers: ['AC-1'] } — registers slice as covering each listed AC
        //   Declaration form: { ac, covering: [] }        — declares AC with no covering slices
        //                     (slice absent/null)  so it appears as unmet in the view
        //
        // Store composite "${session_id}::${sliceId}" when session is known so the
        // completion check is session-scoped (fixes STATUS-SEAM bug, D-12).
        // Falls back to bare slice id for legacy events without a session field.
        const sliceCompositeId = d.slice != null
          ? (session_id != null ? `${session_id}::${String(d.slice)}` : String(d.slice))
          : null
        if (d.ac != null) {
          const key = String(d.ac)
          if (!acCoverageMap.has(key)) acCoverageMap.set(key, new Set())
          if (sliceCompositeId != null) acCoverageMap.get(key).add(sliceCompositeId)
        }
        // Array covers form: { slice, covers: ['AC-1', 'AC-2'] }
        if (Array.isArray(d.covers) && sliceCompositeId != null) {
          for (const ac of d.covers) {
            if (ac != null) {
              const key = String(ac)
              if (!acCoverageMap.has(key)) acCoverageMap.set(key, new Set())
              acCoverageMap.get(key).add(sliceCompositeId)
            }
          }
        }
        break
      }

      default: {
        unknownTypeEvents++
        break
      }
    }
  }

  // ── post-pass: resolve drift and failures ─────────────────────────────────
  const resolvedSpecRefs = new Set(specChanges.map((sc) => sc.spec_ref).filter(Boolean))
  const resolvedDrift = drift.map((dr) => ({
    ...dr,
    resolved: dr.resolved || resolvedSpecRefs.has(dr.spec_ref),
  }))

  const failuresList = [...failuresMap.values()].map((f) => ({
    ...f,
    resolved: f.slice != null && completedSlices.has(f.slice),
  }))

  // ── gates ─────────────────────────────────────────────────────────────────
  // last_gate = advisor entry, or highest-ord entry if absent
  let lastGate = gates.get('advisor') ?? null
  if (!lastGate && gates.size > 0) {
    lastGate = [...gates.values()].reduce((a, b) => (a.ord > b.ord ? a : b))
  }

  // ── ground truth injection ────────────────────────────────────────────────
  const groundTruth = opts.groundTruth ?? null
  const ledger = groundTruth?.ledger ?? null
  const _rawSlices = ledger?.found && Array.isArray(ledger.slices) ? ledger.slices : []
  // When motive sessions are unioned, _rawSlices may contain multiple entries
  // with the same slice id (one per session, each tagged with _session_id).
  // Deduplicate by id here so that:
  //   • Totals (all_slices / open_slices counts) are not inflated.
  //   • A slice completed in ANY session counts as complete in the merged view
  //     (status 'complete' takes priority; other statuses use most-recent-file order
  //     which is preserved by the union algorithm).
  // Note: openSlices/divergence checks below all use this deduped view, so a slice
  // that was completed in an earlier session is never reported as open or mismatched.
  const _sliceDedup = new Map()
  for (const s of _rawSlices) {
    const cur = _sliceDedup.get(s.id)
    // 'complete' wins over any other status; otherwise last-write (insertion order) wins
    if (!cur || s.status === 'complete') _sliceDedup.set(s.id, s)
  }
  const allSlices = [..._sliceDedup.values()]

  // ── open / blocked slices ─────────────────────────────────────────────────
  const completedIds = new Set(completedSlices.keys())
  // TBD-26: a slice is "open" only when ALL three conditions hold:
  //   1. not completed in the fold (no TASK_COMPLETE event in completedIds)
  //   2. not marked complete in the ledger (s.status !== 'complete') — handles
  //      cases where TASK_COMPLETE was emitted under a synthetic motive so it
  //      missed the fold but the ledger was updated correctly; divergence check
  //      still fires the slice_state_mismatch finding independently
  //   3. not from a retired run (_retired:true from readLedger) — retired runs
  //      (active===false, or APPROVE with all slices complete) must never
  //      resurface actionable work
  const openSlices = allSlices.filter(
    (s) => !completedIds.has(s.id) && s.status !== 'complete' && s._retired !== true,
  )
  const readySlices = openSlices.filter((s) => {
    const blockers = Array.isArray(s.blocked_by) ? s.blocked_by : []
    return blockers.every((bid) => completedIds.has(bid))
  })
  const blockedSlices = openSlices.filter((s) => {
    const blockers = Array.isArray(s.blocked_by) ? s.blocked_by : []
    return blockers.length > 0 && !blockers.every((bid) => completedIds.has(bid))
  })

  // ── decision_log ──────────────────────────────────────────────────────────
  // Source (b): reverse index — slices[].decisions → decision id
  const decisionSliceFromLedger = new Map()
  for (const s of allSlices) {
    const decs = s.decisions == null ? [] : Array.isArray(s.decisions) ? s.decisions : [s.decisions]
    for (const did of decs) {
      if (!decisionSliceFromLedger.has(did)) decisionSliceFromLedger.set(did, new Set())
      decisionSliceFromLedger.get(did).add(s.id)
    }
  }

  const decisionLog = decisionLogOrder.map((id) => {
    const entry = decisionLogMap.get(id)
    // Union (a) DECISION data.slice + (b) ledger reverse index, deduped by slice id
    const sliceIdSet = new Set([
      ...(decisionSliceFromEvent.get(id) ?? []),
      ...(decisionSliceFromLedger.get(id) ?? []),
    ])
    const slices = [...sliceIdSet].sort().map((sid) => {
      const s = _sliceDedup.get(sid)
      return { id: sid, status: s?.status ?? 'pending' }
    })
    const isMerged = (decisionMergeHits.get(id) ?? 0) > 0
    const result = { ...entry, slices }
    // Change B: flag unmarked same-id collisions (merges where no event declared revises === id)
    if (isMerged && !decisionRevisesMarked.has(id)) result.unmarked_collision = true
    return result
  })

  // ── open items burn-down ──────────────────────────────────────────────────
  let openItems = []
  let openItemsSummary = { total: 0, open: 0, resolved: 0 }
  let openItemsSource = null

  const charter = opts.charter ?? null
  if (charter != null && Array.isArray(charter.open_items)) {
    openItemsSource = 'charter'
    openItems = charter.open_items.map((item) => {
      const resolvedBy = resolvedByDecisions.get(item.id) ?? null
      return {
        id: item.id,
        kind: item.kind ?? null,
        statement: item.statement ?? null,
        body: item.body ?? null,
        owner: item.owner ?? null,
        blocked_by: item.blocked_by ?? null,
        resolved_by: resolvedBy,
        graduated_to: item.graduated_to ?? null,
      }
    })
    const resolved = openItems.filter((i) => i.resolved_by != null).length
    openItemsSummary = { total: openItems.length, open: openItems.length - resolved, resolved }
  }

  // ── objective ─────────────────────────────────────────────────────────────
  if (objectiveSource === 'absent' && groundTruth?.ledger?.found) {
    // Reconstruct from ledger: use the first slice desc as a proxy label.
    const desc = allSlices[0]?.desc ?? null
    if (desc != null) {
      objective = desc
      objectiveSource = 'reconstructed:ledger-desc'
    }
  }

  // ── confidence: computed from census, never hard-coded ───────────────────
  let confidence
  const confidenceNotes = []
  if (modelWrittenCount === 0) {
    confidence = 'hook-only'
    confidenceNotes.push(
      'No model-written events (DECISION, HANDOFF, VERIFICATION, MILESTONE, SPEC_CHANGE) ' +
        'are present; rationale for every decision is absent and confidence is hook-only.',
    )
  } else if (decisions.length > 0 && decisions.some((d) => d.rationale_source === 'recorded')) {
    confidence = 'recorded'
  } else {
    confidence = 'partial'
    if (decisions.length > 0 && decisions.every((d) => d.rationale_source === 'absent')) {
      confidenceNotes.push('DECISION events are present but none carry a rationale.')
    }
  }

  // ── shared completeness predicate ────────────────────────────────────────
  // session_completed_ids supplements completedIds with TASK_COMPLETE events
  // that were emitted before the ledger's motive field was set (so they carry
  // a synthetic motive and are absent from the motive-filtered fold stream).
  // Used by both the divergence check and ac_coverage to keep one notion of
  // "complete" across the entire compile() output.
  const sessionCompleted = Array.isArray(groundTruth?.session_completed_ids)
    ? new Set(groundTruth.session_completed_ids)
    : null
  /** @param {string} id */
  const isComplete = (id) => completedIds.has(id) || (sessionCompleted?.has(id) ?? false)
  // For acCoverage: a slice is "done" if the fold, session stream, OR the ledger says so.
  // The divergence check still uses isComplete (fold-only) to detect fold↔ledger mismatches.
  const ledgerCompleteIds = new Set(allSlices.filter((s) => s.status === 'complete').map((s) => s.id))
  /** @param {string} id */
  const isCompleteAnywhere = (id) => isComplete(id) || ledgerCompleteIds.has(id)

  // Session-scoped composite completion check (fixes STATUS-SEAM bug, D-12).
  // _rawSlices have _session_id from motive-ground-truth.mjs:319.
  const ledgerCompleteCompositeIds = new Set(
    _rawSlices
      .filter((s) => s.status === 'complete' && s.id != null)
      .map((s) => {
        const sid = s._session_id
        return sid ? `${sid}::${String(s.id)}` : String(s.id)
      })
  )
  /** @param {string} id — may be composite ("session::slice") or bare */
  const isCompleteAnywhereComposite = (id) => {
    // Composite id: check composite maps only (session-scoped).
    if (id.includes('::')) {
      return completedSlicesComposite.has(id) || ledgerCompleteCompositeIds.has(id)
    }
    // Bare id (legacy event without session field): fall back to bare check.
    return isCompleteAnywhere(id)
  }

  // ── divergence: pure function of injected data ────────────────────────────
  let divergence
  if (groundTruth == null) {
    divergence = { checked: false, findings: [], banner: 'NOT CHECKED' }
  } else {
    const findings = []

    for (const s of allSlices) {
      const foldComplete = isComplete(s.id)
      const ledgerComplete = s.status === 'complete'
      if (foldComplete && !ledgerComplete) {
        findings.push({
          severity: 'high',
          kind: 'slice_state_mismatch',
          id: s.id,
          detail: `fold says complete but ledger says ${s.status}`,
        })
      } else if (!foldComplete && ledgerComplete) {
        findings.push({
          severity: 'high',
          kind: 'slice_state_mismatch',
          id: s.id,
          detail: 'ledger says complete but no TASK_COMPLETE in stream',
        })
      }
    }

    // gate_mismatch (high)
    if (lastGate && ledger?.found && ledger.gate != null) {
      const la = ledger.gate.advisor
      const ledgerVerdict = la != null
        ? (typeof la === 'string' ? la : la?.verdict ?? null)
        : null
      if (ledgerVerdict != null && lastGate.verdict !== ledgerVerdict) {
        findings.push({
          severity: 'high',
          kind: 'gate_mismatch',
          detail: `fold says ${lastGate.verdict} but ledger says ${ledgerVerdict}`,
        })
      }
    }

    // no_ledger (medium)
    if (!ledger?.found) {
      findings.push({
        severity: 'medium',
        kind: 'no_ledger',
        detail: 'events exist for this motive but no ledger was found',
      })
    }

    // Sort: severity → kind → path/id
    findings.sort((a, b) => {
      const sa = SEVERITY_ORDER[a.severity] ?? 99
      const sb = SEVERITY_ORDER[b.severity] ?? 99
      if (sa !== sb) return sa - sb
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1
      const pa = a.path ?? a.id ?? ''
      const pb = b.path ?? b.id ?? ''
      return pa < pb ? -1 : pa > pb ? 1 : 0
    })

    const hasHigh = findings.some((f) => f.severity === 'high')
    const banner =
      findings.length === 0 ? '✓ No divergence' : hasHigh ? '⚠ DIVERGENCE' : '⚠ divergence'
    divergence = { checked: true, findings, banner }
  }

  // ── resume.next_actions ───────────────────────────────────────────────────
  const byWaveThenId = (a, b) =>
    (a.wave ?? 0) - (b.wave ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  const nextActions = []
  for (const s of [...readySlices].sort(byWaveThenId)) {
    nextActions.push({
      action: 'implement_slice',
      slice: s.id,
      wave: s.wave ?? null,
      desc: s.desc ?? null,
      acceptance: s.acceptance ?? null,
      why: 'open slice with no incomplete blockers',
    })
  }
  for (const f of failuresList.filter((f) => !f.resolved)) {
    nextActions.push({
      action: 'resolve_failure',
      fingerprint: f.fingerprint,
      target: f.target,
      attempts: f.attempts,
      last_error: f.last_error,
      why: 'aggregated failure never followed by a completion',
    })
  }
  for (const dr of resolvedDrift.filter((d) => !d.resolved)) {
    nextActions.push({
      action: 'reconcile_spec_drift',
      path: dr.path,
      spec_ref: dr.spec_ref,
      why: 'SPEC_DRIFT recorded, no later SPEC_CHANGE naming this spec_ref',
    })
  }
  for (const s of [...blockedSlices].sort(byWaveThenId)) {
    nextActions.push({
      action: 'unblock_slice',
      slice: s.id,
      blocked_by: Array.isArray(s.blocked_by) ? s.blocked_by : [],
      why: 'blocked; listed so resume sees the whole graph',
    })
  }
  // Only prompt for the advisor gate when there are non-retired slices — a run
  // whose slices are all _retired (already APPROVE-gated or deactivated) does
  // not need another gate pass.
  const nonRetiredSlices = allSlices.filter((s) => s._retired !== true)
  if (
    openSlices.length === 0 &&
    nonRetiredSlices.length > 0 &&
    (!lastGate || lastGate.verdict !== 'APPROVE')
  ) {
    nextActions.push({ action: 'run_advisor_gate', why: 'all slices complete but no APPROVE gate recorded' })
  }

  // ── Fold PAUSE / HANDOFF explicit next_actions (PAUSE takes precedence) ──
  // Human-authored continuation intent leads; ledger-derived actions follow.
  const explicitActions =
    lastPause != null && lastPause.next_actions.length > 0
      ? lastPause.next_actions
      : lastHandoff != null && lastHandoff.next_actions.length > 0
        ? lastHandoff.next_actions
        : []
  if (explicitActions.length > 0) {
    nextActions.unshift(...explicitActions)
  }

  // ── ac_coverage ───────────────────────────────────────────────────────────
  // AC coverage semantics:
  //   met     = covering non-empty AND every listed slice in completedSlices
  //   unmet   = absent | empty | any incomplete covering slice (and ledger found)
  //   unknown = covering non-empty but no ledger to verify completion status

  // Seed from charter-declared ACs so they appear as unmet even with no events
  if (charter != null && Array.isArray(charter.acceptance_criteria)) {
    for (const ac of charter.acceptance_criteria) {
      if (ac != null && ac.id != null && !acCoverageMap.has(String(ac.id))) {
        acCoverageMap.set(String(ac.id), new Set())
      }
    }
  }

  const ledgerFound = groundTruth?.ledger?.found ?? false
  const acMet = []
  const acUnmet = []
  const acKeys = [...acCoverageMap.keys()].sort((a, b) => {
    const na = parseInt(a.replace(/^AC/, ''), 10)
    const nb = parseInt(b.replace(/^AC/, ''), 10)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    return a < b ? -1 : a > b ? 1 : 0
  })
  // Project composite ids back to bare ids for output (MUST NOT leak composite
  // keys into the view — output format is stable bare ids).
  const toBare = (id) => {
    const sep = id.indexOf('::')
    return sep === -1 ? id : id.slice(sep + 2)
  }
  for (const key of acKeys) {
    const coveringComposite = [...acCoverageMap.get(key)]
    // Output: deduplicated bare ids (composite projection).
    const covering = [...new Set(coveringComposite.map(toBare))]
    // Completion check: session-scoped via composite ids.
    const missingComposite = coveringComposite.filter((s) => !isCompleteAnywhereComposite(s))
    const missing = [...new Set(missingComposite.map(toBare))]
    const isMet = covering.length > 0 && missing.length === 0
    // status_unknown: covering exists but no ledger to verify completion
    const statusUnknown = !ledgerFound && covering.length > 0 && !isMet
    const entry = { id: key, covering, missing, met: isMet, status_unknown: statusUnknown }
    if (isMet) acMet.push(entry)
    else acUnmet.push(entry)
  }
  const acCoverage = { met: acMet, unmet: acUnmet }

  // ── provenance ────────────────────────────────────────────────────────────
  const atOrd = ordered.length > 0 ? ordered.length : 0
  const lastEvent = ordered.length > 0 ? ordered[ordered.length - 1] : null
  const atMarker = lastEvent
    ? {
        ts: lastEvent.ts,
        shard: lastEvent._order?.shard ?? null,
        line: lastEvent._order?.line ?? null,
      }
    : null

  const provenance = {
    compiler_version: COMPILER_VERSION,
    at_ord: atOrd,
    at_marker: atMarker,
    events_folded: ordered.length,
    malformed_lines: opts.malformedLines ?? 0,
    unknown_type_events: unknownTypeEvents,
  }

  if (groundTruth != null) {
    provenance.ground_truth = {
      head_sha: groundTruth.head_sha ?? null,
      branch: groundTruth.branch ?? null,
      dirty_paths: groundTruth.dirty_paths ?? [],
      existing_paths: groundTruth.existing_paths ?? {},
    }
    provenance.collected_at = groundTruth.collected_at ?? null
  }

  // ── agent layer ───────────────────────────────────────────────────────────
  const agent = {
    objective,
    objective_source: objectiveSource,
    decision_log: decisionLog,
    baselines,
    open_items: openItems,
    open_items_summary: openItemsSummary,
    open_items_source: openItemsSource,
    all_slices: allSlices,
    open_slices: openSlices.map((s) => ({
      ...s,
      ready: readySlices.includes(s),
    })),
    blocked: blockedSlices,
    last_gate: lastGate,
    gates: Object.fromEntries(gates),
    failures: failuresList,
    drift: resolvedDrift,
    waivers,
    resume: { next_actions: nextActions },
    confidence,
    confidence_notes: confidenceNotes,
    sessions,
    decisions,
    last_handoff: lastHandoff,
    last_pause: lastPause,
    verifications,
    milestones,
    spec_changes: specChanges,
    ac_coverage: acCoverage,
  }

  return {
    compiler_version: COMPILER_VERSION,
    agent,
    human: null, // populated by motive-render.mjs (S4)
    provenance,
    divergence,
  }
}
