// Type declarations for journal-io.mjs

/** All valid event type strings. */
export declare const VALID_TYPES: string[]

/** Types that must never be folded into a digest summary. */
export declare const NEVER_COMPRESS: Set<string>

/**
 * Return the motive id for an event (reads the `motive` key).
 */
export declare function eventMotive(e: object): string | undefined

/**
 * Resolve the current motive id through a 4-step chain.
 * Never throws; never returns null.
 */
export declare function resolveMotive(opts?: {
  projectDir?: string
  sessionId?: string
  ledger?: object | null
}): { motive: string; provenance: string }

/**
 * Emit a hook event to the journal. Returns `{ ok, error? }`.
 */
export declare function emitHookEvent(opts?: {
  projectDir?: string
  sessionId?: string
  type?: string
  msg?: string
  source?: string
  data?: object
  ledger?: object
  date?: string
}): { ok: boolean; error?: string }

/**
 * Resolve the journal shard path for a given project, session, and date.
 */
export declare function resolveShardPath(projectDir: string, sessionId: string, date?: string): string

/**
 * Append one event object as a JSON line to `shardPath`.
 */
export declare function appendEvent(shardPath: string, event: object): void

/**
 * Read every .jsonl shard under `journalDir` and return all events sorted by ts ascending.
 */
export declare function readAllEvents(journalDir: string): object[]

/**
 * Filter and window an event array.
 */
export declare function filterEvents(
  events: object[],
  opts?: { motive?: string; type?: string; since?: string; last?: number }
): { shown: object[]; withheld: number; total: number }

/**
 * Parse a `--since` value ("7d" or ISO date string) into a Date.
 * Returns null for falsy or unrecognised input.
 */
export declare function parseSince(since: string): Date | null
