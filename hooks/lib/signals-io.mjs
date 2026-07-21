/**
 * Groundwork struggle-signal store — cross-session append-only signal log at
 * `<projectDir>/.groundwork/struggle-signals.jsonl`.
 *
 * File format: newline-delimited JSON (JSONL), one complete JSON object per
 * line.  Append-only so concurrent writers never clobber each other;
 * `appendFileSync` is atomic enough for append on POSIX (O_APPEND).
 *
 * Signal schema (minimum):
 *   { ts, session_id, kind, fingerprint, detail }
 *   kind ∈ { 'repeat-command' | 'fail-retry' | 'file-thrash' | 'error-signature' }
 *
 * No external dependencies — Node built-ins only.
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Return the absolute path to the JSONL signals file for `projectDir`.
 * Creates the `.groundwork/` parent directory if it doesn't yet exist (only
 * on the append path — reads tolerate a missing file).
 */
export function resolveSignalsPath(projectDir) {
  return path.join(projectDir, '.groundwork', 'struggle-signals.jsonl')
}

/**
 * Append one signal record to the JSONL store.
 *
 * `signalObj` must at minimum include `{ ts, session_id, kind, fingerprint, detail }`.
 * The function serialises it as a single JSON line followed by `\n`.
 * Creates `.groundwork/` if missing.
 */
export function appendSignal(projectDir, signalObj) {
  const filePath = resolveSignalsPath(projectDir)
  const dir = path.dirname(filePath)
  mkdirSync(dir, { recursive: true })
  appendFileSync(filePath, `${JSON.stringify(signalObj)}\n`, 'utf8')
}

/**
 * Read all signal records from the JSONL store.
 *
 * Tolerant: a missing file returns []; a trailing partial/corrupt line (common
 * when a process is killed mid-write) is silently skipped rather than thrown.
 * Returns an array of parsed signal objects in file order.
 */
export function readSignals(projectDir) {
  const filePath = resolveSignalsPath(projectDir)
  let raw
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return []
  }
  const results = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      results.push(JSON.parse(trimmed))
    } catch {
      // Corrupt / partial trailing line — skip, don't throw.
    }
  }
  return results
}
