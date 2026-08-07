/**
 * Groundwork journal I/O — append-only JSONL shards per session.
 *
 * Concurrency contract (AC 4):
 *   appendEvent() opens the shard with 'a' (O_WRONLY | O_CREAT | O_APPEND) and
 *   issues a single writeSync() call for the complete JSON line + newline.
 *   On Linux (and POSIX generally) O_APPEND writes to a regular file are atomic:
 *   the kernel holds the inode lock while it seeks to EOF and writes, so two
 *   concurrent appenders cannot interleave partial lines.  Each event is
 *   serialized to a Buffer before the fd is opened, so the write is a single
 *   syscall with no read-modify-write and no partial-line risk.
 *
 * Evolution contract (no-seq decision, Step 2):
 *   Events are ordered by `ts` (ISO 8601 UTC string sort — lexicographic ==
 *   chronological).  No `seq` field is written: a monotonic counter would
 *   require read-modify-write of a shared counter, destroying the single-syscall
 *   atomicity guarantee.  The correct sort order is `ts`; ties are resolved by
 *   insertion order within a shard (stable sort).
 *
 *   Extension contract: new optional keys may be added at any time.  Keys must
 *   never be removed or repurposed while events exist in the stream.  If a
 *   genuinely breaking change is ever needed, run `journal compile` over the
 *   shard directory to rewrite events.
 *
 *   Motive-only schema (2026-08-03 user decision):
 *   `emitHookEvent` writes ONLY the `motive` key.  No `rfc` mirror is written.
 *   The `--rfc` CLI alias is removed from journal.mjs.  Existing shards that
 *   carry only an `rfc` key become invisible to `--motive` filters — accepted.
 *
 *   New event types (S0, 2026-08-03):
 *   MOTIVE_CREATED — emitted once when `journal motive new` creates a charter.
 *     data: { objective: string }
 *     (objective text so `compile --at <n>` can render it without file access)
 *   BASELINE — emitted by `journal baseline <name>` to pin a point in time.
 *     data: { name: string, shard: string }
 *     (shard is the basename returned by resolveShardPath at write time;
 *      ord is assigned by the fold as the per-motive ordinal)
 *
 * `msg` field contract:
 *   `msg` is OPTIONAL on hook-written events (emitHookEvent does not require it;
 *   some event types carry no human-readable summary).  The journal-append CLI
 *   (journal.mjs cmdAppend) still requires --msg for human-authored entries.
 *   Step-3 compiler implementations must treat `msg` as nullable.
 */

import {
  closeSync, mkdirSync, openSync, readdirSync,
  readFileSync, writeSync,
} from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const VALID_TYPES = [
  'DECISION',
  'SPEC_CHANGE',
  'LINT_DRIFT',
  'PROTOTYPE_RESULT',
  'FAILURE',
  'MILESTONE',
  'TASK_COMPLETE',
  'GATE',
  'VERIFICATION',
  'WAIVER',
  'HANDOFF',
  'PAUSE',
  'SESSION_START',
  'SPEC_DRIFT',
  'SESSION_END',
  'MOTIVE_CREATED',
  'BASELINE',
  /**
   * AC_COVERAGE — two payload forms:
   *   Coverage form:    { ac, slice }          — emitted by `ledger complete` for each
   *                                               (slice, AC) pair when the completed slice
   *                                               declares `covers_ac` coverage.
   *   Declaration form: { ac, covering: [] }   — emitted by `migrate` for ACs that are
   *                                               declared in feature.yaml with an empty
   *                                               covering array (unmet-empty / invisible
   *                                               missing slice class). Registers the AC
   *                                               in the fold with zero slices so it
   *                                               appears as unmet in the compiled view.
   * Never compressed: coverage facts must survive any digest pass.
   */
  'AC_COVERAGE',
]

/** Types that must never be folded into a digest summary (AC 9). */
export const NEVER_COMPRESS = new Set(['DECISION', 'SPEC_CHANGE', 'MOTIVE_CREATED', 'BASELINE', 'AC_COVERAGE'])

// ---------------------------------------------------------------------------
// Motive normalization (Step 2 dual-key back-compat)
// ---------------------------------------------------------------------------

/**
 * Return the motive id for an event.
 * Canonical key is `motive`.
 * @param {object} e
 * @returns {string|undefined}
 */
