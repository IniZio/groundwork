/**
 * RFC I/O library — parsing, serializing, and computing digests for rfc.md files.
 *
 * Uses the `yaml` package (eemeli ≥2.8.3) for frontmatter round-trips:
 *  - parseDocument() preserves comments (required by AC 5)
 *  - doc.toString({ lineWidth: 0 }) prevents catastrophic reflow (required by AC 5)
 *
 * NO imports from hooks/lib/journal-io.mjs or hooks/lib/spec-io.mjs — those
 * are peer-agent files that may not exist yet. Journal data is read directly here.
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseDocument } from 'yaml'

// ---------------------------------------------------------------------------
// UID generation
// ---------------------------------------------------------------------------

/**
 * Generate a fresh RFC uid: R-YYYYMMDD-XXXXXX (6 uppercase alphanum suffix).
 * Uses crypto randomBytes so the suffix is never guessable.
 */
export function generateUid() {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
  // 3 random bytes → 6 hex chars → uppercase
  const suffix = randomBytes(3).toString('hex').toUpperCase()
  return `R-${dateStr}-${suffix}`
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse rfc.md content.
 * Returns { frontmatter, doc, body, rawFrontmatter }:
 *   - frontmatter: plain JS object (doc.toJS())
 *   - doc: yaml.Document (preserves comments for round-trip)
 *   - body: string — everything AFTER the closing ---\n (may be empty)
 *   - rawFrontmatter: the raw YAML string between the fences
 *
 * Throws an Error on YAML parse failure; the error includes line and col properties.
 */
export function parseFrontmatter(content) {
  // Match opening ---, YAML block, closing ---, then the rest
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) {
    const e = new Error('No valid YAML frontmatter delimiters (---) found')
    e.line = null
    e.col = null
    throw e
  }
  const rawFrontmatter = match[1]
  const body = match[2] || ''

  const doc = parseDocument(rawFrontmatter, { keepSourceTokens: true })

  if (doc.errors && doc.errors.length > 0) {
    const err = doc.errors[0]
    // err.pos is [start, end] byte offsets into the source string
    const offset = Array.isArray(err.pos) ? err.pos[0] : 0
    const before = rawFrontmatter.slice(0, offset)
    const lineNum = before.split('\n').length
    const col = before.length - before.lastIndexOf('\n')
    const e = new Error(`YAML parse error at line ${lineNum}, column ${col}: ${err.message}`)
    e.line = lineNum
    e.col = col
    throw e
  }

  return { frontmatter: doc.toJS(), doc, body, rawFrontmatter }
}

// ---------------------------------------------------------------------------
// Frontmatter serialization (AC 4 + AC 5)
// ---------------------------------------------------------------------------

/**
 * Serialize a yaml.Document back to a full rfc.md string.
 *
 * AC 4: body (everything after the closing fence) is passed through unchanged.
 * AC 5: lineWidth: 0 prevents reflow; doc.toString() preserves comments.
 *
 * @param {import('yaml').Document} doc
 * @param {string} body  — raw bytes after the closing `---` line
 * @returns {string}
 */
export function serializeFrontmatter(doc, body) {
  const fm = doc.toString({ lineWidth: 0 })
  // Ensure the frontmatter ends with exactly one newline before the closing ---
  const normalized = fm.endsWith('\n') ? fm : fm + '\n'
  return `---\n${normalized}---\n${body}`
}

// ---------------------------------------------------------------------------
// Body digest (AC 6)
// ---------------------------------------------------------------------------

/**
 * Extract the §§1–8 prose from rfc.md body.
 * Sections are markdown headings of depth 1-3 whose number is 1..8.
 * Captures from the heading through (but not including) the next top-level section > 8.
 */
function extractSections1to8(body) {
  const lines = body.split('\n')
  let result = []
  let capturing = false

  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(\d+)\./)
    if (m) {
      const num = parseInt(m[2], 10)
      if (num >= 1 && num <= 8) {
        capturing = true
        result.push(line)
      } else {
        // Section 9+ or any non-numbered heading that comes after — stop
        if (capturing && parseInt(m[2], 10) > 8) {
          capturing = false
        } else if (capturing) {
          result.push(line)
        }
      }
    } else if (capturing) {
      result.push(line)
    }
  }
  return result.join('\n')
}

