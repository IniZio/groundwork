// Type declarations for journal-order.mjs

/**
 * Read and merge all JSONL shards under `journalDir` into a stable total order.
 * Events are annotated with a per-motive `.ord` field (1-based ordinal).
 * Optionally filtered to a single motive via `opts.motive`.
 *
 * @param journalDir - Absolute path to the journal directory.
 * @param opts.motive - Optional motive slug to filter to.
 * @returns `{ events, malformed_lines }` — events sorted in canonical order.
 */
export declare function readOrderedEvents(
  journalDir: string,
  opts?: { motive?: string }
): { events: object[]; malformed_lines: number }