export function eventMotive(e) {
  return e.motive
}

/**
 * Resolve the current motive id through a 4-step chain:
 *   1. env GROUNDWORK_MOTIVE           (explicit override / test injection)
 *   2. ledger.motive                   (written by `ledger init` — via JSON input or --motive flag)
 *   3. ledger.rfc_ref                  (today's de-facto objective pointer)
 *   4. "session:<sessionId>"           (synthetic — ALWAYS resolves)
 *
 * Returns `{ motive: string, provenance: string }`.
 * Never throws; never returns null.  Callers may pass a pre-loaded ledger
 * object to avoid a second file read.
 *
 * @param {{ projectDir?: string, sessionId?: string, ledger?: object|null }} opts
 * @returns {{ motive: string, provenance: string }}
 */
export function resolveMotive({ projectDir, sessionId, ledger } = {}) {
  // Step 1: explicit env override
  if (process.env.GROUNDWORK_MOTIVE) {
    return { motive: process.env.GROUNDWORK_MOTIVE, provenance: 'env' }
  }

  // Steps 2+3: try ledger fields (use supplied ledger, or read from disk)
  let l = ledger
  if (l === undefined) {
    // Try to load the active ledger from disk without throwing.
    const dir = projectDir ?? process.cwd()
    l = null
    // Try legacy run.json first (common in tests and shorter sessions)
    try {
      l = JSON.parse(readFileSync(path.join(dir, '.groundwork', 'run.json'), 'utf8'))
    } catch { l = null }
    // If not active, look for a session-matching file under runs/
    if (!l?.active) {
      let files = []
      try { files = readdirSync(path.join(dir, '.groundwork', 'runs')) } catch { /* none */ }
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        try {
          const candidate = JSON.parse(
            readFileSync(path.join(dir, '.groundwork', 'runs', f), 'utf8'),
          )
          if (candidate.active && (!sessionId || candidate.session_id === sessionId)) {
            l = candidate; break
          }
        } catch { /* skip malformed */ }
      }
    }
  }

  if (l?.motive) return { motive: l.motive, provenance: 'ledger.motive' }
  if (l?.rfc_ref) return { motive: l.rfc_ref, provenance: 'ledger.rfc_ref' }

  // Step 4: synthetic fallback — never null, never throws
  const sid = sessionId ?? 'unknown'
  return { motive: `session:${sid}`, provenance: 'synthetic' }
}

/**
 * Emit a hook event to the journal.  Never throws; returns `{ ok: boolean }`.
 * On failure: exactly one stderr line, zero stdout bytes.
 * On success: zero stdout bytes (stdout must remain clean for hook JSON output).
 *
 * Writes ONLY `motive` (no `rfc` key — motive-only schema per 2026-08-03 decision).
 *
 * @param {{
 *   projectDir: string,
 *   sessionId:  string,
 *   type:       string,
 *   msg:        string,
 *   source:     string,
 *   data?:      object,
 *   ledger?:    object|null,
 *   date?:      string,
 * }} opts
 * @returns {{ ok: boolean, motive?: string, provenance?: string, error?: string }}
 */
export function emitHookEvent(opts = {}) {
  const {
    projectDir, sessionId, type, msg, source,
    data, ledger, date,
  } = opts

  try {
    if (!VALID_TYPES.includes(type)) {
      process.stderr.write(
        `journal: emitHookEvent: invalid type "${type}" — event not written\n`,
      )
      return { ok: false, error: `invalid type: ${type}` }
    }

    const { motive, provenance } = resolveMotive({ projectDir, sessionId, ledger })
    const ts = new Date().toISOString()
    const event = {
      ts,
      session: sessionId ?? 'unknown',
      motive,  // canonical; rfc key not written (2026-08-03 user decision)
      type,
      msg,
      source,
    }
    if (data !== undefined) event.data = { ...data, motive_provenance: provenance }

    const shardPath = resolveShardPath(projectDir ?? process.cwd(), sessionId ?? 'unknown', date)
    appendEvent(shardPath, event)
    return { ok: true, motive, provenance }
  } catch (err) {
    process.stderr.write(
      `journal: emitHookEvent: failed to write event: ${err?.message ?? err}\n`,
    )
    return { ok: false, error: err?.message ?? String(err) }
  }
}

