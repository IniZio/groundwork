/**
 * Tests for test/helpers/motive-fixture.ts
 *
 * Verifies three properties:
 *  1. The fixture creates the expected directory structure with valid content.
 *  2. When bin/journal and bin/ledger are invoked with fix.env, writes land in
 *     the temp tree (verified by observing the new file / updated ledger).
 *  3. ISOLATION: the real `.groundwork/motives/groundwork-development/` directory
 *     is byte-for-byte unchanged after any mutation through the helper.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { createMotiveFixture, type MotiveFixture } from '../helpers/motive-fixture.js'

// ── CLI paths ────────────────────────────────────────────────────────────────

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const JOURNAL_MJS = path.join(ROOT, 'hooks', 'journal.mjs')
const LEDGER_MJS = path.join(ROOT, 'hooks', 'ledger.mjs')

// ── Real motive dir we must NEVER mutate ────────────────────────────────────

const REAL_MOTIVE_DIR = path.join(
  ROOT,
  '.groundwork',
  'motives',
  'groundwork-development',
)

/**
 * Stable snapshot of a directory: SHA-256 over the sorted (path, content) pairs
 * of every regular file under `dir`.  Consistent across repeated reads as long
 * as no file changes.
 */
function dirHash(dir: string): string {
  const h = createHash('sha256')
  function walk(d: string): void {
    const entries = readdirSync(d, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (e.isFile()) {
        h.update(path.relative(dir, full))
        h.update('\x00')
        h.update(readFileSync(full))
        h.update('\x00')
      }
    }
  }
  walk(dir)
  return h.digest('hex')
}

// ── Fixture lifecycle ────────────────────────────────────────────────────────

let fix: MotiveFixture

beforeEach(() => {
  fix = createMotiveFixture({
    slug: 'fixture-test-motive',
    acceptanceCriteria: [
      '- AC-1: first criterion',
      '- AC-2: second criterion',
    ],
  })
})

afterEach(() => {
  fix.cleanup()
})

// ── 1. Structure ─────────────────────────────────────────────────────────────

describe('createMotiveFixture — structure', () => {
  it('returns expected projectDir, motiveSlug, ledgerPath fields', () => {
    expect(fix.projectDir).toBeTruthy()
    expect(fix.motiveSlug).toBe('fixture-test-motive')
    expect(fix.ledgerPath).toBe(
      path.join(fix.projectDir, '.groundwork', 'run.json'),
    )
  })

  it('creates the .groundwork/journal/ directory', () => {
    expect(existsSync(path.join(fix.projectDir, '.groundwork', 'journal'))).toBe(true)
  })

  it('creates the pre-seeded journal shard with 3 JSONL lines', () => {
    const shardPath = path.join(fix.projectDir, '.groundwork', 'journal', 'fixture.jsonl')
    expect(existsSync(shardPath)).toBe(true)
    const lines = readFileSync(shardPath, 'utf8')
      .split('\n')
      .filter(Boolean)
    expect(lines).toHaveLength(3)
    const events = lines.map(l => JSON.parse(l))
    for (const ev of events) {
      expect(ev.motive).toBe('fixture-test-motive')
      expect(ev.type).toBe('SESSION_START')
    }
  })

  it('creates the charter at motives/<slug>/motive.md', () => {
    const charterPath = path.join(
      fix.projectDir,
      '.groundwork',
      'motives',
      fix.motiveSlug,
      'motive.md',
    )
    expect(existsSync(charterPath)).toBe(true)
    const content = readFileSync(charterPath, 'utf8')
    expect(content).toContain('# motive: fixture-test-motive')
    expect(content).toContain('## Acceptance criteria')
    expect(content).toContain('- AC-1: first criterion')
    expect(content).toContain('- AC-2: second criterion')
  })

  it('creates a valid JSON ledger at .groundwork/run.json', () => {
    expect(existsSync(fix.ledgerPath)).toBe(true)
    const ledger = JSON.parse(readFileSync(fix.ledgerPath, 'utf8'))
    expect(ledger.version).toBe(1)
    expect(ledger.active).toBe(true)
    expect(ledger.session_id).toBeNull()
    expect(Array.isArray(ledger.slices)).toBe(true)
    expect(ledger.gate).toBeDefined()
  })

  it('env contains CLAUDE_PROJECT_DIR pointing at temp dir', () => {
    expect(fix.env['CLAUDE_PROJECT_DIR']).toBe(fix.projectDir)
  })

  it('env does NOT contain CLAUDE_CODE_SESSION_ID', () => {
    expect(fix.env['CLAUDE_CODE_SESSION_ID']).toBeUndefined()
  })

  it('cleanup removes the entire temp tree', () => {
    const dir = fix.projectDir
    expect(existsSync(dir)).toBe(true)
    fix.cleanup()
    expect(existsSync(dir)).toBe(false)
    // Prevent afterEach double-cleanup from erroring (rmSync force:true is safe)
  })
})

