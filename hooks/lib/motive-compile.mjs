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
 *   Model-written / optional (may be entirely absent; fold degrades honestly):
 *     DECISION       d.decision, d.rationale, d.alternatives, d.slice
 *     HANDOFF        d.pointer, d.summary, d.next_actions
 *     VERIFICATION   d.claim, d.evidence, d.result
 *     MILESTONE      d.objective
 *     SPEC_CHANGE    d.spec_ref, d.change, d.reason
 *     LINT_DRIFT     d.kind, d.path, d.spec_ref, d.detail
 *     PROTOTYPE_RESULT d.claim, d.evidence, d.result
 *     WAIVER         (full d spread)
 *   No field reads d.msg (F4: msg is absent from hook-only events; purity not affected).
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

export const COMPILER_VERSION = 'motive-compile/1.0.0'

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
  // Map<which, record>
  const gates = new Map()
  const drift = []
  // Map<fingerprint, record>  — highest ord per fingerprint wins
  const failuresMap = new Map()
  const decisions = []
  let lastHandoff = null
  const verifications = []
  const milestones = []
  const specChanges = []
  const waivers = []

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
        decisions.push({
          decision: d.decision ?? null,
          rationale: d.rationale ?? null,
          rationale_source: d.rationale != null ? 'recorded' : 'absent',
          alternatives: Array.isArray(d.alternatives) ? d.alternatives : [],
          slice: d.slice ?? null,
        })
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

      case 'VERIFICATION': {
        modelWrittenCount++
        verifications.push({ claim: d.claim ?? null, evidence: d.evidence ?? null, result: d.result ?? null })
        break
      }

      case 'MILESTONE': {
        modelWrittenCount++
        milestones.push({ ord, ts, objective: d.objective ?? null })
        if (objective === null && d.objective != null) {
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
  const allSlices = ledger?.found && Array.isArray(ledger.slices) ? ledger.slices : []

  // ── open / blocked slices ─────────────────────────────────────────────────
  const completedIds = new Set(completedSlices.keys())
  const openSlices = allSlices.filter((s) => !completedIds.has(s.id))
  const readySlices = openSlices.filter((s) => {
    const blockers = Array.isArray(s.blocked_by) ? s.blocked_by : []
    return blockers.every((bid) => completedIds.has(bid))
  })
  const blockedSlices = openSlices.filter((s) => {
    const blockers = Array.isArray(s.blocked_by) ? s.blocked_by : []
    return blockers.length > 0 && !blockers.every((bid) => completedIds.has(bid))
  })

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

  // ── divergence: pure function of injected data ────────────────────────────
  let divergence
  if (groundTruth == null) {
    divergence = { checked: false, findings: [], banner: 'NOT CHECKED' }
  } else {
    const findings = []

    // slice_state_mismatch (high)
    for (const s of allSlices) {
      const foldComplete = completedIds.has(s.id)
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
  if (
    openSlices.length === 0 &&
    allSlices.length > 0 &&
    (!lastGate || lastGate.verdict !== 'APPROVE')
  ) {
    nextActions.push({ action: 'run_advisor_gate', why: 'all slices complete but no APPROVE gate recorded' })
  }

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
    verifications,
    milestones,
    spec_changes: specChanges,
  }

  return {
    compiler_version: COMPILER_VERSION,
    agent,
    human: null, // populated by motive-render.mjs (S4)
    provenance,
    divergence,
  }
}
