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
  'STEERING_UPDATE',
  'LINT_DRIFT',
  'PROTOTYPE_RESULT',
  'FAILURE',
  'MILESTONE',
  'TASK_COMPLETE',
  'GATE',
  'VERIFICATION',
  'WAIVER',
  'HANDOFF',
  'SESSION_START',
]

/** Types that must never be folded into a digest summary (AC 9). */
export const NEVER_COMPRESS = new Set(['DECISION', 'SPEC_CHANGE'])

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
 * @param {{ rfc?: string, type?: string, since?: string, last?: number }} opts
 * @returns {{ shown: object[], withheld: number, total: number }}
 */
export function filterEvents(events, { rfc, type, since, last } = {}) {
  let filtered = events

  if (rfc != null) {
    filtered = filtered.filter(e => e.rfc === rfc)
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
