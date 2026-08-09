// Type declarations for signals-io.mjs

export interface Signal {
  ts: string
  session_id: string
  kind: string
  fingerprint: string
  /** Structured detail payload — shape varies per signal kind. */
  detail: { count?: number; filePath?: string; [key: string]: unknown }
  [key: string]: unknown
}

/**
 * Return the absolute path to the JSONL signals file for `projectDir`.
 */
export declare function resolveSignalsPath(projectDir: string): string

/**
 * Append one signal record to the JSONL store.
 * Creates `.groundwork/` if missing.
 */
export declare function appendSignal(projectDir: string, signalObj: object): void

/**
 * Read all signal records from the JSONL store.
 * Returns an empty array if the file is missing.
 */
export declare function readSignals(projectDir: string): Signal[]
