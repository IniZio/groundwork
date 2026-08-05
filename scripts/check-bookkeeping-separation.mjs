#!/usr/bin/env node
/**
 * check-bookkeeping-separation.mjs — AC-6 (P-E) enforcement
 *
 * Scans committed human document paths for bare TASK_COMPLETE / @verifies
 * markers. This enforces the principle that machine-readable tracking
 * artifacts must not bleed into committed human documents (doc/, skills/).
 *
 * Rule — bare vs. backtick-wrapped:
 *   A marker occurrence is BARE (a violation) when BOTH conditions hold:
 *   (a) The line is outside a fenced code block (any line starting with ```
 *       toggles fence state; lines inside a fence are skipped entirely).
 *   (b) After stripping all inline backtick code spans (`…` and ``…``) from
 *       the line, the marker string still appears in the residue.
 *
 *   Legitimate uses are always backtick-wrapped:
 *     `TASK_COMPLETE`         → inline code span, allowed
 *     `@verifies <id>`        → inline code span, allowed
 *     `// @verifies FOO-R-1`  → inline code span, allowed
 *     (inside a ``` block)    → fenced code, allowed
 *
 *   Violations look like bare prose:
 *     TASK_COMPLETE           → not in any code span
 *     @verifies ARTIFACT-R-1  → not in any code span
 *
 * Usage:
 *   node scripts/check-bookkeeping-separation.mjs [dir ...]
 *   Defaults to doc/ and skills/ relative to the repo root.
 *
 * Exit codes: 0 clean  1 violations found
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')

/** Matches either of the two prohibited bare marker strings. */
const MARKER_RE = /TASK_COMPLETE|@verifies/

/**
 * Strips inline backtick code spans from a line.
 * Double-backtick spans (``…``) are matched before single-backtick spans
 * (`…`) so that the longer pattern takes precedence.
 * Each match is replaced with spaces to preserve character positions
 * (preserves length, so multiple matches on one line all resolve correctly).
 */
const CODE_SPAN_RE = /``[^`]*``|`[^`]*`/g

/** A line starting with ``` toggles the fenced-code-block state. */
const FENCE_RE = /^```/

/**
 * Scan one file's string content for bare markers.
 *
 * @param {string} filePath   - Used only for labelling violations.
 * @param {string} content    - The full file text.
 * @returns {{ file: string, lineNo: number, text: string }[]}
 */
export function scanContent(filePath, content) {
  const violations = []
  const lines = content.split('\n')
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Toggle fenced-code-block state; skip the fence delimiter line itself.
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    // Strip all inline code spans, then test for bare markers in the residue.
    const stripped = line.replace(CODE_SPAN_RE, (m) => ' '.repeat(m.length))
    if (MARKER_RE.test(stripped)) {
      violations.push({ file: filePath, lineNo: i + 1, text: line.trim() })
    }
  }

  return violations
}

/**
 * Recursively collect .md files under a directory.
 *
 * @param {string} dir
 * @returns {string[]} absolute paths
 */
function collectMarkdownFiles(dir) {
  const files = []
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full)
    }
  }
  return files
}

/**
 * Scan all .md files under the given directory paths.
 *
 * @param {string[]} dirs
 * @returns {{ file: string, lineNo: number, text: string }[]}
 */
export function checkPaths(dirs) {
  const violations = []
  for (const dir of dirs) {
    for (const file of collectMarkdownFiles(dir)) {
      const content = readFileSync(file, 'utf8')
      violations.push(...scanContent(file, content))
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)

if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(`Usage: node scripts/check-bookkeeping-separation.mjs [dir ...]

Scans Markdown files under the given dirs for bare TASK_COMPLETE / @verifies
markers. Defaults to doc/ and skills/ relative to the repo root.

Backtick-wrapped occurrences (\`TASK_COMPLETE\`, \`@verifies\`) and occurrences
inside fenced code blocks are allowed; bare occurrences are violations.

Exit codes: 0 clean  1 violations found
`)
  process.exit(0)
}

const positionalArgs = argv.filter((a) => !a.startsWith('-'))
const targetDirs = positionalArgs.length > 0
  ? positionalArgs.map((d) => resolve(d))
  : [join(REPO_ROOT, 'doc'), join(REPO_ROOT, 'skills')]

const violations = checkPaths(targetDirs)

if (violations.length === 0) {
  process.stdout.write('check-sep: clean — no bare bookkeeping markers found.\n')
  process.exit(0)
}

for (const { file, lineNo, text } of violations) {
  process.stdout.write(`${file}:${lineNo}: ${text}\n`)
}
process.stdout.write(`\n${violations.length} violation${violations.length !== 1 ? 's' : ''} found.\n`)
process.exit(1)
