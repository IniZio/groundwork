// check-comments-exempt — hook lib; DAG traversal with dense invariants
/**
 * motive-dag.mjs — Shared fold-reading seam for live-surface-cutover consumers.
 *
 * Provides graph-only helper functions that downstream slices (T3/T4/T5) consume
 * to read from the canonical event-sourced fold instead of parallel projections.
 *
 * Wave-0 tracer: add-only; does NOT rewire motive-map / ledger / motive-graph.
 *
 * Purity contract (mirrors motive-graph-fold.mjs):
 *   - No node:fs / node:child_process imports.
 *   - No wall-clock access, no random, no process globals.
 *   - Deterministic for a fixed fold graph.
 *
 * Implements: live-surface-cutover motive, T0 shared-seam slice.
 */

export { assembleGraphFold } from './motive-graph-fold.mjs'
export { projectFoldGraph, NON_RECONSTRUCTIBLE_FIELDS } from './motive-graph-project.mjs'

// ── Internal dedup helpers (ported from hooks/lib/motive-map.mjs _dedupeDecisions) ──

/**
 * Normalise a decision-like object's text for dedup comparisons.
 * Mirrors motive-map's normText: (d.msg ?? JSON.stringify(d.data ?? '')).toLowerCase()...
 *
 * @param {{ msg: string|null, data: object }} d
 * @returns {string}
 */
function _normText(d) {
  return (d.msg ?? JSON.stringify(d.data ?? '')).toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Significant tokens for token-overlap matching (≥4 chars, alpha-numeric only).
 * @param {string} text
 * @returns {string[]}
 */
function _sigTokens(text) {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4)
}

/**
 * Check whether a descriptive retires-reference text overlaps with a decision's
 * normalised text by token overlap (≥60%, floor 2 tokens).
 *
 * @param {string} retiresRef  — descriptive retires string from the retiring event
 * @param {string} decisionNorm — normalised text of the candidate decision
 * @returns {boolean}
 */
function _tokenOverlapMatches(retiresRef, decisionNorm) {
  const refTokens = _sigTokens(retiresRef)
  if (refTokens.length === 0) return false
  const matchCount = refTokens.filter((t) => decisionNorm.includes(t)).length
  const required = Math.max(2, Math.ceil(refTokens.length * 0.6))
  return matchCount >= required
}

/**
 * Collapse duplicate decision-like entries and honour supersession.
 * Ported from motive-map.mjs _dedupeDecisions — operates on fold-node pseudo-events
 * instead of raw journal events.  Input and output are newest-first.
 *
 * Dedupe rules (in priority order):
 *   1. Supersession by id — if data.supersedes lists another entry's data.id,
 *      the superseded entry is excluded.
 *   2. Exact normalised-text match — keep the newest (first in newest-first input).
 *   3. Strict prefix/truncation — one normalised text is a leading prefix of the
 *      other → keep the longer (more detailed) entry.
 *   4. Janitorial retractions — exclude events whose sole purpose is to suppress a
 *      legacy id-less entry (data.retires != null AND decision body starts with "Retract").
 *
 * @param {Array<{ data: { id: string|null, supersedes: unknown, retires: unknown, decision: string|null }, msg: string|null, _node: object }>} decisions
 * @returns {typeof decisions}
 */
