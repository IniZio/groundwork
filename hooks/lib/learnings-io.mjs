/**
 * Groundwork Learnings KB I/O — read/write library for the durable "cold store"
 * of distilled lessons at `.groundwork/learnings/<concept-slug>.md`.
 *
 * This is the positive twin of the Rejection KB (`.groundwork/out-of-scope/`).
 * Each entry is a Markdown file with YAML-ish frontmatter followed by a body
 * containing structured sections (procedure, why naive fails, invalidation
 * conditions, recurrence log).
 *
 * Design principles (mirrors ledger-io.mjs):
 *  - Atomic writes: temp + fsync + rename — a reader never sees a torn file.
 *  - No external dependencies — Node built-ins only.
 *  - Flat frontmatter parser — no js-yaml; the schema is a small fixed set of
 *    scalar keys.
 *  - Tolerant reads — a missing or corrupt file returns null, never throws.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { toSlug } from './concept-slug.mjs'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Stable key order for frontmatter serialization. */
const FM_KEYS = ['concept', 'status', 'first_learned', 'recurrence', 'promoted_to']

/**
 * Parse the minimal flat YAML-ish frontmatter produced by this library.
 * Expects content like:
 *   ---
 *   key: value
 *   ---
 * Returns { frontmatter, body } or null if the fences are missing/corrupt.
 */
function parseFrontmatter(raw) {
  // Must start with ---
  if (!raw.startsWith('---')) return null
  const afterFirst = raw.slice(3)
  // Find the closing ---
  const closeIdx = afterFirst.indexOf('\n---')
  if (closeIdx === -1) return null

  const fmRaw = afterFirst.slice(0, closeIdx)
  const body = afterFirst.slice(closeIdx + 4) // skip \n---

  const frontmatter = {}
  for (const line of fmRaw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue
    const key = trimmed.slice(0, colonIdx).trim()
    const val = trimmed.slice(colonIdx + 1).trim()
    frontmatter[key] = val
  }

  // Coerce known types
  if ('recurrence' in frontmatter) {
    const n = parseInt(frontmatter.recurrence, 10)
    frontmatter.recurrence = isNaN(n) ? 1 : n
  }

  return { frontmatter, body: body.trimStart() }
}

/**
 * Serialize a frontmatter object and a markdown body into the canonical file
 * format. Key order is stable (FM_KEYS).
 */
function serializeFrontmatter(frontmatter, body) {
  const lines = ['---']
  for (const key of FM_KEYS) {
    const val = frontmatter[key] ?? ''
    lines.push(`${key}: ${val}`)
  }
  lines.push('---', '')
  return lines.join('\n') + (body ? body : '')
}

/**
 * Write `data` to `filePath` atomically (temp + fsync + rename).
 * Creates the parent directory if needed.
 */
