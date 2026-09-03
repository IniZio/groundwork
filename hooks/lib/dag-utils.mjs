// check-comments-exempt
/**
 * dag-utils.mjs — Pure-function DAG utilities for groundwork run-ledger slices.
 *
 * All functions are pure, deterministic, and side-effect-free. No I/O, no
 * imports from other groundwork modules. Input slices are plain objects; this
 * module does not mutate them.
 *
 * ## Dangling-edge policy
 * A "dangling edge" is a blocked_by reference to an id that does not appear in
 * the slices array. Each function documents its own handling:
 *
 *   topoLayers       — dangling references are IGNORED (treated as absent).
 *                      The slice's in-degree is not incremented for a blocker
 *                      that doesn't exist, so it may appear in an earlier layer
 *                      than it would if the blocker were present.
 *   frontier         — dangling references count as UNSATISFIED. A slice whose
 *                      blocked_by contains a non-existent id will never appear
 *                      in the frontier (the id is never in the complete set).
 *                      This matches cmdFrontier behaviour in hooks/ledger.mjs.
 *   transitiveBlockers — dangling ids ARE included in the output. The function
 *                      returns every reachable blocker id, including those not
 *                      present in the slices array, because the caller may still
 *                      want to know what ids were referenced.
 *   hasCycle         — dangling references are IGNORED (same as topoLayers).
 *
 * ## Skipped-blocker policy
 * A slice with status 'skipped' is NOT in the complete set. A blocked_by
 * reference to a skipped slice therefore counts as UNSATISFIED in frontier().
 * This matches cmdFrontier, which only puts ids with status === 'complete' into
 * the complete set.
 *
 * ## Parity note (discrepancy found, reported)
 * The frontier logic in hooks/lib/motive-map.mjs diverges from cmdFrontier in
 * two observable ways:
 *   1. motive-map allows slices with status 'skipped' (or any non-complete,
 *      non-in_progress status) into the frontier; cmdFrontier requires exactly
 *      'pending'.
 *   2. motive-map does NOT exclude slices with kind === 'fog'; cmdFrontier does.
 * This module's frontier() follows cmdFrontier (the CLI command) as the
 * authoritative source. See REPORT section in the test file for detail.
 */

/**
 * @typedef {Object} Slice
 * @property {string}          id
 * @property {string[]=}       blocked_by   — ids this slice depends on
 * @property {string=}         status       — 'pending' | 'in_progress' | 'complete' | 'skipped' | …
 * @property {number|null=}    wave         — explicit wave assignment; topoLayers computes depth independently
 * @property {string=}         kind         — 'impl' | 'fog' | 'plan' | …
 * @property {string=}         claimed_by   — session id (not used by pure fns here)
 */

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalise the blocked_by field into a string array.
 * @param {Slice} s
 * @returns {string[]}
 */
function blockers(s) {
  return Array.isArray(s.blocked_by) ? s.blocked_by : []
}

// ─── exports ─────────────────────────────────────────────────────────────────

/**
 * Group slices into topological generations (Kahn's algorithm).
 *
 * Layer 0 contains slices with no blockers (or only dangling/absent blockers).
 * Each successive layer contains slices whose every in-graph blocker is in a
 * previous layer. The wave-band computation produces the canonical ordering for
 * fan-out execution.
 *
 * Dangling edges (blocker id absent from slices) are IGNORED — they do not
 * contribute in-degree. See module-level dangling-edge policy.
 *
 * If the graph contains a cycle, the slices involved in the cycle are not
 * assigned to any layer (they retain positive in-degree after the pass).
 * Use hasCycle() to detect this case before relying on completeness.
 *
 * @param {Slice[]} slices
 * @returns {string[][]}  Ordered array of layers; each layer is an array of slice ids.
 */
export function topoLayers(slices) {
  if (!Array.isArray(slices) || slices.length === 0) return []

  const idSet = new Set(slices.map((s) => s.id))

  // in-degree counts only edges to existing nodes
  /** @type {Map<string, number>} */
  const inDegree = new Map(slices.map((s) => [s.id, 0]))
  // successors: blocker → [slices it unblocks]
  /** @type {Map<string, string[]>} */
  const successors = new Map(slices.map((s) => [s.id, []]))

  for (const s of slices) {
    for (const bId of blockers(s)) {
      if (!idSet.has(bId)) continue // dangling — ignore
      const prevDeg = inDegree.get(s.id) ?? 0
      inDegree.set(s.id, prevDeg + 1)
      const sucList = successors.get(bId)
      if (sucList) sucList.push(s.id)
    }
  }

  const layers = []
  let queue = [...inDegree.entries()]
    .filter(([, d]) => d === 0)
    .map(([id]) => id)

  while (queue.length > 0) {
    layers.push([...queue])
    const next = []
    for (const id of queue) {
      const sucList = successors.get(id) ?? []
      for (const childId of sucList) {
        const newDeg = (inDegree.get(childId) ?? 0) - 1
        inDegree.set(childId, newDeg)
        if (newDeg === 0) next.push(childId)
      }
    }
    queue = next
  }

  return layers
}

/**
 * Return pending slices whose every blocked_by entry has status 'complete'.
 *
 * Semantics match cmdFrontier in hooks/ledger.mjs, minus the session-specific
 * claimed_by filter (which cannot be expressed as a pure function):
 *   - Only slices with status exactly 'pending' (default when absent).
 *   - Slices with kind === 'fog' are excluded.
 *   - A blocker with status 'skipped' does NOT count as satisfied.
 *   - Dangling blockers (id not present in slices) count as UNSATISFIED.
 *
 * @param {Slice[]} slices
 * @returns {Slice[]}
 */
export function frontier(slices) {
  if (!Array.isArray(slices)) return []

  const completeIds = new Set(
    slices.filter((s) => s?.status === 'complete').map((s) => s.id),
  )

  return slices.filter((s) => {
    if (!s) return false
    const status = s.status ?? 'pending'
    if (status !== 'pending') return false
    if (s.kind === 'fog') return false
    return blockers(s).every((dep) => completeIds.has(dep))
  })
}

/**
 * Return the full transitive closure of what blocks a given slice.
 *
 * Follows blocked_by edges recursively. Terminates even in the presence of
 * cycles (visited-set guard). Dangling ids (not present in slices) ARE
 * included in the result — see module-level dangling-edge policy.
 *
 * @param {Slice[]} slices
 * @param {string}  id      — the slice to start from
 * @returns {string[]}  All blocker ids reachable from id (excluding id itself).
 */
export function transitiveBlockers(slices, id) {
  if (!Array.isArray(slices)) return []

  const sliceMap = new Map(slices.map((s) => [s.id, s]))
  /** @type {Set<string>} */
  const result = new Set()
  const stack = [id]

  while (stack.length > 0) {
    const current = /** @type {string} */ (stack.pop())
    const s = sliceMap.get(current)
    for (const bId of s ? blockers(s) : []) {
      if (!result.has(bId)) {
        result.add(bId)
        stack.push(bId)
      }
    }
  }

  return [...result]
}

/**
 * Detect whether the dependency graph contains a cycle.
 *
 * Uses Kahn's algorithm: after processing, any node with remaining positive
 * in-degree is part of a cycle. Returns false for valid DAGs (including empty
 * input and single nodes). Dangling edges are IGNORED.
 *
 * @param {Slice[]} slices
 * @returns {boolean}
 */
export function hasCycle(slices) {
  if (!Array.isArray(slices) || slices.length === 0) return false
  const layers = topoLayers(slices)
  const assigned = new Set(layers.flat())
  return slices.some((s) => !assigned.has(s.id))
}
