/**
 * test/gw/cli/journal-store-path.seam.test.ts
 *
 * Seam test: `gw journal show` must not silently succeed ("no events found",
 * exit 0) when the legacy JSONL store has shards but the new Obsidian-native
 * store (<tracker>/motives/) has none.
 *
 * Before the fix, `gw journal` pinned tracker at '.groundwork/next' which does
 * not exist, so readAllEvents() returned [] → exit 0 "no events found".
 *
 * After the fix:
 *   1. tracker = DEFAULT_TRACKER_PATH ('.groundwork') — agrees with gw locate
 *   2. When 0 events found but JSONL shards exist at .groundwork/journal/,
 *      the command exits 1 with a STORE_DIVERGENCE error naming BOTH paths.
 *
 * Bite-proof rules enforced:
 *   - spawns bin/gw-hook (the real deployed entry point) via CLAUDE_PROJECT_DIR
 *   - red message names the two diverging paths (new-store path + legacy path)
 *   - test file is byte-identical between red and green runs; only production
 *     source changes
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'

const REPO_ROOT = '/home/newman/.local/share/groundwork'
const GW_HOOK = path.join(REPO_ROOT, 'bin/gw-hook')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanups: string[] = []
afterEach(() => {
  for (const d of cleanups.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

/** Set up a temp dir with a legacy JSONL journal shard but NO new-format Obsidian MD events */
function makeRepoWithLegacyJournal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-journal-seam-'))
  cleanups.push(dir)
  // Legacy JSONL shard — the format hooks/journal.mjs writes
  const legacyDir = path.join(dir, '.groundwork', 'journal')
  fs.mkdirSync(legacyDir, { recursive: true })
  const shard = path.join(legacyDir, '2026-09-01-test-session.jsonl')
  fs.writeFileSync(shard, JSON.stringify({ ts: '2026-09-01T00:00:00.000Z', type: 'DECISION', motive: 'test', msg: 'test event', session: 'test-session' }) + '\n', 'utf8')
  // New-format motives root exists but has NO journal .md files (pre-migration)
  fs.mkdirSync(path.join(dir, '.groundwork', 'motives'), { recursive: true })
  return dir
}

function runJournalShow(repoDir: string) {
  return spawnSync(GW_HOOK, ['journal', 'show', '--json'], {
    cwd: repoDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: repoDir },
    encoding: 'utf8',
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gw journal store-path seam', () => {
  it('exits 1 with STORE_DIVERGENCE when legacy JSONL shards exist but new store has no events', () => {
    const repoDir = makeRepoWithLegacyJournal()
    const result = runJournalShow(repoDir)

    // Must NOT succeed silently
    expect(result.status, 'exit code must be 1, not 0').toBe(1)

    const combined = (result.stdout ?? '') + (result.stderr ?? '')

    // Red message must name both diverging paths
    const newStorePath = path.join(repoDir, '.groundwork', 'motives')
    const legacyPath = path.join(repoDir, '.groundwork', 'journal')

    expect(combined, `output must reference new store path ${newStorePath}`).toContain(newStorePath)
    expect(combined, `output must reference legacy store path ${legacyPath}`).toContain(legacyPath)

    // Must contain the STORE_DIVERGENCE error code or message keyword
    expect(combined, 'output must mention STORE_DIVERGENCE or divergence').toMatch(/STORE_DIVERGENCE|diverge/i)
  })

  it('exits 0 with "no events found" when neither legacy nor new store has data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-journal-empty-'))
    cleanups.push(dir)
    // Empty .groundwork — no journal dir, no motives
    fs.mkdirSync(path.join(dir, '.groundwork'), { recursive: true })

    const result = runJournalShow(dir)

    expect(result.status, 'empty store should exit 0').toBe(0)
    const combined = (result.stdout ?? '') + (result.stderr ?? '')
    expect(combined).toMatch(/no events found/i)
  })

  it('gw locate and gw journal use the same tracker path (.groundwork)', () => {
    // gw locate motive:<slug> outputs a path under .groundwork/motives/
    // gw journal show looks for events under .groundwork/motives/ too
    // Verify by checking a STORE_DIVERGENCE error message contains .groundwork/motives
    // (not .groundwork/next/motives)
    const repoDir = makeRepoWithLegacyJournal()
    const result = runJournalShow(repoDir)

    const combined = (result.stdout ?? '') + (result.stderr ?? '')
    // Must reference .groundwork/motives (tracker='.groundwork'), NOT .groundwork/next/motives
    expect(combined, 'divergence path must use .groundwork, not .groundwork/next').not.toContain('.groundwork/next')
    expect(combined).toContain(path.join('.groundwork', 'motives'))
  })
})
