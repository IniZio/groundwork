// check-comments-exempt — hook lib; verification scanning with inline contracts
/**
 * verifies-scan.mjs — scanner for @verifies annotations in test files.
 *
 * Walks test/ and tests/ directories under a root dir and extracts all
 * `@verifies <REQ-ID>` annotations, returning a mapping from requirement id
 * to the test file paths (relative to rootDir) that carry the annotation.
 *
 * Convention: `@verifies` followed by one or more space/comma-separated
 * requirement IDs. The token must be the first non-whitespace content after a
 * `//` or `*` comment marker — mid-line and trailing forms (including inside
 * string literals) are not matched.  A single annotation line may list multiple IDs:
 *   // @verifies ARTIFACT-R-001, ARTIFACT-R-002
 *
 * ID grammar is shared with hooks/lib/spec-io.mjs (ID_RE_SRC).
 */

import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { ID_RE_SRC } from './spec-io.mjs'

const IGNORED_DIRS = new Set(['node_modules', 'worktrees'])
const TEST_DIRS = ['test', 'tests']
const TEST_EXTS = new Set(['.ts', '.js', '.mjs', '.mts'])

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Walk a directory tree, returning absolute paths to files whose extension
 * is in TEST_EXTS.  Skips IGNORED_DIRS by name.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function walkTestFiles(dir) {
  const results = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...walkTestFiles(full))
    } else if (entry.isFile() && TEST_EXTS.has(extname(entry.name))) {
      results.push(full)
    }
  }
  return results
}

// An @verifies token is only treated as a real annotation when it is the
// FIRST non-whitespace content following a comment marker (// or *).
// Mid-line trailing annotations — e.g. `doSomething() // @verifies FOO-R-001`
// — are intentionally not supported.  This prevents prose descriptions of the
// annotation convention from being scanned as real annotations.
const VERIFIES_COMMENT_RE = /^\s*(?:\/\/|\*)\s*@verifies\b/

/**
 * Extract all requirement IDs that follow a `@verifies` token on a single line,
 * but only when `@verifies` is the first non-whitespace content after a comment
 * marker (`//` or `*`).  Mid-line trailing uses are intentionally ignored.
 * Extraction is case-insensitive; all returned IDs are normalized to lowercase.
 *
 * @param {string} line
 * @returns {string[]}
 */
function extractVerifiesFromLine(line) {
  if (!VERIFIES_COMMENT_RE.test(line)) return []
  const idx = line.indexOf('@verifies')
  const after = line.slice(idx + '@verifies'.length)
  const idRe = new RegExp(ID_RE_SRC, 'gi')
  const ids = []
  let m
  while ((m = idRe.exec(after)) !== null) {
    ids.push(m[1].toLowerCase())
  }
  return ids
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan the test directories (test/ and tests/) under rootDir for
 * `@verifies <REQ-ID>` annotations and return a mapping from requirement id
 * to sorted array of test file paths relative to rootDir.
 *
 * @param {string} rootDir - absolute path to the project root
 * @returns {{ [reqId: string]: string[] }}
 */
export function scanVerifies(rootDir) {
  /** @type {Map<string, Set<string>>} */
  const result = new Map()

  for (const testDirName of TEST_DIRS) {
    const dir = join(rootDir, testDirName)
    for (const absPath of walkTestFiles(dir)) {
      let content
      try {
        content = readFileSync(absPath, 'utf8')
      } catch {
        continue
      }
      const relPath = relative(rootDir, absPath)
      for (const line of content.split('\n')) {
        for (const id of extractVerifiesFromLine(line)) {
          if (!result.has(id)) result.set(id, new Set())
          result.get(id).add(relPath)
        }
      }
    }
  }

  // Convert sets to sorted arrays for a stable, serialisable result
  /** @type {{ [reqId: string]: string[] }} */
  const out = {}
  for (const [id, paths] of [...result.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out[id] = [...paths].sort()
  }
  return out
}

/**
 * Normalizing lookup helper — the single place where a requirement ID is
 * lowercased before indexing into a scanVerifies() map.
 *
 * All consumers MUST call this instead of `verifiesMap[reqId.toLowerCase()]`
 * so that any future consumer cannot accidentally skip normalization.
 *
 * @param {{ [reqId: string]: string[] }} verifiesMap - result of scanVerifies()
 * @param {string} reqId - requirement id (any case)
 * @returns {string[]} sorted array of test file paths, or [] if none
 */
export function lookupVerifies(verifiesMap, reqId) {
  return verifiesMap[reqId.toLowerCase()] ?? []
}