function atomicWriteFile(filePath, data) {
  const dir = path.dirname(filePath)
  mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp.${randomUUID()}`)
  const fd = openSync(tmp, 'w')
  try {
    writeFileSync(fd, data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, filePath)
  // Best-effort directory fsync.
  try {
    const dfd = openSync(dir, 'r')
    try { fsyncSync(dfd) } finally { closeSync(dfd) }
  } catch { /* not fatal */ }
}

/** Return today's date as YYYY-MM-DD (local). */
function today() {
  return new Date().toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Slugify `conceptOrSlug` via toSlug and return the absolute path to its
 * Markdown entry file inside projectDir.
 */
export function resolveLearningPath(projectDir, conceptOrSlug) {
  const slug = toSlug(conceptOrSlug)
  return path.join(projectDir, '.groundwork', 'learnings', `${slug}.md`)
}

/**
 * Read a learning entry.
 * Returns `{ frontmatter, body }` or `null` if the file is missing or corrupt.
 * `frontmatter.recurrence` is an integer.
 */
export function readLearning(projectDir, conceptOrSlug) {
  const filePath = resolveLearningPath(projectDir, conceptOrSlug)
  let raw
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
  try {
    return parseFrontmatter(raw)
  } catch {
    return null
  }
}

/**
 * Create or update a learning entry.
 *
 * - If no entry exists: creates it with status LEARNING, recurrence 1, and
 *   appends an initial recurrence-log line.
 * - If an entry exists: increments recurrence and appends a recurrence-log
 *   line. Body sections (Distilled procedure, etc.) are only updated when the
 *   caller provides new text.
 *
 * @param {string} projectDir
 * @param {{ concept: string, session_id: string, detail: string,
 *            procedure?: string, whyNaiveFails?: string,
 *            invalidateWhen?: string }} opts
 * @returns {object} resulting frontmatter
 */
export function upsertLearning(projectDir, opts) {
  const { concept, session_id, detail, procedure, whyNaiveFails, invalidateWhen } = opts
  const filePath = resolveLearningPath(projectDir, concept)
  const slug = toSlug(concept)

  const existing = readLearning(projectDir, concept)
  const dateStr = today()
  const logLine = `- ${dateStr} — ${session_id} — ${detail}`

  let frontmatter
  let body

  if (!existing) {
    // New entry
    frontmatter = {
      concept: slug,
      status: 'LEARNING',
      first_learned: dateStr,
      recurrence: 1,
      promoted_to: '',
    }
    body = [
      '## Distilled procedure',
      procedure ?? '',
      '',
      '## Why the naive path fails',
      whyNaiveFails ?? '',
      '',
      '## Conditions that would invalidate this',
      invalidateWhen ?? '',
      '',
      '## Recurrence log',
      logLine,
      '',
    ].join('\n')
  } else {
    frontmatter = { ...existing.frontmatter, recurrence: existing.frontmatter.recurrence + 1 }
    body = existing.body

    // Update body sections only when new text is supplied
    if (procedure !== undefined) {
      body = replaceSection(body, '## Distilled procedure', procedure)
    }
    if (whyNaiveFails !== undefined) {
      body = replaceSection(body, '## Why the naive path fails', whyNaiveFails)
    }
    if (invalidateWhen !== undefined) {
      body = replaceSection(body, '## Conditions that would invalidate this', invalidateWhen)
    }

    // Append to recurrence log
    body = appendToSection(body, '## Recurrence log', logLine)
  }

  const content = serializeFrontmatter(frontmatter, body)
  atomicWriteFile(filePath, content)
  return frontmatter
}

/**
 * List all learnings in the project.
 * Returns an array of `{ slug, frontmatter }` (empty array if directory missing).
 */
export function listLearnings(projectDir) {
  const dir = path.join(projectDir, '.groundwork', 'learnings')
  let files
  try {
    files = readdirSync(dir)
  } catch {
    return []
  }

  const results = []
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    const slug = file.slice(0, -3)
    const filePath = path.join(dir, file)
    let raw
    try {
      raw = readFileSync(filePath, 'utf8')
    } catch {
      continue
    }
    const parsed = parseFrontmatter(raw)
    if (!parsed) continue
    results.push({ slug, frontmatter: parsed.frontmatter })
  }
  return results
}

/**
 * Mark a learning as PROMOTED and record the path it was promoted to.
 * No-op (returns null) if the entry doesn't exist.
 * Returns the updated frontmatter.
 */
export function promoteLearning(projectDir, conceptOrSlug, promotedToPath) {
  const existing = readLearning(projectDir, conceptOrSlug)
  if (!existing) return null

  const frontmatter = { ...existing.frontmatter, status: 'PROMOTED', promoted_to: promotedToPath }
  const content = serializeFrontmatter(frontmatter, existing.body)
  const filePath = resolveLearningPath(projectDir, conceptOrSlug)
  atomicWriteFile(filePath, content)
  return frontmatter
}

// ---------------------------------------------------------------------------
// Body section helpers
// ---------------------------------------------------------------------------

/**
 * Replace the content of a named `## Section` in a markdown body string.
 * If the section is not found, appends it.
 */
function replaceSection(body, heading, newContent) {
  const lines = body.split('\n')
  const headIdx = lines.findIndex(l => l.trim() === heading)
  if (headIdx === -1) {
    // Append missing section
    return body.trimEnd() + '\n\n' + heading + '\n' + newContent + '\n'
  }

  // Find the start of the next ## heading (or end of file)
  let nextHeadIdx = lines.length
  for (let i = headIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { nextHeadIdx = i; break }
  }

  const before = lines.slice(0, headIdx + 1)
  const after = lines.slice(nextHeadIdx)
  return [...before, newContent, '', ...after].join('\n')
}

/**
 * Append `line` to a named `## Section` in a markdown body string.
 * If the section is not found, appends it.
 */
function appendToSection(body, heading, line) {
  const lines = body.split('\n')
  const headIdx = lines.findIndex(l => l.trim() === heading)
  if (headIdx === -1) {
    return body.trimEnd() + '\n\n' + heading + '\n' + line + '\n'
  }

  // Find the end of this section (next ## heading or EOF)
  let insertIdx = lines.length
  for (let i = headIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { insertIdx = i; break }
  }

  // Walk back past trailing blank lines to insert just before them
  let endOfContent = insertIdx
  while (endOfContent > headIdx + 1 && lines[endOfContent - 1].trim() === '') {
    endOfContent--
  }

  const result = [
    ...lines.slice(0, endOfContent),
    line,
    ...lines.slice(endOfContent),
  ]
  return result.join('\n')
}