// ---------------------------------------------------------------------------
// Shard path resolution
// ---------------------------------------------------------------------------

const SAFE_SESSION = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Resolve the shard path for a session.
 *
 * @param {string} projectDir  Absolute project root.
 * @param {string} sessionId   Session identifier (must be path-safe).
 * @param {string} [date]      Override date (YYYY-MM-DD); defaults to today UTC.
 * @returns {string}
 */
export function resolveShardPath(projectDir, sessionId, date) {
  const safeId = SAFE_SESSION.test(sessionId ?? '') ? sessionId : 'default'
  const d = date ?? new Date().toISOString().slice(0, 10)
  return path.join(projectDir, '.groundwork', 'journal', `${d}-${safeId}.jsonl`)
}

// ---------------------------------------------------------------------------
// Append (AC 4 — O_APPEND atomic write)
// ---------------------------------------------------------------------------

/**
 * Append one event object as a JSON line to shardPath.
 * Uses O_APPEND so concurrent appenders cannot interleave.
 * Never reads the file (pure append — AC 5: no rewrite, no truncation).
 *
 * @param {string} shardPath
 * @param {object} event
 */
export function appendEvent(shardPath, event) {
  mkdirSync(path.dirname(shardPath), { recursive: true })
  // Serialize the complete line before opening the fd, keeping the window
  // between open and write as short as possible.
  const buf = Buffer.from(JSON.stringify(event) + '\n', 'utf8')
  const fd = openSync(shardPath, 'a') // O_WRONLY | O_CREAT | O_APPEND
  try {
    writeSync(fd, buf)
  } finally {
    closeSync(fd)
  }
}

// ---------------------------------------------------------------------------
// Read all shards
// ---------------------------------------------------------------------------

/**
 * Read every .jsonl shard under journalDir, parse each line, and return all
 * events sorted by ts ascending.  Malformed lines are silently skipped.
 *
 * @param {string} journalDir
 * @returns {object[]}
 */
export function readAllEvents(journalDir) {
  let files
  try {
    files = readdirSync(journalDir).filter(f => f.endsWith('.jsonl'))
  } catch {
    return []
  }

  const events = []
  for (const f of files) {
    const fp = path.join(journalDir, f)
    let text
    try { text = readFileSync(fp, 'utf8') } catch { continue }
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try { events.push(JSON.parse(trimmed)) } catch { /* skip malformed */ }
    }
  }

  events.sort((a, b) => {
    const ta = a.ts ?? ''
    const tb = b.ts ?? ''
    return ta < tb ? -1 : ta > tb ? 1 : 0
  })

  return events
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/**
 * Filter and window events.
 *
 * Defaults applied by the caller (show command), not here, so this function
 * is pure and testable without default injection.
 *
 * @param {object[]} events
 * @param {{ motive?: string, type?: string, since?: string, last?: number }} opts
 * @returns {{ shown: object[], withheld: number, total: number }}
 */
export function filterEvents(events, { motive, type, since, last } = {}) {
  let filtered = events

  if (motive != null) {
    filtered = filtered.filter(e => eventMotive(e) === motive)
  }

  if (type != null) {
    const types = new Set(type.split(',').map(t => t.trim()).filter(Boolean))
    filtered = filtered.filter(e => types.has(e.type))
  }

  if (since != null) {
    const sinceDate = parseSince(since)
    if (sinceDate) {
      filtered = filtered.filter(e => e.ts && new Date(e.ts) >= sinceDate)
    }
  }

  const total = filtered.length
  const n = last != null ? Math.max(0, last) : total
  const shown = filtered.slice(-n)
  const withheld = total - shown.length

  return { shown, withheld, total }
}

/**
 * Parse a --since value.
 *   "7d"          → Date N days ago at midnight UTC
 *   "2026-07-01"  → Date object
 *
 * @param {string} since
 * @returns {Date|null}
 */
export function parseSince(since) {
  if (!since) return null
  const rel = /^(\d+)d$/i.exec(since)
  if (rel) {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - parseInt(rel[1], 10))
    d.setUTCHours(0, 0, 0, 0)
    return d
  }
  const d = new Date(since)
  return isNaN(d.getTime()) ? null : d
}
