// check-comments-exempt — hook lib; projection logic with inline contracts
/**
 * motive-graph-project.mjs — Consumer-equivalence projector for the motive DAG fold.
 *
 * Given a folded graph { schema_version, motive, nodes[], edges[], attrs } produced
 * by assembleGraphFold(), projects out the load-bearing consumer fields in the same
 * shape compile() produces under agent.*:
 *
 *   objective          — string | null
 *   decision_log       — array of keyed ADR entries (no legacy decisions)
 *   ac_coverage        — { met: [], unmet: [] } with same shape as compile()
 *   last_pause         — { pointer, summary, next_actions } or null
 *   baselines          — [{ name, shard }] (reconstructible fields only)
 *   legacy_decisions_count — number of decision nodes excluded (no-id decisions)
 *
 * Purity contract (mirrors motive-graph-fold.mjs):
 *   - No node:fs / node:child_process imports.
 *   - No wall-clock access, no random, no process globals.
 *   - Deterministic for a fixed fold graph.
 *
 * Fields compile() produces that are NOT reconstructible from fold alone:
 *   decision_log[].slices     — requires ledger ground truth (empty on both sides
 *                               when compile() is called without groundTruth)
 *   baselines[].line          — shard line offset not stored in fold
 *
 * Fields that WERE non-reconstructible and are NOW reconstructible (stored in fold node attrs):
 *   decision_log[].ord        — stored as node.attrs._ord (first-event semantics)
 *   decision_log[].ts         — stored as node.attrs._ts (first-event semantics)
 *   baselines[].ord           — stored as node.attrs._ord (first-event semantics)
 *   baselines[].ts            — stored as node.attrs._ts (first-event semantics)
 *
 * Implements S5 consumer-equivalence harness (D-7, R-006, R-007).
 */

/**
 * Fields compile() produces that cannot be reconstructed from the fold graph alone.
 * These are genuine non-reconstructible fields — the equivalence test reports them
 * as findings rather than hiding them by narrowing the compared field set.
 *
 * Note: decision_log[].title is reconstructible when the events array is passed as
 * the second argument to projectFoldGraph() — the first-seen non-null title/decision
 * per id is recovered from the event stream, avoiding fold's lossy Object.assign merge.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const NON_RECONSTRUCTIBLE_FIELDS = Object.freeze({
  'decision_log[].slices': 'Requires ledger ground truth; empty on both sides without groundTruth',
  'baselines[].line':      'Shard line offset not stored in fold',
})

/**
 * projectFoldGraph(foldGraph, opts) — pure projection from fold graph to consumer view.
 *
 * @param {{ schema_version: number, motive: string, nodes: object[], edges: object[], attrs: object }} foldGraph
 *   Output of assembleGraphFold().
 * @param {{ events?: object[] }} [opts]
 *   Optional: pass the original ordered events array to enable merge-lossy title recovery.
 *   When provided, the projector derives each decision's title from the first-seen non-null
 *   title-or-decision field in the event stream — replicating compile()'s non-null guard
 *   against fold's lossy Object.assign merge (which overwrites attrs.title with undefined
 *   when a subsequent DECISION event omits the field). Without events, title falls back to
 *   fold attrs which may be undefined for multi-event merged decisions.
 * @returns {{
 *   objective: string | null,
 *   decision_log: object[],
 *   ac_coverage: { met: object[], unmet: object[] },
 *   last_pause: object | null,
 *   baselines: object[],
 *   legacy_decisions_count: number,
 * }}
 */
