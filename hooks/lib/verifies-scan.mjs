/**
 * verifies-scan.mjs — scanner for @verifies annotations in test files.
 *
 * Walks test/ and tests/ directories under a root dir and extracts all
 * `@verifies <REQ-ID>` annotations, returning a mapping from requirement id
 * to the test file paths (relative to rootDir) that carry the annotation.
 *
 * Convention: `@verifies` followed by one or more space/comma-separated
 * requirement IDs, appearing anywhere in the file (comment or string).
 * A single annotation line may list multiple IDs:
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

/**
 * Extract all requirement IDs that follow a `@verifies` token on a single line.
 * Everything after the `@verifies` token is scanned with the shared ID regex.
 *
 * @param {string} line
 * @returns {string[]}
 */
function extractVerifiesFromLine(line) {
  const idx = line.indexOf('@verifies')
  if (idx === -1) return []
  const after = line.slice(idx + '@verifies'.length)
  const idRe = new RegExp(ID_RE_SRC, 'g')
  const ids = []
  let m
  while ((m = idRe.exec(after)) !== null) {
    ids.push(m[1])
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
 * Return the set of all requirement IDs that have at least one `@verifies`
 * annotation across the test directories under rootDir.
 *
 * @param {string} rootDir - absolute path to the project root
 * @returns {Set<string>}
 */
export function verifiedIds(rootDir) {
  return new Set(Object.keys(scanVerifies(rootDir)))
}
