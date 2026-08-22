// hooks/lib/motive-map.mjs
// Generates .groundwork/motives/<slug>/MAP.md — a human-readable wayfinder map.
//
// Design constraints:
//   - Fully synchronous (ledger commands are sync; avoids async complexity).
//   - Never throws — warns to stderr, exits 0 so CLI mutations are unaffected.
//   - Single atomic writeFileSync at the end (no partial writes).
//   - No compile() pipeline — lightweight direct read of charter + ledger + journal.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readCharter } from './motive-charter.mjs'
import { readAllEvents, filterEvents } from './journal-io.mjs'
import { readOrderedEvents } from './journal-order.mjs'
import { assembleGraphFold } from './motive-dag.mjs'
import { regenerateMotiveTickets, sanitizeId } from './motive-tickets.mjs'
import { resolvedUnits, inFlightUnit, isExhausted } from './pacing.mjs'
import { frontier as dagFrontier } from './dag-utils.mjs'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Regenerate MAP.md for a given motive.
 *
 * Silent no-op when the motive directory doesn't exist (charter not yet written).
 * Warns to stderr on any error — never throws, never changes the caller's exit code.
 *
 * @param {string} projectDir  — absolute path, same as CLAUDE_PROJECT_DIR
 * @param {string} motive      — motive slug (e.g. "groundwork-development")
 */
export function regenerateMotiveMap(projectDir, motive) {
  if (!projectDir || !motive) return
  try {
    _generate(projectDir, motive)
  } catch (err) {
    process.stderr.write(
      `[motive-map] warn: failed to regenerate MAP.md for "${motive}": ${err?.message ?? err}\n`,
    )
  }
}

// ---------------------------------------------------------------------------
// Core generation
// ---------------------------------------------------------------------------

function _generate(projectDir, motive) {
  const motiveDir = join(projectDir, '.groundwork', 'motives', motive)
  if (!existsSync(motiveDir)) return  // no charter directory yet — skip silently

  const charter            = readCharter({ projectDir, motive })
  const ledgerDoc          = _readMotiveLedgerDoc(projectDir, motive)
  const slices             = Array.isArray(ledgerDoc?.slices) ? ledgerDoc.slices.filter(Boolean) : []
  // AC renderer uses a separate union of ALL sessions' slices so that slice ids
  // reused across sessions (D-12) are tracked per-session, not collapsed.
  const acSlices           = _readAllMotiveSlicesForAC(projectDir, motive)
  const USE_LEGACY_DECISIONS = process.env.GROUNDWORK_MAP_LEGACY_DECISIONS === '1'
  const journalDecisions   = USE_LEGACY_DECISIONS
    ? _readDecisions(projectDir, motive)
    : _readDecisionsFromFold(projectDir, motive)
  // Fall back to decisions embedded in the charter file (# Decisions section) when the
  // journal has no DECISION events — this covers host projects that never emitted them.
  const decisions          = journalDecisions.length > 0
    ? journalDecisions
    : (charter?.decisions ?? []).map((d) => ({ msg: `${d.id}: ${d.text}` }))
  const outOfScope         = _readOutOfScope(projectDir)
  const rejectionDecisions = _readRejectionDecisions(projectDir, motive)
  const allEvents          = _readAllMotiveEvents(projectDir, motive)

  // Enrich open_items with resolved_by from accepted DECISION events in the journal.
  // motive-compile does this in its pipeline; here we replicate the same logic so
  // the lightweight MAP renderer can filter resolved items without the compile step.
  if (charter?.open_items?.length) {
    const resolvedByDecisions = new Map()
    for (const ev of allEvents) {
      if (ev.type === 'DECISION' && ev.data?.status === 'accepted' && ev.data?.resolves != null) {
        if (!resolvedByDecisions.has(ev.data.resolves)) {
          resolvedByDecisions.set(ev.data.resolves, ev.data.id ?? ev.data.resolves)
        }
      }
    }
    for (const item of charter.open_items) {
      if (item.resolved_by == null) {
        const resolvedBy = resolvedByDecisions.get(item.id)
        if (resolvedBy != null) item.resolved_by = resolvedBy
      }
    }
  }

  // Generate per-ticket drill-down files (errors swallowed inside)
  regenerateMotiveTickets(motiveDir, {
    slices,
    openItems: charter?.open_items ?? [],
    events: allEvents,
  })

  const ticketFiles = _readTicketFiles(motiveDir)

  // Extract last_pause from PAUSE events. allEvents is newest-first (see _readAllMotiveEvents),
  // so the FIRST matching PAUSE is the most recent one — use find(), not filter().pop().
  const lastPauseEvent = allEvents.find((ev) => ev.type === 'PAUSE') ?? null
  const lastPause = lastPauseEvent != null
    ? {
        pointer:      lastPauseEvent.data?.pointer ?? null,
        summary:      lastPauseEvent.data?.summary ?? null,
        next_actions: Array.isArray(lastPauseEvent.data?.next_actions) ? lastPauseEvent.data.next_actions : [],
      }
    : null

  const journalAcCoverage = _buildJournalAcCoverage(allEvents)
  const md = _renderMap({ motive, charter, slices, ledgerDoc, decisions, outOfScope, rejectionDecisions, ticketFiles, acSlices, journalAcCoverage, lastPause })
  writeFileSync(join(motiveDir, 'MAP.md'), md, 'utf8')
}

// ---------------------------------------------------------------------------
// Data readers
// ---------------------------------------------------------------------------

/**
 * Return the whole chosen ledger document for this motive (not just slices).
 * Prefers the active ledger; falls back to the last-written one.
 * Returns null when no matching ledger exists.
 */
