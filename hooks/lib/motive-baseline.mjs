// check-comments-exempt — hook lib; baseline comparison with dense invariants
/**
 * motive-baseline.mjs — Pure baseline resolver.
 *
 * Scans a motive event stream for BASELINE events and resolves a name to its
 * pin record. Latest occurrence wins on duplicate names.
 *
 * PURITY CONTRACT: Zero imports. No filesystem access, no Date.now(), no
 * process.*. Real logic lands in S4; this file exports the frozen signature.
 *
 * Exported signatures (frozen in S0):
 *
 *   resolveBaseline(events, name) → { name, ord, ts, shard } | null
 *     Scans events (pre-filtered, sorted array as produced by readOrderedEvents)
 *     for BASELINE events matching data.name === name. Returns the pin for the
 *     latest (highest ord) match, or null when no match is found, the stream is
 *     empty, or a BASELINE event has no data.name.
 *
 *     Pin shape:
 *       name  — string, the baseline name as recorded in data.name
 *       ord   — number, per-motive ordinal assigned by the fold
 *       ts    — string, ISO 8601 timestamp from the event
 *       shard — string, basename of the shard file (from data.shard)
 *
 *     NOTE: `line` is intentionally absent. readAllEvents attaches no line
 *     provenance to events and appendEvent never reads the file, so a line
 *     number is not recoverable at either read or write time (D2 in the plan).
 */

// ---------------------------------------------------------------------------
// Implementation — S4.
// ---------------------------------------------------------------------------

/**
 * Resolve a baseline name to its pin record.
 *
 * Scans the ordered event stream for BASELINE events whose data.name matches
 * `name`. When multiple matches exist (duplicate names), the latest — highest
 * `ord` — wins. Returns null for unknown names, empty streams, or BASELINE
 * events with no data.name. Never throws.
 *
 * @param {Array<object>} events  Ordered, ord-annotated event array as
 *   produced by readOrderedEvents (each event has `.ord` already assigned).
 * @param {string} name           Baseline name to look up.
 * @returns {{ name: string, ord: number, ts: string, shard: string } | null}
 */
export function resolveBaseline(events, name) {
  if (!Array.isArray(events) || events.length === 0) return null

  let best = null

  for (const event of events) {
    if (event.type !== 'BASELINE') continue
    const dname = event.data?.name
    if (typeof dname !== 'string' || dname !== name) continue

    const ord = event.ord
    const ts = event.ts
    const shard = event.data?.shard

    // Require ord and ts to be meaningful; shard may be absent on hand-crafted
    // events but the plan states it is recorded at write time.
    if (typeof ord !== 'number' || typeof ts !== 'string') continue

    if (best === null || ord > best.ord) {
      best = { name: dname, ord, ts, shard: typeof shard === 'string' ? shard : '' }
    }
  }

  return best
}

// ---------------------------------------------------------------------------
// Helper: list all unique baseline names present in the event stream.
// Used by callers (e.g. the CLI) to surface valid names when a lookup fails.
// ---------------------------------------------------------------------------

/**
 * Return the de-duplicated list of baseline names in the event stream.
 * Order matches first appearance. Never throws.
 *
 * @param {Array<object>} events
 * @returns {string[]}
 */
export function listBaselineNames(events) {
  if (!Array.isArray(events)) return []
  const seen = new Set()
  for (const event of events) {
    if (event.type !== 'BASELINE') continue
    const dname = event.data?.name
    if (typeof dname === 'string') seen.add(dname)
  }
  return [...seen]
}
