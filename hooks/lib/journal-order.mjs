// check-comments-exempt — hook lib; ordering invariants documented inline
/**
 * journal-order.mjs — ordered event reader for the motive compiler (Step 3).
 *
 * Exports `readOrderedEvents(journalDir, opts)` which returns all journal events
 * in a deterministic total order: ts → shard filename → line offset.
 *
 * This is a NEW module.  hooks/lib/journal-io.mjs is NOT modified; `journal
 * show` and `journal digest` keep their existing behaviour (F3, D3).
 *
 * Total order guarantee: (shard, line) is unique per physical line, so no two
 * events can tie on all three keys.  Same-millisecond events from parallel
 * hooks therefore land in a stable, deterministic sequence.
 *
 * ord is assigned AFTER motive filtering, 1..N over the motive-scoped stream.
 * It is a derived ordinal, never a stored field.  It is snapshot-relative:
 * a future out-of-order event can shift later ords (D3, documented, not hidden).
 */

import { readdirSync, readFileSync } from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Return the event motive.  Canonical key is `motive`. */
function eventMotive(e) {
  return e.motive
}

/**
 * Three-key total-order comparator.
 * Priority: ts (lexicographic ISO-8601) → shard filename → line offset.
 * (shard, line) is unique, so this never returns 0 for two distinct events.
 *
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
function compareEvents(a, b) {
  const ta = a._order._ts ?? ''
  const tb = b._order._ts ?? ''
  if (ta < tb) return -1
  if (ta > tb) return 1

  const sa = a._order.shard
  const sb = b._order.shard
  if (sa < sb) return -1
  if (sa > sb) return 1

  return a._order.line - b._order.line
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read every .jsonl shard under journalDir, parse each line, apply an optional
 * motive filter, sort by (ts, shard, line), and assign 1-based `ord` values.
 *
 * Each returned event has:
 *   - `_order: { shard, line }` — provenance triple (shard filename, 0-based
 *     physical line offset counting blank and malformed lines).
 *   - `ord` — 1..N ordinal within the motive-scoped ordered stream.
 *
 * The function also returns `malformed_lines` (total across all shards) so
 * callers can surface it in `provenance.malformed_lines` (P-B: fail loudly).
 *
 * @param {string} journalDir
 * @param {{ motive?: string }} [opts]
 * @returns {{ events: object[], malformed_lines: number }}
 */
export function readOrderedEvents(journalDir, { motive } = {}) {
  // --- 1. Sorted shard discovery (F3 fix: explicit .sort()) ---
  let shardFiles
  try {
    shardFiles = readdirSync(journalDir)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
  } catch {
    return { events: [], malformed_lines: 0 }
  }

  // --- 2. Parse lines, tag with (shard, line), count malformed ---
  const tagged = []
  let malformed_lines = 0

  for (const shard of shardFiles) {
    const fp = path.join(journalDir, shard)
    let text
    try {
      text = readFileSync(fp, 'utf8')
    } catch {
      continue
    }

    const rawLines = text.split('\n')
    for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
      const raw = rawLines[lineIdx]
      const trimmed = raw.trim()
      if (!trimmed) continue   // blank — counts toward physical offset but no event

      let evt
      try {
        evt = JSON.parse(trimmed)
      } catch {
        malformed_lines++
        continue  // malformed — counted, not swallowed (P-B)
      }

      // Tag with provenance.  _ts is stored on _order for comparator access
      // without touching the event's own ts field.
      evt._order = { shard, line: lineIdx, _ts: evt.ts ?? '' }
      tagged.push(evt)
    }
  }

  // --- 3. Total-order sort (ts → shard → line) ---
  tagged.sort(compareEvents)

  // --- 4. Motive filter (BEFORE ord assignment — D3) ---
  const filtered = motive != null
    ? tagged.filter(e => eventMotive(e) === motive)
    : tagged

  // --- 5. Assign 1-based ord over motive-scoped stream ---
  for (let i = 0; i < filtered.length; i++) {
    filtered[i].ord = i + 1
  }

  // Strip the internal _ts field from _order so callers only see {shard, line}
  for (const e of filtered) {
    const { shard, line } = e._order
    e._order = { shard, line }
  }

  return { events: filtered, malformed_lines }
}
