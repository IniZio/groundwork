/**
 * spec-io.mjs — shared I/O utilities for the spec CLI.
 *
 * Pure data functions; no process.exit. No cross-imports from rfc-io or journal-io.
 */

import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { load as yamlLoad } from 'js-yaml'

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from markdown content.
 * Returns { data, body } where data is the parsed object and body is the remainder.
 */
export function parseYamlFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { data: {}, body: content }
  try {
    const parsed = yamlLoad(m[1])
    const data = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
    return { data, body: m[2] }
  } catch {
    return { data: {}, body: content }
  }
}

// ---------------------------------------------------------------------------
// Project root and path helpers
// ---------------------------------------------------------------------------

export function findProjectRoot(startDir) {
  let dir = startDir
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, 'package.json')) || existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir
}

export function specDirPath(projectRoot) {
  return join(projectRoot, 'docs', 'spec')
}

export function generatedDirPath(sd) {
  return join(sd, '_generated')
}

export function indexJsonPath(sd) {
  return join(sd, '_generated', 'index.json')
}

// ---------------------------------------------------------------------------
// Walk spec files (excludes _generated and dotfiles)
// ---------------------------------------------------------------------------

export function walkSpecFiles(sd) {
  const results = []
  function walk(dir) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === '_generated') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (e.isFile() && e.name.endsWith('.md')) {
        results.push({ absPath: full, relPath: relative(sd, full) })
      }
    }
  }
  walk(sd)
  return results
}

// ---------------------------------------------------------------------------
// Staleness check (AC10)
// ---------------------------------------------------------------------------

