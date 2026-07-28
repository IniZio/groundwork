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
import { parse as parseYaml, parseDocument, stringify as stringifyYaml } from 'yaml'

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
// Fence-aware helpers (internal)
// ---------------------------------------------------------------------------

/** True when a line opens or closes a fenced code block (``` or ~~~). */
function isFenceDelimiter(line) {
  return /^(`{3,}|~{3,})/.test(line)
}

/**
 * Normalize file content for canonical digest concatenation:
 *   - Strip UTF-8 BOM
 *   - Normalize CRLF → LF
 *   - Strip trailing newlines
 *
 * The trailing-newline strip makes the digest invariant to whether an author
 * left 0, 1, or 3 blank lines at a file's end — the most likely source of
 * spurious digest mismatches.
 */
function normFileContent(content) {
  // Strip UTF-8 BOM if present
  let s = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content
  // Normalize CRLF → LF
  s = s.replace(/\r\n/g, '\n')
  // Strip trailing newlines
  return s.replace(/\n+$/, '')
}

/**
 * Fence-aware §§1–8 extraction from a single rfc.md body string.
 *
 * Scopes by heading number via regex — BUT only when not inside a fenced code
 * block. This is the compatibility path used when sections/ does not exist.
 *
 * The fence-blind predecessor (extractSections1to8) had a live bug: stray
 * depth-1 headings inside code fences (e.g. `# Unit` at body L480) would be
 * matched and could truncate the digest input if they ever contained a number
 * like `## 3. Fake`. This function eliminates that class of bug by tracking
 * ``` and ~~~ fences and ignoring heading-shaped lines inside them.
 */
function extractSections1to8FenceAware(body) {
  const lines = body.split('\n')
  const result = []
  let capturing = false
  let inFence = false

  for (const line of lines) {
    // Track fence state first — fences are opaque regardless of capturing.
    if (isFenceDelimiter(line)) {
      inFence = !inFence
      if (capturing) result.push(line)
      continue
    }

    if (!inFence) {
      const m = line.match(/^(#{1,3})\s+(\d+)\./)
      if (m) {
        const num = parseInt(m[2], 10)
        if (num >= 1 && num <= 8) {
          capturing = true
          result.push(line)
        } else if (num > 8 && capturing) {
          // Hit §9+ while capturing — stop.
          capturing = false
        } else if (capturing) {
          // Non-§1–8 numbered heading inside a §1–8 block (e.g. sub-headings
          // whose number prefix matched the regex accidentally). Keep.
          result.push(line)
        }
        continue
      }
    }

    if (capturing) result.push(line)
  }
  return result.join('\n')
}

// ---------------------------------------------------------------------------
// Multi-file section helpers
// ---------------------------------------------------------------------------

/**
 * Collect section file paths from a sections/ directory in canonical order.
 *
 * Ordering rules (per §1.1 of the RFC structure standard):
 *   1. _intro.md sorts before all numbered entries.
 *   2. Numbered entries sort ascending by their 2-digit numeric prefix.
 *   3. Directory entries are expanded depth-first in place.
 *
 * @param {string} dir  Absolute path to the sections directory (or any level).
 * @param {function|null} topLevelFilter  Optional num → bool; if provided, top-
 *   level numbered entries are skipped when the filter returns false. Used to
 *   restrict the digest to §§1–8 without re-scanning.
 * @returns {string[]}  Sorted list of absolute file paths.
 */
function collectSectionFiles(dir, topLevelFilter = null) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const introFiles = []
  const numbered = []

  for (const entry of entries) {
    if (entry.name === '_intro.md' && entry.isFile()) {
      introFiles.push(path.join(dir, entry.name))
      continue
    }
    const mFile = entry.name.match(/^(\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/)
    const mDir = entry.name.match(/^(\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/)
    if (mFile && entry.isFile()) {
      numbered.push({ num: parseInt(mFile[1], 10), filePath: path.join(dir, entry.name), isDir: false })
    } else if (mDir && entry.isDirectory()) {
      numbered.push({ num: parseInt(mDir[1], 10), filePath: path.join(dir, entry.name), isDir: true })
    }
    // Stray entries are ignored here; validateSectionLayout reports them as errors.
  }

  numbered.sort((a, b) => a.num - b.num)

  const result = [...introFiles]
  for (const item of numbered) {
    if (topLevelFilter !== null && !topLevelFilter(item.num)) continue
    if (item.isDir) {
      // Expand directory depth-first; no topLevelFilter inside subtrees.
      result.push(...collectSectionFiles(item.filePath, null))
    } else {
      result.push(item.filePath)
    }
  }

  return result
}

/**
 * Assemble the logical body of a multi-file RFC by concatenating section files
 * in canonical order with the §4.2 normalization applied to each.
 *
 * @param {string} rfcDir  Absolute path to the RFC directory.
 * @param {function|null} sectionsFilter  Optional num → bool applied at the top
 *   level of sections/. Pass `num => num >= 1 && num <= 8` to restrict to
 *   §§1–8 for digest computation.
 * @returns {string}  Canonical logical body string.
 */
export function assembleLogicalBody(rfcDir, sectionsFilter = null) {
  const sectionsDir = path.join(rfcDir, 'sections')
  const files = collectSectionFiles(sectionsDir, sectionsFilter)
  const parts = []
  for (const f of files) {
    try {
      const raw = readFileSync(f, 'utf8')
      parts.push(normFileContent(raw))
    } catch {
      // Skip unreadable files; validateSectionLayout will catch missing files.
    }
  }
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// tasks[] sidecar (tasks.yaml)
// ---------------------------------------------------------------------------

/**
 * Read tasks from the tasks.yaml sidecar in an RFC directory.
 * Returns an array; returns [] if the file is absent, unreadable, or invalid.
 */
export function readTasksSidecar(rfcDir) {
  const tasksPath = path.join(rfcDir, 'tasks.yaml')
  if (!existsSync(tasksPath)) return []
  try {
    const content = readFileSync(tasksPath, 'utf8')
    const parsed = parseYaml(content)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Write tasks to the tasks.yaml sidecar in an RFC directory.
 * Creates the file if absent; overwrites if present.
 */
export function writeTasksSidecar(rfcDir, tasks) {
  const tasksPath = path.join(rfcDir, 'tasks.yaml')
  const yaml = stringifyYaml(tasks, { lineWidth: 0 })
  writeFileSync(tasksPath, yaml)
}

// ---------------------------------------------------------------------------
// Layout validation
// ---------------------------------------------------------------------------

/**
 * Validate the naming and numbering conventions of a sections/ directory tree.
 *
 * Rules enforced (per §1.1 of the RFC structure standard):
 *   - Files must match ^(\d{2})-[a-z0-9]+(-[a-z0-9]+)*\.md$
 *   - Directories must match ^(\d{2})-[a-z0-9]+(-[a-z0-9]+)*$
 *   - _intro.md is the only permitted non-numeric filename
 *   - No gaps in 2-digit prefixes (must be exactly 01..k)
 *   - No duplicate prefixes
 *
 * @param {string} sectionsDir  Absolute path to the directory to validate.
 * @param {string} prefix       Display prefix for error messages (default: "sections").
 * @returns {string[]}  Array of error strings (empty → valid).
 */
export function validateSectionLayout(sectionsDir, prefix = 'sections') {
  const errors = []
  let entries
  try {
    entries = readdirSync(sectionsDir, { withFileTypes: true })
  } catch {
    errors.push(`${prefix}: cannot read directory`)
    return errors
  }

  const numbers = []
  const seen = new Set()

  for (const entry of entries) {
    // _intro.md is the one allowed non-numeric name.
    if (entry.name === '_intro.md') {
      if (!entry.isFile()) {
        errors.push(`${prefix}/_intro.md: must be a file, not a directory`)
      }
      continue
    }

    const mFile = entry.name.match(/^(\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/)
    const mDir = entry.name.match(/^(\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/)

    if (mFile && entry.isFile()) {
      const n = parseInt(mFile[1], 10)
      if (seen.has(n)) {
        errors.push(`${prefix}: duplicate section number ${String(n).padStart(2, '0')} (${entry.name})`)
      }
      seen.add(n)
      numbers.push(n)
    } else if (mDir && entry.isDirectory()) {
      const n = parseInt(mDir[1], 10)
      if (seen.has(n)) {
        errors.push(`${prefix}: duplicate section number ${String(n).padStart(2, '0')} (${entry.name})`)
      }
      seen.add(n)
      numbers.push(n)
      // Recurse into subdirectory.
      const childErrors = validateSectionLayout(
        path.join(sectionsDir, entry.name),
        `${prefix}/${entry.name}`,
      )
      errors.push(...childErrors)
    } else {
      errors.push(
        `${prefix}/${entry.name}: stray file or invalid name ` +
        `(must be NN-kebab.md, NN-kebab/, or _intro.md)`,
      )
    }
  }

  // No gaps: sorted numbers must equal 1..k.
  if (numbers.length > 0) {
    const sorted = [...numbers].sort((a, b) => a - b)
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] !== i + 1) {
        errors.push(
          `${prefix}: numbering gap — expected ${String(i + 1).padStart(2, '0')} ` +
          `but found ${String(sorted[i]).padStart(2, '0')}`,
        )
        break // Report first gap only to avoid cascading noise.
      }
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// Manifest generation and I/O
// ---------------------------------------------------------------------------

/** Convert a kebab-slug to sentence-case title: "full-layout" → "Full layout". */
function slugToTitle(slug) {
  const s = slug.replace(/-/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Recursively sum byte sizes of all files under a directory. */
function sumDirBytes(dir) {
  let total = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isFile()) {
        try { total += readFileSync(p).length } catch {}
      } else if (entry.isDirectory()) {
        total += sumDirBytes(p)
      }
    }
  } catch {}
  return total
}

/**
 * Generate the manifest block string from the sections/ directory tree.
 *
 * Format (per §2 of the RFC structure standard):
 *   <!-- rfc:manifest:begin — generated by `rfc index`; do not hand-edit -->
 *   | § | Title | File | Tokens |
 *   |---|---|---|---|
 *   | 1 | Motivation | sections/01-motivation.md | 1289 |
 *   ...
 *   <!-- rfc:manifest:end -->
 *
 * Token estimation: Math.ceil(byteLength / 3.5) — codebase convention.
 * Directories show an aggregate row followed by child rows (§ N.M).
 * _intro.md files are counted in the parent's token total but not listed.
 *
 * Returns null if sections/ does not exist.
 *
 * @param {string} rfcDir  Absolute path to the RFC directory.
 * @returns {string|null}
 */
export function generateManifestBlock(rfcDir) {
  const sectionsDir = path.join(rfcDir, 'sections')
  if (!existsSync(sectionsDir)) return null

  let entries
  try {
    entries = readdirSync(sectionsDir, { withFileTypes: true })
  } catch {
    return null
  }

  // Collect numbered entries at the top level, sorted by prefix.
  const numbered = []
  for (const entry of entries) {
    if (entry.name === '_intro.md') continue
    const mFile = entry.name.match(/^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/)
    const mDir = entry.name.match(/^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/)
    if (mFile && entry.isFile()) {
      numbered.push({ num: parseInt(mFile[1], 10), slug: mFile[2], name: entry.name, isDir: false })
    } else if (mDir && entry.isDirectory()) {
      numbered.push({ num: parseInt(mDir[1], 10), slug: mDir[2], name: entry.name, isDir: true })
    }
  }
  numbered.sort((a, b) => a.num - b.num)

  const rows = []
  for (const item of numbered) {
    const title = slugToTitle(item.slug)
    if (item.isDir) {
      // Aggregate row for the directory.
      const totalBytes = sumDirBytes(path.join(sectionsDir, item.name))
      const totalTokens = Math.ceil(totalBytes / 3.5)
      rows.push(`| ${item.num} | ${title} | sections/${item.name}/ | ${totalTokens} |`)

      // Child rows (one level deep).
      let childEntries
      try { childEntries = readdirSync(path.join(sectionsDir, item.name), { withFileTypes: true }) } catch { childEntries = [] }
      const childNumbered = []
      for (const child of childEntries) {
        if (child.name === '_intro.md') continue
        const mc = child.name.match(/^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/)
        if (mc && child.isFile()) {
          childNumbered.push({ num: parseInt(mc[1], 10), slug: mc[2], name: child.name })
        }
      }
      childNumbered.sort((a, b) => a.num - b.num)
      for (const child of childNumbered) {
        const childTitle = slugToTitle(child.slug)
        const childPath = path.join(sectionsDir, item.name, child.name)
        let childBytes = 0
        try { childBytes = readFileSync(childPath).length } catch {}
        const childTokens = Math.ceil(childBytes / 3.5)
        rows.push(`| ${item.num}.${child.num} | ${childTitle} | sections/${item.name}/${child.name} | ${childTokens} |`)
      }
    } else {
      // Leaf file row.
      let bytes = 0
      try { bytes = readFileSync(path.join(sectionsDir, item.name)).length } catch {}
      const tokens = Math.ceil(bytes / 3.5)
      rows.push(`| ${item.num} | ${title} | sections/${item.name} | ${tokens} |`)
    }
  }

  const header = '| § | Title | File | Tokens |'
  const divider = '|---|---|---|---|'
  const table = [header, divider, ...rows].join('\n')
  return `<!-- rfc:manifest:begin — generated by \`rfc index\`; do not hand-edit -->\n${table}\n<!-- rfc:manifest:end -->`
}

/**
 * Extract the manifest block from rfc.md content (between the begin/end markers,
 * inclusive). Returns null if the markers are not present.
 *
 * @param {string} content  Full rfc.md text.
 * @returns {string|null}
 */
export function extractManifestBlock(content) {
  const beginMarker = '<!-- rfc:manifest:begin'
  const endMarker = '<!-- rfc:manifest:end -->'
  const startIdx = content.indexOf(beginMarker)
  const endIdx = content.indexOf(endMarker)
  if (startIdx === -1 || endIdx === -1) return null
  return content.slice(startIdx, endIdx + endMarker.length)
}

/**
 * Write (or update) the manifest block in rfc.md.
 *
 * If the begin/end markers already exist, replaces the content between them.
 * If the markers are absent, appends the manifest block at the end of the body.
 *
 * @param {string} rfcDir  Absolute path to the RFC directory.
 */
export function writeManifest(rfcDir) {
  const rfcMdPath = path.join(rfcDir, 'rfc.md')
  const content = readFileSync(rfcMdPath, 'utf8')
  const block = generateManifestBlock(rfcDir)
  if (!block) return // no sections/ — nothing to write

  const beginMarker = '<!-- rfc:manifest:begin'
  const endMarker = '<!-- rfc:manifest:end -->'
  const startIdx = content.indexOf(beginMarker)
  const endIdx = content.indexOf(endMarker)

  let updated
  if (startIdx !== -1 && endIdx !== -1) {
    // Replace between (and including) the markers.
    updated = content.slice(0, startIdx) + block + content.slice(endIdx + endMarker.length)
  } else {
    // No markers present: append at end of body (after frontmatter).
    const trimmed = content.replace(/\n+$/, '')
    updated = trimmed + '\n\n' + block + '\n'
  }

  writeFileSync(rfcMdPath, updated)
}

// ---------------------------------------------------------------------------
// Body digest (AC 6)
// ---------------------------------------------------------------------------

/**
 * Compute body_digest: sha256 over §§1–8 prose + JSON-serialised spec_delta + tasks.
 * This is stamped at draft→review and checked by `rfc validate` for review+ statuses.
 *
 * Multi-file mode (sections/ directory exists):
 *   - §§1–8 prose is assembled from sections/01..08 via assembleLogicalBody.
 *   - tasks are read from tasks.yaml sidecar.
 *   - Fenced headings inside section files cannot influence digest scoping because
 *     scoping is by top-level layout number (01..08), not by heading regex.
 *
 * Single-file compatibility mode (sections/ absent — legacy monolith RFC):
 *   - §§1–8 prose is extracted fence-aware from the rfc.md body.
 *   - tasks fall back to frontmatter.tasks.
 *   - This path is preserved so Slices 1–4 can land before RFC-0001 is split (M3).
 *
 * @param {object} frontmatter  Parsed frontmatter JS object.
 * @param {string} rfcDir       Absolute path to the RFC directory.
 * @returns {string}  Hex-encoded SHA-256 digest.
 */
export function computeBodyDigest(frontmatter, rfcDir) {
  let prose, tasks

  const sectionsDir = path.join(rfcDir, 'sections')
  if (existsSync(sectionsDir)) {
    // Multi-file mode: scope by layout number 01..08, not by heading regex.
    prose = assembleLogicalBody(rfcDir, num => num >= 1 && num <= 8)
    tasks = readTasksSidecar(rfcDir)
  } else {
    // Compatibility mode: single-file fence-aware extraction.
    const rfcMd = path.join(rfcDir, 'rfc.md')
    const content = readFileSync(rfcMd, 'utf8')
    const { body } = parseFrontmatter(content)
    prose = extractSections1to8FenceAware(body)
    tasks = frontmatter.tasks ?? []
  }

  const specDelta = JSON.stringify(frontmatter.spec_delta ?? [])
  return createHash('sha256').update(prose + specDelta + JSON.stringify(tasks), 'utf8').digest('hex')
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
 * Read RFC frontmatter from an RFC directory, supporting both formats:
 *  - Sidecar format (S2+): metadata in rfc.yaml, rfc.md is prose-only.
 *  - Legacy format: frontmatter embedded in rfc.md.
 *
 * Tries rfc.yaml first; falls back to rfc.md frontmatter.
 * Throws if neither file is readable or parseable.
 *
 * @param {string} rfcDir  Absolute path to the RFC directory.
 * @returns {{ frontmatter: object }}
 */
export function readRfcFrontmatter(rfcDir) {
  const rfcYamlPath = path.join(rfcDir, 'rfc.yaml')
  if (existsSync(rfcYamlPath)) {
    const content = readFileSync(rfcYamlPath, 'utf8')
    const frontmatter = parseYaml(content)
    if (frontmatter && typeof frontmatter === 'object') {
      return { frontmatter }
    }
  }
  // Fall back to legacy: frontmatter embedded in rfc.md.
  const rfcMdPath = path.join(rfcDir, 'rfc.md')
  const content = readFileSync(rfcMdPath, 'utf8')
  return parseFrontmatter(content)
}

/**
 * Find an RFC directory by UID, searching under rfcsDir.
 * Supports both sidecar (rfc.yaml) and legacy (rfc.md frontmatter) formats.
 * Returns the absolute path to the RFC directory, or null if not found.
 */
export function findRfcByUid(rfcsDir, uid) {
  if (!existsSync(rfcsDir)) return null
  for (const name of readdirSync(rfcsDir)) {
    const dirPath = path.join(rfcsDir, name)

    // Sidecar format (S2+): uid lives in rfc.yaml.
    const rfcYaml = path.join(dirPath, 'rfc.yaml')
    if (existsSync(rfcYaml)) {
      try {
        const content = readFileSync(rfcYaml, 'utf8')
        const parsed = parseYaml(content)
        if (parsed?.uid === uid) return dirPath
      } catch {
        // skip unreadable/invalid files
      }
    }

    // Legacy format: uid in rfc.md frontmatter.
    const rfcMd = path.join(dirPath, 'rfc.md')
    if (!existsSync(rfcMd)) continue
    try {
      const content = readFileSync(rfcMd, 'utf8')
      const { frontmatter } = parseFrontmatter(content)
      if (frontmatter.uid === uid) return dirPath
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
