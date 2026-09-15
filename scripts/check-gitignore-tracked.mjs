#!/usr/bin/env node
/**
 * check-gitignore-tracked.mjs — S13 guard (D-24)
 *
 * Fails when any git-tracked file matches a .gitignore rule.
 * Catches `git add -f` force-adds of deliberately-ignored files.
 *
 * Algorithm:
 *   1. `git ls-files`                  — enumerate every tracked path
 *   2. `git check-ignore --no-index`   — which are gitignored (ignoring index)
 *   3. subtract ALLOWLIST              — pre-existing intentional exceptions
 *
 * Exit codes: 0 clean  1 new offending paths found  2 git error
 *
 * To permanently allow a path, add it to ALLOWLIST below with a reason comment.
 * This requires a code-reviewed change — deliberate, not accidental.
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')

/**
 * Pre-existing tracked files that legitimately match a .gitignore rule.
 * Each entry requires a justification; add new entries only after code review.
 *
 * @type {string[]}
 */
const ALLOWLIST = new Set([
  'groundwork/CLAUDE.md',                                          // test scaffold under /groundwork/ (root-anchored rule)
  'skills/groundwork/housekeep/.vscode/settings.json',             // IDE config intentionally shipped with housekeep skill
  'test/fixtures/comment-density/exclusions/node_modules/foo/index.js', // fixture corpus entry; must live under node_modules/ to test exclusion logic
])

const lsResult = spawnSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })

if (lsResult.status !== 0) {
  process.stderr.write(`check-gitignore-tracked: git ls-files failed:\n${lsResult.stderr}\n`)
  process.exit(2)
}

const tracked = lsResult.stdout.trim()
if (!tracked) {
  process.stdout.write('check-gitignore-tracked: no tracked files found — nothing to check.\n')
  process.exit(0)
}

const trackedPaths = tracked.split('\n')
process.stdout.write(`check-gitignore-tracked: enumerating ${trackedPaths.length} tracked file(s)...\n`)

const checkResult = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
  cwd: REPO_ROOT,
  input: trackedPaths.join('\n') + '\n',
  encoding: 'utf8',
})

if (checkResult.status === 128) {
  process.stderr.write(`check-gitignore-tracked: git check-ignore failed:\n${checkResult.stderr}\n`)
  process.exit(2)
}

const raw = checkResult.stdout.trim() ? checkResult.stdout.trim().split('\n') : []
const offenders = raw.filter((p) => !ALLOWLIST.has(p))

if (offenders.length === 0) {
  process.stdout.write('check-gitignore-tracked: clean — no tracked file matches a .gitignore rule.\n')
  process.exit(0)
}

process.stderr.write('\ncheck-gitignore-tracked: FAIL — tracked file(s) matched by .gitignore:\n')
for (const path of offenders) {
  process.stderr.write(`  ${path}\n`)
}
process.stderr.write(
  `\n${offenders.length} offending path${offenders.length !== 1 ? 's' : ''}. ` +
  `Remove with: git rm --cached <path>\n`
)
process.exit(1)