function _readMotiveLedgerDoc(projectDir, motive) {
  const candidates = []

  // Scan per-session ledgers in .groundwork/runs/
  const runsDir = join(projectDir, '.groundwork', 'runs')
  if (existsSync(runsDir)) {
    for (const f of readdirSync(runsDir)) {
      if (!f.endsWith('.json')) continue
      try {
        const data = JSON.parse(readFileSync(join(runsDir, f), 'utf8'))
        if (data.motive === motive) candidates.push(data)
      } catch { /* skip unreadable / malformed */ }
    }
  }

  // Legacy single-run ledger
  const legacyPath = join(projectDir, '.groundwork', 'run.json')
  if (existsSync(legacyPath)) {
    try {
      const data = JSON.parse(readFileSync(legacyPath, 'utf8'))
      if (data.motive === motive) candidates.push(data)
    } catch { /* ignore */ }
  }

  if (!candidates.length) return null
  return candidates.find((c) => c.active) ?? candidates[candidates.length - 1]
}

/**
 * Return a union of ALL sessions' slices for this motive, each tagged with
 * `_session_id`. Keyed on composite `${session_id}::${slice_id}` so slices
 * from different sessions that reuse the same bare id remain distinct (D-12).
 *
 * Used exclusively by the AC renderer — the main `slices` variable (frontier,
 * progress, pacing) continues to come from the single selected ledger so that
 * other MAP sections are unaffected by this union.
 */
function _readAllMotiveSlicesForAC(projectDir, motive) {
  const sliceMap = new Map()  // composite key → annotated slice

  const runsDir = join(projectDir, '.groundwork', 'runs')
  if (existsSync(runsDir)) {
    for (const f of readdirSync(runsDir)) {
      if (!f.endsWith('.json')) continue
      try {
        const data = JSON.parse(readFileSync(join(runsDir, f), 'utf8'))
        if (data.motive !== motive) continue
        const sessionId = typeof data.session_id === 'string' ? data.session_id : ''
        for (const s of (Array.isArray(data.slices) ? data.slices : [])) {
          if (!s || s.id == null) continue
          const key = `${sessionId}::${s.id}`
          if (!sliceMap.has(key)) {
            sliceMap.set(key, { ...s, _session_id: sessionId })
          }
        }
      } catch { /* skip */ }
    }
  }

  // Legacy single-run ledger
  const legacyPath = join(projectDir, '.groundwork', 'run.json')
  if (existsSync(legacyPath)) {
    try {
      const data = JSON.parse(readFileSync(legacyPath, 'utf8'))
      if (data.motive === motive) {
        const sessionId = typeof data.session_id === 'string' ? data.session_id : ''
        for (const s of (Array.isArray(data.slices) ? data.slices : [])) {
          if (!s || s.id == null) continue
          const key = `${sessionId}::${s.id}`
          if (!sliceMap.has(key)) {
            sliceMap.set(key, { ...s, _session_id: sessionId })
          }
        }
      }
    } catch { /* ignore */ }
  }

  return [...sliceMap.values()].filter(Boolean)
}

/**
 * Return DECISION events for this motive, newest first, with near-duplicates collapsed.
 * Exact-normalized-text duplicates are dropped; when one entry is a prefix/truncation
 * of another the longer one is kept.
 */
/**
 * Return the stems of ticket files found in <motiveDir>/tickets/.
 * Each stem is the filename without the .md extension (e.g. "t1", "t2").
 * Returns [] when the directory does not exist or is empty.
 */
// D-74 ticket type vocabulary (in render order); unknown types fall to 'other'.
const TICKET_TYPE_ORDER = ['research', 'choose', 'model', 'build', 'grill', 'spec', 'fix', 'chore']