// ── 2. CLI redirection ───────────────────────────────────────────────────────

describe('createMotiveFixture — CLI redirection', () => {
  it('journal append writes to the temp tree, not the real .groundwork/', () => {
    // Run journal append against the fixture env
    const r = spawnSync(
      process.execPath,
      [JOURNAL_MJS, 'append',
        '--motive', fix.motiveSlug,
        '--type', 'TASK_COMPLETE',
        '--msg', 'isolation probe'],
      { encoding: 'utf8', env: fix.env },
    )
    expect(r.status).toBe(0)

    // A new dated shard must appear in the TEMP journal dir
    const journalDir = path.join(fix.projectDir, '.groundwork', 'journal')
    const shards = readdirSync(journalDir).filter(f => f.endsWith('.jsonl'))
    // At least one shard beyond the pre-seeded fixture.jsonl (the new dated shard)
    expect(shards.length).toBeGreaterThanOrEqual(2)

    // The new event must appear somewhere in the temp journal dir
    const allEvents: Record<string, unknown>[] = []
    for (const shard of shards) {
      const raw = readFileSync(path.join(journalDir, shard), 'utf8')
      for (const line of raw.split('\n').filter(Boolean)) {
        allEvents.push(JSON.parse(line))
      }
    }
    const probe = allEvents.find(
      ev => ev['type'] === 'TASK_COMPLETE' && ev['msg'] === 'isolation probe',
    )
    expect(probe).toBeDefined()
    expect(probe!['motive']).toBe(fix.motiveSlug)
  })

  it('ledger add writes to the temp tree run.json', () => {
    const r = spawnSync(
      process.execPath,
      [LEDGER_MJS, 'add', 'T1', '--desc', 'probe slice', '--wave', '0'],
      { encoding: 'utf8', env: fix.env },
    )
    expect(r.status).toBe(0)
    const ledger = JSON.parse(readFileSync(fix.ledgerPath, 'utf8'))
    const slice = ledger.slices.find((s: Record<string, unknown>) => s['id'] === 'T1')
    expect(slice).toBeDefined()
    expect(slice['desc']).toBe('probe slice')
  })

  it('journal compile reads from the temp tree and outputs compiled JSON', () => {
    const r = spawnSync(
      process.execPath,
      [JOURNAL_MJS, 'compile', fix.motiveSlug, '--json', '--no-ground-truth'],
      { encoding: 'utf8', env: fix.env },
    )
    expect(r.status).toBe(0)
    const parsed = JSON.parse(r.stdout)
    expect(parsed).toHaveProperty('compiler_version')
    expect(parsed).toHaveProperty('agent')
  })
})

// ── 3. Isolation ─────────────────────────────────────────────────────────────

describe('createMotiveFixture — isolation from real .groundwork/', () => {
  it('leaves .groundwork/motives/groundwork-development/ byte-unchanged after mutations', () => {
    // Guard: the real motive dir must exist for this test to mean anything
    if (!existsSync(REAL_MOTIVE_DIR)) {
      console.warn('SKIP: real motive dir not found at', REAL_MOTIVE_DIR)
      return
    }

    const before = dirHash(REAL_MOTIVE_DIR)

    // Perform multiple mutations through the fixture
    spawnSync(process.execPath,
      [JOURNAL_MJS, 'append',
        '--motive', fix.motiveSlug,
        '--type', 'TASK_COMPLETE',
        '--msg', 'isolation check 1'],
      { encoding: 'utf8', env: fix.env })

    spawnSync(process.execPath,
      [JOURNAL_MJS, 'append',
        '--motive', fix.motiveSlug,
        '--type', 'TASK_COMPLETE',
        '--msg', 'isolation check 2'],
      { encoding: 'utf8', env: fix.env })

    spawnSync(process.execPath,
      [LEDGER_MJS, 'add', 'ISO1', '--desc', 'isolation slice', '--wave', '0'],
      { encoding: 'utf8', env: fix.env })

    spawnSync(process.execPath,
      [JOURNAL_MJS, 'compile', fix.motiveSlug, '--json', '--no-ground-truth'],
      { encoding: 'utf8', env: fix.env })

    const after = dirHash(REAL_MOTIVE_DIR)
    expect(after).toBe(before)
  })
})