export function projectFoldGraph(foldGraph, { events } = {}) {
  const { nodes, edges, attrs } = foldGraph

  // ── 0. title recovery from events (replicates compile()'s non-null-guard semantics) ──
  // fold's handleDecision uses Object.assign which clobbers existing attrs.title
  // with undefined when a subsequent DECISION event omits the title/decision field.
  // compile() uses non-null guards:
  //   first-seen:  existing.title = d.title ?? d.decision ?? null
  //   subsequent:  if (d.title != null) existing.title = d.title
  //                else if (d.decision != null) existing.title = d.decision
  // When events are provided, we replay this exact logic per decision id so that
  // fold's lossy merge (undefined-clobber) is corrected by the event-stream truth.
  /** @type {Map<string, string|null> | null} */
  const titleFromEvents = events != null ? new Map() : null
  if (titleFromEvents != null) {
    for (const ev of events) {
      if (ev.type !== 'DECISION') continue
      const d = ev.data ?? {}
      const id = d.id
      if (id == null || String(id).startsWith('_legacy_ord')) continue
      const key = String(id)
      if (!titleFromEvents.has(key)) {
        // First event: initialize with ?? fallback (mirrors compile's initial assignment)
        titleFromEvents.set(key, d.title ?? d.decision ?? null)
      } else {
        // Subsequent events: update only when new non-null value present (mirrors compile's guard)
        if (d.title != null) titleFromEvents.set(key, d.title)
        else if (d.decision != null) titleFromEvents.set(key, d.decision)
      }
    }
  }

  // ── 1. objective ────────────────────────────────────────────────────────────
  const objNode = nodes.find((n) => n.id === 'objective:root')
  const objective = objNode?.attrs?.objective ?? null

  // ── 2. decision_log — keyed decisions only ──────────────────────────────────
  // Legacy DECISION events (no `id`) produce nodes with id `decision:_legacy_ord...`
  // compile() routes these to agent.decisions (not decision_log), so we exclude them.
  const keyedDecisionNodes = []
  const legacyDecisionNodes = []
  for (const n of nodes) {
    if (n.type !== 'decision') continue
    if (n.id.startsWith('decision:_legacy_ord')) {
      legacyDecisionNodes.push(n)
    } else {
      keyedDecisionNodes.push(n)
    }
  }

  // Derive superseded_by from supersedes/retires chains across keyed decision nodes.
  // compile() derives superseded_by on first-seen targets, then again on update events.
  // Since fold stores the FINAL merged attrs per node, we can reconstruct from
  // the complete node set: if node A has attrs.supersedes === 'B', then B.superseded_by === A.id.
  // Same logic applies for attrs.retires.
  // Note: compile() only sets superseded_by when the target ALREADY exists in the map;
  // forward references leave compile()'s superseded_by null while our scan finds them.
  // This is a genuine divergence if it occurs — the test reports it.
  const supersededBy = new Map()
  for (const n of keyedDecisionNodes) {
    const attrs_n = n.attrs
    const nodeId = attrs_n.id ?? n.id.replace(/^decision:/, '')
    if (attrs_n.supersedes != null) {
      // n supersedes another → that other is superseded_by n
      supersededBy.set(String(attrs_n.supersedes), nodeId)
    }
    if (attrs_n.retires != null) {
      // n retires another → that other is superseded_by n
      supersededBy.set(String(attrs_n.retires), nodeId)
    }
  }

  const decision_log = keyedDecisionNodes.map((n) => {
    const a = n.attrs
    const id = a.id ?? n.id.replace(/^decision:/, '')
    // Derive effective status: if this decision is superseded by another, override to 'superseded'.
    // compile() does this in-place when processing the superseding decision's event; fold stores
    // the target's own status from its own events unchanged.
    const effectiveStatus = supersededBy.has(String(id)) ? 'superseded' : (a.status ?? 'proposed')
    // Recover title: when events provided, use compile()-equivalent last-non-null-write
    // per id (avoids fold's merge-lossy Object.assign clobbering of earlier values).
    // Falls back to fold attrs (correct when the last write was non-null).
    const title = titleFromEvents != null
      ? (titleFromEvents.get(String(id)) ?? null)
      : (a.title ?? a.decision ?? null)
    return {
      id,
      status: effectiveStatus,
      title,
      decision: a.decision ?? null,
      rationale: a.rationale ?? null,
      alternatives: Array.isArray(a.alternatives) ? a.alternatives : [],
      // ord and ts are now reconstructible from fold node attrs (first-event semantics).
      ord: a._ord ?? null,
      ts: a._ts ?? null,
      supersedes: a.supersedes ?? null,
      superseded_by: supersededBy.get(String(id)) ?? a.superseded_by ?? null,
      resolves: a.resolves ?? null,
      retires: a.retires ?? null,
      revises: a.revises ?? null,
      // slices is non-reconstructible without ledger ground truth
      slices: [],
    }
  })

  // Sort by first-event ord (tie-break ts) to replicate compile()'s insertion order.
  // This ordering is graph-only — no events array is required.
  decision_log.sort((a, b) => {
    const ao = a.ord ?? Infinity
    const bo = b.ord ?? Infinity
    if (ao !== bo) return ao - bo
    const at = a.ts ?? ''
    const bt = b.ts ?? ''
    return at < bt ? -1 : at > bt ? 1 : 0
  })

  // ── 3. ac_coverage ─────────────────────────────────────────────────────────
  // Reconstruct from covers_ac edges + _completed_at on slice nodes.
  // compile() uses composite "${session_id}::${slice_id}" keys for session-scoped
  // completion; fold slice nodes carry _completed_at directly. Since we have no
  // ledger ground truth here, ledgerFound = false — mirrors compile(events, {})
  // behavior with no groundTruth injected.

  // Build AC → set of covering bare slice ids from covers_ac edges
  const acCoverageMap = new Map()
  for (const e of edges) {
    if (e.kind !== 'covers_ac') continue
    const acId = e.to.replace(/^ac:/, '')
    const sliceId = e.from.replace(/^slice:/, '')
    if (!acCoverageMap.has(acId)) acCoverageMap.set(acId, new Set())
    acCoverageMap.get(acId).add(sliceId)
  }

  // Also seed ACs that appear as acceptance-criterion nodes (may have no covering slices yet)
  for (const n of nodes) {
    if (n.type !== 'acceptance-criterion') continue
    const acId = n.attrs.ac ?? n.id.replace(/^ac:/, '')
    if (!acCoverageMap.has(acId)) acCoverageMap.set(acId, new Set())
    // Declaration form: { ac, covering: [] } — those slice ids go in covering
    if (Array.isArray(n.attrs.covering)) {
      for (const s of n.attrs.covering) {
        if (s != null) acCoverageMap.get(acId).add(String(s))
      }
    }
  }

  // Map<slice_id, node> for completion check
  const sliceNodesMap = new Map()
  for (const n of nodes) {
    if (n.type === 'slice') sliceNodesMap.set(n.id.replace(/^slice:/, ''), n)
  }

  // Mirror compile()'s sort: ascending numeric for AC-N, lexicographic otherwise
  const acKeys = [...acCoverageMap.keys()].sort((a, b) => {
    const na = parseInt(a.replace(/^AC/, ''), 10)
    const nb = parseInt(b.replace(/^AC/, ''), 10)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    return a < b ? -1 : a > b ? 1 : 0
  })

  const acMet = []
  const acUnmet = []
  const ledgerFound = false // no ground truth injected → mirrors compile(events, {})
  for (const acId of acKeys) {
    const covering = [...acCoverageMap.get(acId)]
    const missing = covering.filter((sliceId) => {
      const sn = sliceNodesMap.get(sliceId)
      return !sn || !sn.attrs._completed_at
    })
    const isMet = covering.length > 0 && missing.length === 0
    // Mirror compile()'s status_unknown: !ledgerFound && covering.length > 0 && !isMet
    const status_unknown = !ledgerFound && covering.length > 0 && !isMet
    const entry = { id: acId, covering, missing, met: isMet, status_unknown }
    if (isMet) { acMet.push(entry) } else { acUnmet.push(entry) }
  }
  const ac_coverage = { met: acMet, unmet: acUnmet }

  // ── 4. last_pause ───────────────────────────────────────────────────────────
  // compile() stores { pointer, summary, next_actions } — no ts field.
  // fold stores { ts, pointer, summary, next_actions } in attrs.pauses[].
  // Project the last pause entry and strip ts.
  const lastPauseRaw = Array.isArray(attrs.pauses) ? attrs.pauses.at(-1) : null
  const last_pause = lastPauseRaw
    ? {
        pointer:     lastPauseRaw.pointer ?? null,
        summary:     lastPauseRaw.summary ?? null,
        next_actions: Array.isArray(lastPauseRaw.next_actions) ? lastPauseRaw.next_actions : [],
      }
    : null

  // ── 5. baselines ────────────────────────────────────────────────────────────
  // compile() stores { name, ord, ts, shard, line }; line is non-reconstructible.
  // ord and ts are now reconstructible from fold node attrs (_ord, _ts).
  const baselines = nodes
    .filter((n) => n.type === 'baseline')
    .map((n) => ({
      name: n.attrs.name ?? null,
      shard: n.attrs.shard ?? null,
      ord: n.attrs._ord ?? null,
      ts: n.attrs._ts ?? null,
    }))

  return {
    objective,
    decision_log,
    ac_coverage,
    last_pause,
    baselines,
    legacy_decisions_count: legacyDecisionNodes.length,
  }
}