/**
 * Compute body_digest: sha256 over §§1–8 prose + JSON-serialised spec_delta + tasks.
 * This is stamped at draft→review and checked by `rfc validate` for review+ statuses.
 */
export function computeBodyDigest(frontmatter, body) {
  const prose = extractSections1to8(body)
  const specDelta = JSON.stringify(frontmatter.spec_delta ?? [])
  const tasks = JSON.stringify(frontmatter.tasks ?? [])
  return createHash('sha256').update(prose + specDelta + tasks, 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

/**
 * Return the next ordinal for a new RFC directory under rfcsDir.
 * Scans existing NNNN- prefixed directories.
 */
export function nextOrdinal(rfcsDir) {
  if (!existsSync(rfcsDir)) return 1
  let max = 0
  for (const name of readdirSync(rfcsDir)) {
    const m = name.match(/^(\d+)-/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max + 1
}

/**
 * Find an RFC directory by UID, searching under rfcsDir.
 * Returns the absolute path to the RFC directory, or null if not found.
 */
export function findRfcByUid(rfcsDir, uid) {
  if (!existsSync(rfcsDir)) return null
  for (const name of readdirSync(rfcsDir)) {
    const rfcMd = path.join(rfcsDir, name, 'rfc.md')
    if (!existsSync(rfcMd)) continue
    try {
      const content = readFileSync(rfcMd, 'utf8')
      const { frontmatter } = parseFrontmatter(content)
      if (frontmatter.uid === uid) return path.join(rfcsDir, name)
    } catch {
      // skip unreadable/invalid files
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Journal reader (AC 9 — reads shard files directly, NO import from journal-io.mjs)
// ---------------------------------------------------------------------------

/**
 * Read all journal entries for a given RFC uid.
 * Shards live at .groundwork/journal/<YYYY-MM-DD>-<session_id>.jsonl.
 * Returns entries sorted by timestamp ascending.
 * Tolerates absent/empty journal directory.
 */
export function readJournalEntries(projectDir, rfcUid) {
  const journalDir = path.join(projectDir, '.groundwork', 'journal')
  if (!existsSync(journalDir)) return []
  const entries = []
  let files
  try {
    files = readdirSync(journalDir).filter(f => f.endsWith('.jsonl'))
  } catch {
    return []
  }
  for (const f of files) {
    try {
      const lines = readFileSync(path.join(journalDir, f), 'utf8').split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const obj = JSON.parse(trimmed)
          if (obj.rfc === rfcUid) entries.push(obj)
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // skip unreadable shards
    }
  }
  return entries.sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''))
}

// ---------------------------------------------------------------------------
// Run ledger reader (AC 9/10 — reads ledger files directly)
// ---------------------------------------------------------------------------

/**
 * Find all run ledgers under .groundwork/runs/ (and legacy .groundwork/run.json)
 * whose rfc_ref field matches rfcUid.
 * Returns an array of ledger objects.
 */
export function findLedgersForRfc(projectDir, rfcUid) {
  const results = []
  const runsDir = path.join(projectDir, '.groundwork', 'runs')
  if (existsSync(runsDir)) {
    try {
      for (const f of readdirSync(runsDir)) {
        if (!f.endsWith('.json')) continue
        try {
          const ledger = JSON.parse(readFileSync(path.join(runsDir, f), 'utf8'))
          if (ledger.rfc_ref === rfcUid) results.push(ledger)
        } catch {}
      }
    } catch {}
  }
  // Legacy path
  const legacyPath = path.join(projectDir, '.groundwork', 'run.json')
  if (existsSync(legacyPath)) {
    try {
      const ledger = JSON.parse(readFileSync(legacyPath, 'utf8'))
      if (ledger.rfc_ref === rfcUid) results.push(ledger)
    } catch {}
  }
  return results
}