function _readTicketFiles(motiveDir) {
  const ticketsDir = join(motiveDir, 'tickets')
  if (!existsSync(ticketsDir)) return []
  try {
    return readdirSync(ticketsDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => {
        const stem = f.slice(0, -3)
        let type = 'other'
        try {
          const content = readFileSync(join(ticketsDir, f), 'utf8')
          const m = /^Type:\s*(.+)$/m.exec(content)
          if (m) type = m[1].trim().toLowerCase()
        } catch { /* leave type as 'other' */ }
        return { stem, type }
      })
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Fold-based decision reader (AC-3: canonical fold path)
// ---------------------------------------------------------------------------

/**
 * Read decisions for MAP rendering via the canonical fold.
 *
 * Builds a msgMap keyed by event.ord → event.msg so that legacy decisions
 * (no data.title / data.decision) can be recovered from the event stream.
 * The fold node's attrs._ord points to the first event's ord, so the lookup
 * is stable for single-event decisions (returns the only event's msg, identical
 * to legacy) and shows first-event's msg for multi-event decisions (the
 * accepted TBD-2 divergence for D-88/D-89).
 *
 * Guard: set GROUNDWORK_MAP_LEGACY_DECISIONS=1 to fall back to _readDecisions.
 */
function _readDecisionsFromFold(projectDir, motive) {
  const journalDir = join(projectDir, '.groundwork', 'journal')
  if (!existsSync(journalDir)) return []
  try {
    const { events: orderedEvents } = readOrderedEvents(journalDir, { motive })
    // Build msgMap: first-event-ord → newest-event-msg per decision.
    // Keyed by the first event's ord (= node.attrs._ord, stamped first-event-wins by the fold)
    // so lookups via attrs._ord work without rebuilding the nodeId formula.
    // For multi-event same-id decisions, newest-wins for msg so the surviving MAP line
    // shows the most recent revision rather than the stale original text.
    const msgMap = new Map()         // first-event-ord → newest msg
    const idsFirstOrd = new Map()    // data.id → first event's ord (for grouping)
    for (const ev of orderedEvents) {
      if (ev.type !== 'DECISION') continue
      const decId = ev.data?.id ?? null
      if (decId) {
        // Structured decision: group by id, track first ord, always update msg (newest wins)
        if (!idsFirstOrd.has(decId)) idsFirstOrd.set(decId, ev.ord)
        msgMap.set(idsFirstOrd.get(decId), ev.msg ?? null)
      } else {
        // Legacy (id-less) decision: each event has a unique _legacy_ord node; set once
        if (!msgMap.has(ev.ord)) msgMap.set(ev.ord, ev.msg ?? null)
      }
    }
    const fold = assembleGraphFold(orderedEvents)
    // Use fold.nodes directly (fold already id-deduped via nodesMap) rather than
    // readOrderedDecisionsFromFold — the latter's internal dedup uses attrs.title/decision
    // for text comparison, which is null for msg-only events → collapses distinct decisions.
    // Instead we recover msg via msgMap and apply _dedupeDecisions (which uses recovered msg).
    const decisionNodes = fold.nodes
      .filter((n) => n.type === 'decision')
      .sort((a, b) => ((b.attrs._ord ?? 0) - (a.attrs._ord ?? 0)))
    const decisionLikes = decisionNodes.map((node) => _foldNodeToDecisionLike(node, msgMap))
    return _dedupeDecisions(decisionLikes)
  } catch {
    return []
  }
}

/**
 * Convert a fold decision node to the shape expected by the MAP renderer:
 *   { ts, msg, data: { id, supersedes, retires, decision } }
 *
 * msg priority: event.msg (via msgMap on _ord) → attrs.title → attrs.decision → null
 * This preserves the legacy event.msg label for single-event decisions while
 * allowing attrs.title to surface for structured multi-event decisions.
 */
function _foldNodeToDecisionLike(node, msgMap) {
  const rawId   = node.id.replace(/^decision:/, '')
  const isLegacy = rawId.startsWith('_legacy_ord')
  return {
    ts:   node.attrs._ts   ?? null,
    msg:  msgMap.get(node.attrs._ord) ?? node.attrs.title ?? node.attrs.decision ?? null,
    data: {
      id:         isLegacy ? null : rawId,
      supersedes: node.attrs.supersedes ?? null,
      retires:    node.attrs.retires    ?? null,
      decision:   node.attrs.decision   ?? null,
    },
  }
}

// ---------------------------------------------------------------------------
// Legacy decision reader (retained behind GROUNDWORK_MAP_LEGACY_DECISIONS=1)
// ---------------------------------------------------------------------------

function _readDecisions(projectDir, motive) {
  const journalDir = join(projectDir, '.groundwork', 'journal')
  if (!existsSync(journalDir)) return []
  try {
    const all            = readAllEvents(journalDir)
    const { shown = [] } = filterEvents(all, { motive, type: 'DECISION' })
    const latest = shown.slice().reverse()  // latest first, non-mutating
    return _dedupeDecisions(latest)
  } catch {
    return []
  }
}

/**
 * Collapse duplicate entries and honour supersession.
 * Input and output are newest-first.
 *
 * Dedupe rules (in priority order):
 *   1. Supersession by id — if a DECISION event's data.supersedes lists another event's
 *      data.id, the superseded event is excluded.  Supersession requires structured ids;
 *      unstructured (legacy) decisions with no data.id cannot be superseded this way.
 *   2. Exact normalised-text match — keep the newest (first in newest-first input).
 *   3. Strict prefix/truncation — one normalised text is a leading prefix of the other;
 *      the longer entry wins.
 *
 * Intentionally NOT used: shared-prefix heuristic (≥N chars) — it dropped genuinely
 * distinct decisions that happen to share a topic opening ("Adopt ASD-STE100 … for
 * orchestrator rule files" vs "… for all spec prose, trial only").
 */
function _dedupeDecisions(decisions) {
  // ── Step 1: honour supersession by structured data.id ────────────────────
  const knownIds = new Set(decisions.map((d) => d.data?.id).filter(Boolean))
  const supersededIds = new Set()
  // Descriptive retires values — refs whose text doesn't match any known structured id.
  // These need token-overlap matching instead of exact-text matching.
  const descriptiveRetires = []
  for (const d of decisions) {
    const s = d.data?.supersedes
    if (s != null) {
      if (Array.isArray(s)) s.forEach((id) => supersededIds.add(id))
      else supersededIds.add(s)
    }
    // data.retires is the authoring vocabulary for retraction (D-36); honour it here
    // so that a retiring decision causes its target to be excluded from the MAP.
    const r = d.data?.retires
    if (r != null) {
      const refs = Array.isArray(r) ? r : [r]
      for (const ref of refs) {
        supersededIds.add(ref)
        // If this ref is not a known structured id, it's a descriptive reference.
        // Exact-text matching will fail; use token-overlap as a fallback.
        if (!knownIds.has(ref)) descriptiveRetires.push(ref)
      }
    }
  }
  // normalise: used both for filtering and for step-2 dedup
  const normText = (d) =>
    (d.msg ?? JSON.stringify(d.data ?? '')).toLowerCase().replace(/\s+/g, ' ').trim()
  const normSupersededTexts = new Set([...supersededIds].map((s) => s.toLowerCase().replace(/\s+/g, ' ').trim()))

  // Token-overlap matcher for descriptive retires references.
  // Splits text on non-alphanumeric boundaries, keeps tokens ≥ 4 chars.
  // A decision is matched when ≥ 60% of the retires tokens appear in its text,
  // with a hard floor of 2 tokens (guards against single-word over-matching).
  const _sigTokens = (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4)
  const _tokenOverlapMatches = (retiresRef, decisionNorm) => {
    const refTokens = _sigTokens(retiresRef)
    if (refTokens.length === 0) return false
    const matchCount = refTokens.filter((t) => decisionNorm.includes(t)).length
    const required = Math.max(2, Math.ceil(refTokens.length * 0.6))
    return matchCount >= required
  }

  const active = supersededIds.size === 0
    ? decisions
    : decisions.filter((d) => {
        const id = d.data?.id
        // Match by structured id first
        if (id != null && supersededIds.has(id)) return false
        const dNorm = normText(d)
        // Match by normalised message text (covers legacy id-less decisions retired by text ref)
        if (normSupersededTexts.has(dNorm)) return false
        // Token-overlap match for descriptive retires references.
        // Only applied to id-less (legacy) decisions — structured ones (with data.id) are
        // already handled by the supersededIds.has(id) check above, and the retiring decision
        // itself must never be excluded by its own retires ref.
        if (id == null && descriptiveRetires.length > 0 && descriptiveRetires.some((ref) => _tokenOverlapMatches(ref, dNorm))) return false
        return true
      })

  // ── Step 2: exact and prefix/truncation dedup ─────────────────────────────
  const norm = normText  // alias — same normalisation

  const result = []
  for (const d of active) {
    const dNorm = norm(d)
    let skip = false
    let replaceIdx = -1
    for (let i = 0; i < result.length; i++) {
      const rNorm = norm(result[i])
      if (rNorm === dNorm) { skip = true; break }            // exact dup — keep result[i] (newer)
      if (rNorm.startsWith(dNorm)) { skip = true; break }    // result[i] is longer — skip d
      if (dNorm.startsWith(rNorm)) { replaceIdx = i; break } // d is longer — replace result[i]
    }
    if (!skip) {
      if (replaceIdx >= 0) result[replaceIdx] = d
      else result.push(d)
    }
  }

  // ── Step 3: exclude janitorial retraction events ──────────────────────────
  // A janitorial retraction is a DECISION event whose sole purpose is to suppress
  // a legacy id-less entry: it carries data.retires AND its decision body starts
  // with "Retract".  Such events still contribute to supersededIds above (so their
  // targets stay suppressed), but they must NOT appear in the MAP ## Decisions
  // section — they are agent bookkeeping, not human-readable decisions (P-E).
  // Substantive decisions that also carry data.retires (e.g. D-32, which retires
  // a prior approach while introducing a new one) have a non-"Retract" decision
  // body and are therefore kept.
  const isJanitorialRetraction = (d) =>
    d.data?.retires != null &&
    (d.data?.decision ?? '').trimStart().toLowerCase().startsWith('retract')

  return result.filter((d) => !isJanitorialRetraction(d))
}

/**
 * Return human labels for every entry in .groundwork/out-of-scope/.
 */
function _readOutOfScope(projectDir) {
  const dir = join(projectDir, '.groundwork', 'out-of-scope')
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, '').replace(/-/g, ' '))
  } catch {
    return []
  }
}