function _dedupeDecisionLikes(decisions) {
  // ── Step 1: honour supersession by structured data.id ────────────────────
  const knownIds = new Set(decisions.map((d) => d.data.id).filter(Boolean))
  const supersededIds = new Set()
  // Descriptive retires values — refs whose text doesn't match any known structured id.
  // These need token-overlap matching instead of exact-text matching.
  const descriptiveRetires = []
  for (const d of decisions) {
    const s = d.data.supersedes
    if (s != null) {
      if (Array.isArray(s)) s.forEach((id) => supersededIds.add(id))
      else supersededIds.add(s)
    }
    const r = d.data.retires
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

  const normSupersededTexts = new Set(
    [...supersededIds].map((s) => s.toLowerCase().replace(/\s+/g, ' ').trim())
  )

  const active =
    supersededIds.size === 0
      ? decisions
      : decisions.filter((d) => {
          const id = d.data.id
          // Match by structured id first
          if (id != null && supersededIds.has(id)) return false
          const dNorm = _normText(d)
          // Match by normalised message text (covers legacy id-less decisions retired by text ref)
          if (normSupersededTexts.has(dNorm)) return false
          // Token-overlap match for descriptive retires references.
          // Only applied to id-less (legacy) decisions — structured ones (with data.id) are
          // already handled by the supersededIds.has(id) check above, and the retiring decision
          // itself must never be excluded by its own retires ref.
          if (
            id == null &&
            descriptiveRetires.length > 0 &&
            descriptiveRetires.some((ref) => _tokenOverlapMatches(ref, dNorm))
          )
            return false
          return true
        })

  // ── Step 2: exact and prefix/truncation dedup ─────────────────────────────
  const result = []
  for (const d of active) {
    const dNorm = _normText(d)
    let skip = false
    let replaceIdx = -1
    for (let i = 0; i < result.length; i++) {
      const rNorm = _normText(result[i])
      if (rNorm === dNorm || rNorm.startsWith(dNorm)) {
        skip = true
        break
      }
      if (dNorm.startsWith(rNorm)) {
        replaceIdx = i
        break
      }
    }
    if (!skip) {
      if (replaceIdx >= 0) result[replaceIdx] = d
      else result.push(d)
    }
  }

  // ── Step 3: exclude janitorial retraction events ──────────────────────────
  // A janitorial retraction carries data.retires AND its decision body starts
  // with "Retract".  It contributes to supersededIds above (targets stay suppressed)
  // but must NOT appear in the output (P-E: agent bookkeeping, not a human decision).
  return result.filter(
    (d) =>
      !(
        d.data.retires != null &&
        (d.data.decision ?? '').trimStart().toLowerCase().startsWith('retract')
      )
  )
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read all decision nodes from a fold graph, newest-first, deduplicated with
 * supersession and janitorial-retraction rules ported from motive-map.mjs.
 *
 * "Newest-first" uses node.attrs._ord (first-event semantics, stored by assembleGraphFold).
 * Legacy decision nodes (id starts with "_legacy_ord") are treated as id-less decisions,
 * matching motive-map's treatment of events without data.id.
 *
 * @param {{ nodes: Array<{ id: string, type: string, attrs: Record<string, unknown> }>, edges: object[], attrs: object }} fold
 *   Output of assembleGraphFold().
 * @param {object[]} [events]
 *   Optional — accepted for future extensibility (title recovery parity with
 *   projectFoldGraph); not used in the current dedup path since fold attrs already
 *   carry the merged title/decision fields.
 * @returns {Array<{ id: string, type: string, attrs: Record<string, unknown> }>}
 *   Decision fold nodes, newest-first, after dedup/supersession.
 */
export function readOrderedDecisionsFromFold(fold, _events) {
  // 1. Collect and sort decision nodes newest-first by _ord
  const decisionNodes = fold.nodes.filter((n) => n.type === 'decision')

  const sorted = decisionNodes.slice().sort((a, b) => {
    const aOrd = typeof a.attrs._ord === 'number' ? a.attrs._ord : 0
    const bOrd = typeof b.attrs._ord === 'number' ? b.attrs._ord : 0
    return bOrd - aOrd
  })

  // 2. Convert fold nodes to event-like pseudo-events for the dedup engine.
  //    The fold node id encodes the decision id: 'decision:D-1' → 'D-1' (structured),
  //    'decision:_legacy_ord_N' → null (legacy, id-less).
  const decisionLikes = sorted.map((node) => {
    const rawId = node.id.replace(/^decision:/, '')
    const isLegacy = rawId.startsWith('_legacy_ord')
    return {
      data: {
        id:        isLegacy ? null : rawId,
        supersedes: node.attrs.supersedes ?? null,
        retires:   node.attrs.retires ?? null,
        decision:  node.attrs.decision ?? null,
      },
      msg:   node.attrs.title ?? node.attrs.decision ?? null,
      _ord:  node.attrs._ord,
      _node: node,
    }
  })

  // 3. Apply dedup rules and return the surviving fold nodes.
  return _dedupeDecisionLikes(decisionLikes).map((d) => d._node)
}

/**
 * Partition a list of node ref-ids into those present in the fold and those missing.
 *
 * Presence is checked against nodes of the specified type in fold.nodes.  The caller
 * is responsible for using the correct id form (e.g. 'decision:D-1', 'ac:AC1').
 *
 * @param {{ nodes: Array<{ id: string, type: string, attrs: Record<string, unknown> }> }} fold
 * @param {string[]} refIds   — ids to validate
 * @param {'decision' | 'ac' | 'acceptance-criterion' | string} nodeType
 *   Node type to match against.  Use 'acceptance-criterion' (the canonical fold type)
 *   or the shorthand 'ac' (the helper maps it to 'acceptance-criterion').
 * @returns {{ valid: string[], missing: string[] }}
 */
export function validateFoldRefs(fold, refIds, nodeType) {
  // Convenience alias: callers may pass 'ac' for acceptance-criterion nodes.
  const resolvedType = nodeType === 'ac' ? 'acceptance-criterion' : nodeType

  const presentIds = new Set(
    fold.nodes.filter((n) => n.type === resolvedType).map((n) => n.id)
  )

  const valid = []
  const missing = []
  for (const id of refIds) {
    ;(presentIds.has(id) ? valid : missing).push(id)
  }
  return { valid, missing }
}

/**
 * Extract AC coverage from a fold graph.
 *
 * Returns a Map keyed by fold node id ('ac:<ac-label>') → { ac, covering? }.
 *   ac       — the AC label stored in the node's attrs (e.g. 'AC1')
 *   covering — the covering array from an AC_COVERAGE declaration event, or
 *              undefined when no declaration form was emitted for this AC.
 *
 * Note: the covering field here reflects declaration-form events ({ ac, covering: [] })
 * stored directly on the AC node.  Coverage relationships from slice events ({ ac, slice })
 * are stored as 'covers_ac' edges in fold.edges — consult those when you need full
 * slice-to-AC associations.
 *
 * @param {{ nodes: Array<{ id: string, type: string, attrs: Record<string, unknown> }>, edges: object[], attrs: object }} fold
 * @returns {Map<string, { ac: unknown, covering?: unknown }>}
 */
export function extractACCoverageFromFold(fold) {
  const result = new Map()
  for (const node of fold.nodes) {
    if (node.type === 'acceptance-criterion') {
      result.set(node.id, {
        ac:       node.attrs.ac,
        covering: node.attrs.covering,
      })
    }
  }
  return result
}
