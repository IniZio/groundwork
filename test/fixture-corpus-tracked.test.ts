/**
 * Guard: test/fixtures/motive-corpus/ must be fully tracked by git.
 *
 * Presence on disk is not sufficient — the defect that prompted this test
 * was a .gitignore pattern (.groundwork/) silently excluding 27 of 30 fixture
 * files.  This test catches that regression by comparing git ls-files output
 * to the on-disk file count.
 *
 * S6-GUARD-TEST-FLOOR: also pins a hard floor against the known fixture
 * shape so data loss (deleting .groundwork/ subtree files) turns the guard red
 * even if onDisk === tracked (both would drop symmetrically).
 *
 * S6-GUARD-TEST-ROBUSTNESS: wraps git invocations so a non-git-work-tree
 * environment produces an explicit skip rather than an opaque throw.
 */

import { describe, test, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const FIXTURE_DIR = 'test/fixtures/motive-corpus'

/**
 * The fixture's .groundwork/ subtree contains exactly these journal shards.
 * Named here so deleting them turns the guard red independently of the walk.
 */
const REQUIRED_JOURNAL_SHARDS = [
  path.join(FIXTURE_DIR, '.groundwork/journal/groundwork-development.jsonl'),
  path.join(FIXTURE_DIR, '.groundwork/journal/obsidian-native-groundwork.jsonl'),
]

/**
 * Minimum files known to live under the fixture's .groundwork/ subtree.
 * Derived from the committed layout (27 files as of the initial defect fix),
 * NOT from a live walk — so deleting files causes this assertion to fire
 * even when onDisk === tracked.
 */
const GROUNDWORK_SUBTREE_FLOOR = 27

/** Count all regular files under a directory, recursively. */
function countFiles(dir: string): number {
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      count += countFiles(full)
    } else if (statSync(full).isFile()) {
      count++
    }
  }
  return count
}

/**
 * Run git ls-files for the fixture dir.
 * Returns null and logs if we are not inside a git work tree — allowing the
 * caller to skip explicitly rather than crash with an opaque fatal message.
 *
 * In a CI environment (CI env var set), a missing git work tree is treated as
 * a hard failure rather than a skip — a silently-not-running tracking assertion
 * in CI defeats the purpose of the guard entirely.
 */
function tryGitLsFiles(): string | null {
  try {
    return execSync(
      `git ls-files --cached --others --exclude-standard ${FIXTURE_DIR}`,
      { encoding: 'utf8' },
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('not a git repository')) {
      const inCI = Boolean(process.env['CI'])
      if (inCI) {
        throw new Error(
          '[fixture-corpus-tracked] FAIL: not inside a git work tree in a CI environment. ' +
          'The git-tracking assertion cannot be skipped in CI — this guard exists to catch ' +
          'files silently excluded by .gitignore and must run on every CI build. ' +
          '(CI env var is set; ensure tests run inside the git repository checkout.)',
        )
      }
      console.warn(
        '[fixture-corpus-tracked] Skipping git-tracking assertion: ' +
        'not inside a git work tree (running from a git archive or temp directory?)',
      )
      return null
    }
    throw err  // unexpected git failure — re-throw so it is not silently swallowed
  }
}

describe('fixture corpus git tracking', () => {
  test('all on-disk files in motive-corpus are tracked by git', ({ skip }) => {
    // S6-GUARD-TEST-ROBUSTNESS: resolve git availability before asserting.
    const lsOutput = tryGitLsFiles()
    if (lsOutput === null) {
      skip('not inside a git work tree — git-tracking assertion skipped (see console.warn above)')
    }

    // Files that are either committed/staged OR untracked-but-NOT-ignored.
    // --cached: staged/committed; --others: untracked; --exclude-standard: apply .gitignore.
    // If any file is gitignored, it won't appear and the count will fall short.
    const tracked = lsOutput!.trim().split('\n').filter(Boolean).length

    // Files actually on disk
    const onDisk = countFiles(FIXTURE_DIR)

    expect(onDisk).toBeGreaterThan(0)  // sanity: fixture dir is not empty
    expect(tracked).toBe(onDisk)
  })

  // S6-GUARD-TEST-FLOOR: independent of the walk comparison above.
  // Catches data loss (both onDisk and tracked shrink symmetrically) that the
  // equality assertion alone cannot detect.
  test('.groundwork/ subtree has the expected minimum file count', () => {
    const groundworkDir = path.join(FIXTURE_DIR, '.groundwork')
    const actual = countFiles(groundworkDir)
    expect(actual).toBeGreaterThanOrEqual(GROUNDWORK_SUBTREE_FLOOR)
  })

  test('required journal shards exist on disk', () => {
    for (const shard of REQUIRED_JOURNAL_SHARDS) {
      expect(existsSync(shard), `missing journal shard: ${shard}`).toBe(true)
    }
  })
})