export function isIndexStale(sd) {
  const p = indexJsonPath(sd)
  if (!existsSync(p)) return true
  const idxMtime = statSync(p).mtimeMs
  for (const { absPath } of walkSpecFiles(sd)) {
    if (statSync(absPath).mtimeMs > idxMtime) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

export function firstSentence(text) {
  const clean = (text || '')
    .replace(/^#+\s.*$/mg, '')
    .replace(/[`*_[\]]/g, '')
    .trim()
  const m = clean.match(/[^.!?]*[.!?]/)
  return m ? m[0].trim() : clean.slice(0, 120).trim()
}

// Matches requirement ids (CONCEPT-R-xxxx) and concept ids (C-NAME)
const ID_RE_SRC = '\\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-R-[a-z0-9]{4}|C-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)\\b'

export function extractRefs(content, selfId) {
  const re = new RegExp(ID_RE_SRC, 'g')
  const refs = new Set()
  let m
  while ((m = re.exec(content)) !== null) {
    if (m[1] !== selfId) refs.add(m[1])
  }
  return [...refs]
}

/**
 * Return the first path-like token found in text, or null if none.
 * A path-like token contains '/' or looks like a filename (has extension and dot).
 * Used to reject file references in the `verify` field (AC12).
 */
export function pathLikeToken(text) {
  const tokens = (text || '').split(/\s+/)
  for (const t of tokens) {
    if (!t) continue
    if (t.includes('/')) return t
    // token like "foo.ts", "bar.spec.js" — must have a letter-only extension ≤5 chars
    // and enough length to not be a word-ending period
    if (/\.[a-zA-Z]{1,5}$/.test(t) && t.length > 4 && !t.endsWith('etc.')) return t
  }
  return null
}

// ---------------------------------------------------------------------------
// Concept-directory resolution for parent/dir mismatch check (AC3)
// ---------------------------------------------------------------------------

/**
 * Walk up from reqAbsPath looking for a README.md that has an `id` frontmatter.
 * Returns the concept id, or null if none found within sd.
 */
export function findNearestConceptId(reqAbsPath, sd) {
  const sdNorm = sd.replace(/\/?$/, '')
  let dir = dirname(reqAbsPath)
  for (let i = 0; i < 12; i++) {
    const readme = join(dir, 'README.md')
    if (existsSync(readme)) {
      const { data } = parseYamlFrontmatter(readFileSync(readme, 'utf8'))
      if (data.id) return String(data.id)
    }
    if (dir === sdNorm || dirname(dir) === dir) break
    dir = dirname(dir)
  }
  return null
}

/**
 * Find the directory of a concept node given its id.
 * Returns the abs dir path whose README.md has that id, or null.
 */
export function findConceptDir(conceptId, sd) {
  const files = walkSpecFiles(sd)
  for (const { absPath } of files) {
    if (!absPath.endsWith('README.md')) continue
    const { data } = parseYamlFrontmatter(readFileSync(absPath, 'utf8'))
    if (String(data.id) === conceptId) return dirname(absPath)
  }
  return null
}

// ---------------------------------------------------------------------------
// Build index data (AC2, AC3, AC4, AC6, AC12)
// ---------------------------------------------------------------------------

/**
 * Build index from all spec files.
 * Returns { nodes: Record<id, NodeRecord>, errors: ErrorRecord[] }
 *
 * Errors:
 *   { type: 'duplicate_id', id, paths: [p1, p2] }
 *   { type: 'parent_dir_mismatch', nodeId, frontmatter, directory, path }
 *   { type: 'path_in_verify', nodeId, token, path }
 */
export function buildIndexData(sd) {
  const files = walkSpecFiles(sd)
  const errors = []
  const nodes = {}
  const idToPath = {}

  for (const { absPath, relPath } of files) {
    let raw
    try { raw = readFileSync(absPath, 'utf8') } catch { continue }
    const { data, body } = parseYamlFrontmatter(raw)
    if (!data.id) continue

    const id = String(data.id)

    // AC4: duplicate id detection
    if (idToPath[id]) {
      errors.push({ type: 'duplicate_id', id, paths: [idToPath[id], absPath] })
      continue
    }
    idToPath[id] = absPath

    const refs = extractRefs(raw, id)
    const byteSize = Buffer.byteLength(raw, 'utf8')

    // AC3: parent frontmatter field vs directory position
    if (data.concept) {
      const expectedConcept = findNearestConceptId(absPath, sd)
      if (expectedConcept && String(data.concept) !== expectedConcept) {
        errors.push({
          type: 'parent_dir_mismatch',
          nodeId: id,
          frontmatter: String(data.concept),
          directory: expectedConcept,
          path: absPath,
        })
      }
    }

    // AC12: if verify contains a path-like token, reject
    if (data.verify && typeof data.verify === 'string') {
      const bad = pathLikeToken(data.verify)
      if (bad) {
        errors.push({ type: 'path_in_verify', nodeId: id, token: bad, path: absPath })
      }
    }

    // AC6: first-sentence summary from ears (for requirements) or body/title (for concepts)
    const summary = data.ears
      ? firstSentence(String(data.ears))
      : data.title
        ? String(data.title)
        : firstSentence(body || id)

    nodes[id] = {
      id,
      type: data.type ? String(data.type) : (data.concept ? 'requirement' : 'concept'),
      title: String(data.title || data.concept || id),
      summary,
      refs,
      byteSize,
      relPath,
      // AC11: inbound computed after all nodes collected
      inbound: [],
      // Fields for display
      concept: data.concept ? String(data.concept) : null,
      parent: data.parent !== undefined ? (data.parent ? String(data.parent) : null) : null,
      status: data.status ? String(data.status) : null,
      pattern: data.pattern ? String(data.pattern) : null,
      verification: data.verification ? String(data.verification) : null,
      criticality: data.criticality ? String(data.criticality) : 'must',
      ears: data.ears ? String(data.ears) : null,
    }
  }

  // Compute inbound references (AC11)
  for (const node of Object.values(nodes)) {
    for (const ref of node.refs) {
      if (nodes[ref]) {
        nodes[ref].inbound.push(node.id)
      }
    }
  }

  return { nodes, errors }
}

// ---------------------------------------------------------------------------
// Load persisted index (AC10, AC11)
// ---------------------------------------------------------------------------

export function loadIndex(sd) {
  const p = indexJsonPath(sd)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch { return null }
}

// ---------------------------------------------------------------------------
// Random suffix generation (AC5)
// ---------------------------------------------------------------------------

const BASE32_CHARS = 'abcdefghijklmnopqrstuvwxyz234567'

export function randomSuffix(existingIds) {
  const existing = new Set(existingIds)
  for (let attempt = 0; attempt < 256; attempt++) {
    let s = ''
    for (let i = 0; i < 4; i++) {
      s += BASE32_CHARS[Math.floor(Math.random() * BASE32_CHARS.length)]
    }
    if (!existing.has(s)) return s
  }
  throw new Error('could not generate a unique 4-char suffix after 256 attempts')
}