/**
 * Return formatted labels for DECISION events that carry a rejection marker.
 * Detection: data.status==='rejected', data.rejects truthy, or "reject"/"not adopted"
 * appears in data.title or msg (case-insensitive).
 *
 * Dedup rule — first-sentence strict prefix (structural identity, not fuzzy prose):
 *   Two rejection events are considered the same rejection when one event's first
 *   sentence (text before the first ". " or end of msg) is a strict prefix of the
 *   other's first sentence after case-folding and whitespace normalisation.
 *   The shorter first sentence is the "summary form"; the longer is the "full prose".
 *   We keep the FULL PROSE (P-E: human-first content).  If the summary form carried a
 *   structured data.id, we append it to the kept label as " (D-X)" so the id is not lost.
 *
 * This is deliberately more conservative than a shared-prefix-length heuristic: it only
 * merges when the entire first sentence of one event is a strict prefix of the other's.
 * When the relationship is unclear, both entries are rendered.
 *
 * NOT used: session-level suppression — session identity ≠ rejection identity.
 */
function _readRejectionDecisions(projectDir, motive) {
  const journalDir = join(projectDir, '.groundwork', 'journal')
  if (!existsSync(journalDir)) return []
  try {
    const all            = readAllEvents(journalDir)
    const { shown = [] } = filterEvents(all, { motive, type: 'DECISION' })

    // Build the set of texts retired by data.retires fields, so that an event
    // whose msg was retired by a later retraction is excluded from ## Out of scope.
    // Uses the same normalisation as _dedupeDecisions step 1.
    const retiredTexts = new Set()
    for (const ev of shown) {
      const r = ev.data?.retires
      if (r != null) {
        const refs = Array.isArray(r) ? r : [r]
        refs.forEach((ref) => retiredTexts.add(ref.toLowerCase().replace(/\s+/g, ' ').trim()))
      }
    }

    // Collect rejection events
    const rejections = []
    for (const ev of shown) {
      // Skip events whose text was retired by a data.retires reference
      const normMsg = (ev.msg ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
      if (retiredTexts.has(normMsg)) continue

      const data  = ev.data ?? {}
      const title = (data.title ?? '').toLowerCase()
      const msg   = (ev.msg   ?? '').toLowerCase()
      const isRejection =
        data.status === 'rejected' ||
        !!data.rejects ||
        /\breject(ed|s)?\b/.test(title) ||
        /\bnot adopted\b/.test(msg) ||
        /\bdo not adopt\b/.test(msg) ||
        /\brejected\b/.test(msg)
      if (!isRejection) continue
      rejections.push(ev)
    }

    // Extract first sentence for comparison: text before the first ". " (or whole msg)
    const firstSentence = (ev) => {
      const msg = (ev.msg ?? '').replace(/\s+/g, ' ').trim()
      const cut = msg.indexOf('. ')
      return (cut >= 0 ? msg.slice(0, cut) : msg).toLowerCase()
    }

    // First-sentence strict-prefix dedup:
    //   For each pair, if A's first sentence is a strict prefix of B's first sentence,
    //   A is the summary form and B is the full prose.  Mark A as merged-into-B.
    const mergedInto = new Map()  // index → index of the richer entry
    const absorbedIds = new Map() // index-of-kept → Set of ids from absorbed entries

    for (let i = 0; i < rejections.length; i++) {
      if (mergedInto.has(i)) continue
      const fsI = firstSentence(rejections[i])
      for (let j = 0; j < rejections.length; j++) {
        if (i === j || mergedInto.has(j)) continue
        const fsJ = firstSentence(rejections[j])
        if (fsJ === fsI) continue  // exact — handled by seenLabels below
        // Determine which is the prefix (shorter first sentence = summary form)
        if (fsI.startsWith(fsJ + ' ') || fsI === fsJ) {
          // fsJ is prefix of fsI → rejections[i] is the longer (full prose), j is summary
          mergedInto.set(j, i)
          const jId = rejections[j].data?.id
          if (jId) {
            if (!absorbedIds.has(i)) absorbedIds.set(i, new Set())
            absorbedIds.get(i).add(jId)
          }
        } else if (fsJ.startsWith(fsI + ' ') || fsJ === fsI) {
          // fsI is prefix of fsJ → rejections[j] is the longer (full prose), i is summary
          mergedInto.set(i, j)
          const iId = rejections[i].data?.id
          if (iId) {
            if (!absorbedIds.has(j)) absorbedIds.set(j, new Set())
            absorbedIds.get(j).add(iId)
          }
          break  // i is now merged; skip remaining j comparisons
        }
      }
    }

    // Build labels for surviving (non-merged) events
    const seenLabels = new Set()
    const results = []
    for (let i = 0; i < rejections.length; i++) {
      if (mergedInto.has(i)) continue  // subsumed by a longer entry
      const ev   = rejections[i]
      const data = ev.data ?? {}
      let label  = data.id
        ? `[${data.id}] ${data.title ?? ev.msg}`
        : (data.title ?? ev.msg)

      // Append ids absorbed from shorter summary-form entries (P-E: keep prose, surface id)
      const extra = absorbedIds.get(i)
      if (extra?.size) {
        label += ` (${[...extra].join(', ')})`
      }

      const key = label.toLowerCase().trim()
      if (!seenLabels.has(key)) { seenLabels.add(key); results.push(label) }
    }
    return results
  } catch {
    return []
  }
}

/**
 * Return all journal events for a motive (all types, newest first).
 * Used to feed the ticket generator with related events.
 */
function _readAllMotiveEvents(projectDir, motive) {
  const journalDir = join(projectDir, '.groundwork', 'journal')
  if (!existsSync(journalDir)) return []
  try {
    const all            = readAllEvents(journalDir)
    const { shown = [] } = filterEvents(all, { motive })
    return shown.slice().reverse()  // newest first
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Journal-derived AC coverage (fallback when ledger is absent)
// ---------------------------------------------------------------------------

/**
 * Build AC coverage from journal AC_COVERAGE and TASK_COMPLETE events.
 *
 * Returns Map<acId, [{id: sliceId, status: 'complete'|'pending'}]>.
 *
 * This is the fallback source when all ledger files for a motive have been
 * pruned by pruneStaleSessionLedgers.  AC_COVERAGE events are in NEVER_COMPRESS
 * so they survive any journal digest pass; TASK_COMPLETE events record the
 * authoritative completion signal.  Together they let the MAP renderer show the
 * correct "met" status even after the ephemeral ledger is gone.
 *
 * Three AC_COVERAGE payload forms (mirrors motive-compile.mjs):
 *   Single-AC form:    { ac, slice }              — one slice covers one AC
 *   Array-covers form: { slice, covers: ['AC-1'] } — one slice covers many ACs
 *   Declaration form:  { ac, covering: [] }        — AC known but no covering slice
 */
function _buildJournalAcCoverage(events) {
  // Collect completed slice bare ids from TASK_COMPLETE events.
  const completedSlices = new Set()
  for (const ev of events) {
    if (ev.type === 'TASK_COMPLETE' && ev.data?.slice != null) {
      completedSlices.add(String(ev.data.slice))
    }
  }

  // Map<acId, Map<sliceId, {id, status}>> — deduped by sliceId per AC.
  const acMap = new Map()

  for (const ev of events) {
    if (ev.type !== 'AC_COVERAGE') continue
    const d = ev.data ?? {}

    // Collect acIds and sliceId from this event
    const acIds = []
    if (d.ac != null) acIds.push(String(d.ac))
    if (Array.isArray(d.covers)) {
      for (const a of d.covers) { if (a != null) acIds.push(String(a)) }
    }

    const sliceId = d.slice != null ? String(d.slice) : null

    // Declaration form (no slice): register AC so it appears even with zero coverage
    if (sliceId == null) {
      for (const acId of acIds) {
        if (!acMap.has(acId)) acMap.set(acId, new Map())
      }
      continue
    }

    const status = completedSlices.has(sliceId) ? 'complete' : 'pending'
    for (const acId of acIds) {
      if (!acMap.has(acId)) acMap.set(acId, new Map())
      acMap.get(acId).set(sliceId, { id: sliceId, status })
    }
  }

  // Post-loop: apply AC_RETRACTION events.  Collected after the full event
  // scan so the result is order-independent — a retraction before or after
  // the original claim produces the same outcome.
  for (const ev of events) {
    if (ev.type !== 'AC_RETRACTION') continue
    const d = ev.data ?? {}
    const acId = d.ac != null ? String(d.ac) : null
    const sliceId = d.slice != null ? String(d.slice) : null
    if (acId == null || sliceId == null) continue
    const slicesMap = acMap.get(acId)
    if (slicesMap) slicesMap.delete(sliceId)
  }

  // Flatten to Map<acId, [{id, status}]>
  const result = new Map()
  for (const [acId, slicesMap] of acMap) {
    result.set(acId, [...slicesMap.values()])
  }
  return result
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

function _renderMap({ motive, charter, slices, ledgerDoc = null, decisions, outOfScope, rejectionDecisions = [], ticketFiles = [], acSlices = null, journalAcCoverage = null, lastPause = null }) {
  const parts = []

  parts.push(`# MAP: ${motive}`)
  parts.push('')

  // ── Destination ───────────────────────────────────────────────────────────
  parts.push('## Destination')
  parts.push('')
  const objective = charter?.objective?.trim()
  if (objective) {
    parts.push(objective)
  } else {
    parts.push('_No objective recorded yet._')
  }
  parts.push('')

  // ── Build decision→slices index (for edge rendering) ─────────────────────
  // Maps decision id (e.g. "D-40") → [{id, status}] for slices that declare it.
  const _decisionSlicesMap = new Map()
  for (const s of slices) {
    const decIds = s.decisions == null
      ? []
      : Array.isArray(s.decisions)
        ? s.decisions
        : String(s.decisions).split(',').map((x) => x.trim()).filter(Boolean)
    for (const did of decIds) {
      if (!_decisionSlicesMap.has(did)) _decisionSlicesMap.set(did, [])
      _decisionSlicesMap.get(did).push({ id: s.id, status: s.status ?? 'pending' })
    }
  }

  // ── Decisions so far ──────────────────────────────────────────────────────
  parts.push('## Decisions so far')
  parts.push('')
  if (decisions.length) {
    for (const d of decisions) {
      const ts  = (d.ts ?? '').slice(0, 10)
      const msg = d.msg ?? JSON.stringify(d.data ?? '')
      // Append slice edge suffix only for structured decisions with a data.id
      let edgeSuffix = ''
      const did = d.data?.id
      if (did != null) {
        const refs = _decisionSlicesMap.get(did)
        if (refs?.length) {
          edgeSuffix = ' → ' + refs.map((r) => `${r.id} (${r.status === 'complete' ? 'complete' : 'pending'})`).join(', ')
        }
      }
      parts.push(`- ${ts ? `[${ts}] ` : ''}${msg}${edgeSuffix}`)
    }
  } else {
    parts.push('_No decisions recorded yet._')
  }
  parts.push('')

  // ── Frontier ──────────────────────────────────────────────────────────────
  const completeIds    = new Set(slices.filter((s) => s.status === 'complete').map((s) => s.id))
  const inProgressList = slices.filter(
    (s) => s.status === 'in_progress' || (s.claimed_by && s.status !== 'complete'),
  )
  const blockedList = slices.filter((s) => {
    if (s.status === 'complete' || s.status === 'in_progress') return false
    if (s.claimed_by) return false
    const deps = _deps(s)
    return deps.length > 0 && deps.some((d) => !completeIds.has(d))
  })
  const frontierList = dagFrontier(slices).filter((s) => !s.claimed_by)

  // Helper: render optional _(decisions: ...)_ suffix for a slice
  const _decSuffix = (s) => {
    const decIds = s.decisions == null
      ? []
      : Array.isArray(s.decisions)
        ? s.decisions
        : String(s.decisions).split(',').map((x) => x.trim()).filter(Boolean)
    return decIds.length ? ` _(decisions: ${decIds.join(', ')})_` : ''
  }

  parts.push('## Frontier')
  parts.push('')
  parts.push('_Slices that can start now (no pending blockers):_')
  parts.push('')
  if (frontierList.length) {
    for (const s of frontierList) {
      parts.push(`- ${_sliceLink(s.id, s.ticket)} — ${s.desc ?? '(no description)'}${_decSuffix(s)}`)
    }
  } else {
    parts.push(
      '_No frontier slices — everything is in progress, blocked, or complete._',
    )
  }
  parts.push('')

  // ── In progress / Blocked ─────────────────────────────────────────────────
  if (inProgressList.length || blockedList.length) {
    parts.push('## In progress / Blocked')
    parts.push('')
    if (inProgressList.length) {
      parts.push('**In progress:**')
      parts.push('')
      for (const s of inProgressList) {
        const claim = s.claimed_by ? ` _(claimed by ${s.claimed_by})_` : ''
        parts.push(`- ${_sliceLink(s.id, s.ticket)}${claim} — ${s.desc ?? '(no description)'}${_decSuffix(s)}`)
      }
      parts.push('')
    }
    if (blockedList.length) {
      parts.push('**Blocked:**')
      parts.push('')
      for (const s of blockedList) {
        const pending = _deps(s).filter((d) => !completeIds.has(d))
        parts.push(
          `- ${_sliceLink(s.id, s.ticket)} — ${s.desc ?? '(no description)'} _(waiting on: ${pending.join(', ')})_${_decSuffix(s)}`,
        )
      }
      parts.push('')
    }
  }

  // ── Tickets ───────────────────────────────────────────────────────────────
  // Only rendered when hand-authored ticket documents exist in tickets/.
  // When the corpus is empty the section is omitted entirely (pure slice view preserved).
  if (ticketFiles.length > 0) {
    // Build lookup: sanitized ticket stem → slice
    const sliceByTicketStem = new Map()
    for (const s of slices) {
      if (s.ticket) {
        const safe = sanitizeId(String(s.ticket))
        if (safe) sliceByTicketStem.set(safe, s)
      }
    }

    const ticketStemSet = new Set(ticketFiles.map((t) => t.stem))

    // Slices that have no ticket file (either no ticket field, or file not found)
    const unlinkedSlices = slices.filter((s) => {
      if (!s.ticket) return true
      const safe = sanitizeId(String(s.ticket))
      return !safe || !ticketStemSet.has(safe)
    })

    parts.push('## Tickets')
    parts.push('')

    // Group tickets by D-74 type; unknown types → 'other' bucket at end.
    const byType = new Map()
    for (const { stem, type } of ticketFiles) {
      const key = TICKET_TYPE_ORDER.includes(type) ? type : 'other'
      if (!byType.has(key)) byType.set(key, [])
      byType.get(key).push(stem)
    }
    const renderOrder = TICKET_TYPE_ORDER.filter((t) => byType.has(t))
    if (byType.has('other')) renderOrder.push('other')

    for (const typeKey of renderOrder) {
      parts.push(`### ${typeKey}`)
      parts.push('')
      for (const stem of byType.get(typeKey)) {
        const slice = sliceByTicketStem.get(stem)
        const badge = slice
          ? _statusBadge(slice.status ?? 'pending')
          : _statusBadge('no-slice')
        const desc  = slice?.desc ? ` — ${slice.desc}` : ''
        parts.push(`- [${stem}](tickets/${stem}.md) ${badge}${desc}`)
      }
      parts.push('')
    }

    if (unlinkedSlices.length > 0) {
      parts.push('**Unlinked slices** _(no ticket document):_')
      parts.push('')
      for (const s of unlinkedSlices) {
        parts.push(`- ${_sliceLink(s.id, undefined)} — ${s.desc ?? '(no description)'}`)
      }
      parts.push('')
    }
  }

  // ── Open items ────────────────────────────────────────────────────────────
  parts.push('## Open items')
  parts.push('')
  const openItems = (charter?.open_items ?? []).filter((item) => !item.resolved_by)
  if (openItems.length) {
    for (const item of openItems) {
      const owner   = item.owner      ? ` @${item.owner}`                    : ''
      const blocker = item.blocked_by ? ` _(blocked by ${item.blocked_by})_` : ''
      // statement is the short handle; body (detail text) surfaces in the
      // drill-down file (open-items/<id>.md) only — do NOT append it here.
      const statement = (item.statement ?? '').trim()
      parts.push(`- ${_openItemLink(item.id)}: ${statement}${owner}${blocker}`)
    }
  } else {
    parts.push('_No open items._')
  }
  parts.push('')

  // ── Out of scope ──────────────────────────────────────────────────────────
  parts.push('## Out of scope')
  parts.push('')
  const charterOos = charter?.out_of_scope?.trim()
  // Ignore the boilerplate comment stub that the template inserts
  const hasCharterOos =
    charterOos &&
    !charterOos.startsWith('<!--') &&
    charterOos.length > 0
  if (hasCharterOos) {
    parts.push(charterOos)
    parts.push('')
  }

  // Merge dir entries and rejection decisions, deduplicated (case-insensitive)
  const seenOos = new Set()
  const allOos  = []
  for (const entry of [...outOfScope, ...rejectionDecisions]) {
    const key = entry.toLowerCase().trim()
    if (!seenOos.has(key)) { seenOos.add(key); allOos.push(entry) }
  }
  if (allOos.length) {
    for (const entry of allOos) {
      parts.push(`- ${entry}`)
    }
  } else if (!hasCharterOos) {
    parts.push('_Nothing explicitly ruled out yet._')
  }
  parts.push('')

  // ── Acceptance criteria ───────────────────────────────────────────────────
  const acList = charter?.acceptance_criteria ?? []
  if (acList.length > 0) {
    // Bug 1: use the all-sessions union (acSlices) so slices reusing the same
    // bare id across sessions (D-12) are tracked per-session, not collapsed.
    // Falls back to the single-session slices when acSlices is unavailable.
    const acSourceSlices = acSlices ?? slices

    // Build map: AC id → covering slices [{id, status}]
    // Seed charter ACs first so they appear even when no slice covers them.
    const acSlicesMap = new Map()
    const charterAcKeys = new Set()
    for (const ac of acList) {
      if (ac?.id != null) {
        acSlicesMap.set(String(ac.id), [])
        charterAcKeys.add(String(ac.id))
      }
    }

    // Bug 2: collect covering slices for ALL claimed AC ids (union, not intersection).
    // Previously the acSlicesMap.has(acId) gate silently dropped undeclared ACs
    // that implementers claimed — a signal that must not be swallowed (D-85).
    for (const s of acSourceSlices) {
      const raw = s.covers_ac
      const acIds = Array.isArray(raw)
        ? raw
        : typeof raw === 'string' && raw
          ? raw.split(',').map((x) => x.trim()).filter(Boolean)
          : []
      for (const acId of acIds) {
        if (!acSlicesMap.has(acId)) {
          acSlicesMap.set(acId, [])  // undeclared-but-claimed AC
        }
        // Bug 1: use composite session_id::slice_id as the covering entry's
        // display id so two sessions' slices with the same bare id are not
        // conflated (D-12 — slice ids are reused across sessions).
        // Falsy guard: empty-string _session_id (legacy ledgers with no session_id)
        // falls back to the bare slice id so display is not garbled with a "::S1" prefix.
        const compositeId = s._session_id ? `${s._session_id}::${s.id}` : s.id
        acSlicesMap.get(acId).push({ id: compositeId, status: s.status ?? 'pending' })
      }
    }

    // Statement lookup from charter
    const acStatementMap = new Map()
    for (const ac of acList) {
      if (ac?.id != null && ac.statement) acStatementMap.set(String(ac.id), ac.statement)
    }

    parts.push('## Acceptance criteria')
    parts.push('')

    // Render charter ACs in charter order, then undeclared-but-claimed ACs sorted.
    const charterAcIds = acList.filter((ac) => ac?.id != null).map((ac) => String(ac.id))
    const undeclaredAcIds = [...acSlicesMap.keys()].filter((k) => !charterAcKeys.has(k)).sort()
    const orderedAcIds = [...charterAcIds, ...undeclaredAcIds]

    for (const key of orderedAcIds) {
      const ledgerCovering = acSlicesMap.get(key) ?? []
      // Fallback: when the ledger has no covering slices (e.g. pruned by pruneStaleSessionLedgers),
      // use journal-derived coverage from AC_COVERAGE + TASK_COMPLETE events.  The journal is the
      // durable record (AC_COVERAGE is in NEVER_COMPRESS) and must win when ledger data is absent.
      const covering = ledgerCovering.length > 0 ? ledgerCovering : (journalAcCoverage?.get(key) ?? [])
      const rawStmt = acStatementMap.get(key) ?? ''
      const stmt = rawStmt.length > 120 ? rawStmt.slice(0, 117) + '…' : rawStmt
      const stmtSuffix = stmt
        ? ` — ${stmt}`
        : (charterAcKeys.has(key) ? '' : ' — _(not declared in charter)_')
      const isMet = covering.length > 0 && covering.every((s) => s.status === 'complete')
      if (isMet) {
        const coverIds = covering.map((s) => s.id).join(', ')
        parts.push(`- ✓ **${key}** — met (covered by: ${coverIds})${stmtSuffix}`)
      } else if (covering.length === 0) {
        // PLANNING HOLE — no slice has declared covers_ac for this AC.
        // Visually distinct from "covered but incomplete" so a reader can spot it at a glance.
        parts.push(`- ⚠ **${key}** — PLANNING HOLE: no covering slices assigned${stmtSuffix}`)
      } else {
        const incomplete = covering.filter((s) => s.status !== 'complete')
        parts.push(`- ✗ **${key}** — covered, incomplete (slices: ${incomplete.map((s) => s.id).join(', ')})${stmtSuffix}`)
      }
    }
    parts.push('')
  }

  // ── Progress ──────────────────────────────────────────────────────────────
  if (slices.length > 0) {
    const doneSlices = slices.filter((s) => s.status === 'complete')
    parts.push('## Progress')
    parts.push('')
    parts.push(`${doneSlices.length} / ${slices.length} slices complete`)
    if (doneSlices.length > 0) {
      parts.push('')
      for (const s of doneSlices) {
        const desc = s.desc ? ` — ${s.desc}` : ''
        parts.push(`- ✓ ${_sliceLink(s.id, s.ticket)}${desc}`)
      }
    }
    parts.push('')
  }

  // ── Pacing ────────────────────────────────────────────────────────────────
  if (ledgerDoc?.pacing) {
    const pacing      = ledgerDoc.pacing
    const budget      = pacing.budget ?? 1
    const grant       = pacing.grant ?? null
    const grantRange  = grant?.range ?? 0
    const cap         = budget + grantRange
    const unitWord    = pacing.policy === 'wave' ? 'wave' : 'slice'
    const resolved    = resolvedUnits(ledgerDoc)
    const inflight    = inFlightUnit(ledgerDoc)
    const exhausted   = isExhausted(ledgerDoc)

    parts.push('## Pacing')
    parts.push('')

    const budgetLine = grantRange > 0
      ? `**Policy:** ${pacing.policy} · **Budget:** ${budget} ${unitWord}${budget === 1 ? '' : 's'} + ${grantRange} via autopilot (cap ${cap})`
      : `**Policy:** ${pacing.policy} · **Budget:** ${budget} ${unitWord}${budget === 1 ? '' : 's'}`
    parts.push(budgetLine)
    parts.push(`**Consumption:** ${resolved} of ${cap} ${unitWord}${cap === 1 ? '' : 's'} resolved — ${resolved < cap ? 'new unit may be started' : 'budget consumed'}`)

    if (inflight !== null) {
      const label = pacing.policy === 'wave' ? `wave ${inflight}` : `"${inflight}"`
      parts.push(`**In-flight ${unitWord}:** ${label}`)
    }

    if (grant) {
      const grantedBy  = grant.granted_by ? ` by ${grant.granted_by}` : ''
      const grantedAt  = grant.granted_at ? ` (${String(grant.granted_at).slice(0, 10)})` : ''
      const reason     = grant.reason     ? ` — ${grant.reason}`      : ''
      parts.push(`**Autopilot grant:** +${grant.range} ${unitWord}${grant.range === 1 ? '' : 's'}${grantedBy}${grantedAt}${reason}`)
    }

    if (exhausted) {
      const exemptKinds = pacing.exempt_kinds ?? []
      const remaining   = (ledgerDoc.slices ?? []).filter(
        (s) => !exemptKinds.includes(s.kind) && s.status !== 'complete',
      )
      const ids = remaining.map((s) => s.id).join(', ')
      parts.push(`**Session exhausted.** Run \`/groundwork:pause\` and open a new session. Remaining work: ${ids || '(none listed)'}`)
    }

    parts.push('')
  }

  // ── Pause ─────────────────────────────────────────────────────────────────
  if (lastPause != null) {
    parts.push('## Pause')
    parts.push('')
    if (lastPause.pointer) parts.push(`**Pointer:** ${lastPause.pointer}`)
    if (lastPause.summary) parts.push(lastPause.summary)
    if (Array.isArray(lastPause.next_actions) && lastPause.next_actions.length > 0) {
      parts.push('')
      parts.push('**Next actions:**')
      parts.push('')
      for (const na of lastPause.next_actions) {
        parts.push(`- **${na.action}:** ${na.detail ?? ''}`)
      }
    }
    parts.push('')
  }

  // Footer
  parts.push('---')
  parts.push(
    '_Auto-generated — refreshed automatically by ledger/journal CLIs. Do not edit by hand._',
  )

  return parts.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _statusBadge(status) {
  switch (status) {
    case 'complete':    return '(complete)'
    case 'in_progress': return '(in progress)'
    case 'pending':     return '(pending)'
    case 'no-slice':    return '(unstarted — no slice)'
    default:            return `(${status})`
  }
}

function _deps(slice) {
  if (Array.isArray(slice.blocked_by)) return slice.blocked_by
  if (slice.blocked_by) return [slice.blocked_by]
  return []
}

/**
 * Render a slice id as a Markdown link to its hand-authored ticket, or bold text.
 * Links to tickets/<ticket>.md only when the slice carries a ticket reference;
 * nothing in the regeneration path writes ticket files for slices automatically.
 */
function _sliceLink(id, ticketRef) {
  if (ticketRef) {
    const safe = sanitizeId(ticketRef)
    if (safe) return `[${id}](tickets/${safe}.md)`
  }
  const safeId = sanitizeId(id)
  return safeId ? `**${id}**` : `**${id}**`
}

/**
 * Render an open-item id as a Markdown link to its drill-down in open-items/.
 */
function _openItemLink(id) {
  const safe = sanitizeId(id)
  return safe ? `[${id}](open-items/${safe}.md)` : `**${id}**`
}
