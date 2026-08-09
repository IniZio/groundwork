/**
 * Parity test: motive-archive open-item event-resolution gate.
 *
 * Guards the contract "an open item resolved by an accepted DECISION event
 * is not open" across TWO surfaces simultaneously:
 *   (A) compile surface  — hooks/lib/motive-compile.mjs : open_items_summary.open === 0
 *   (B) archive gate     — hooks/journal.mjs cmdMotiveArchive  : exits 0 without --force
 *
 * A single regression on either surface turns this test red — even if that
 * surface's own unit tests stay green.
 *
 * Invariant:
 *   Given a motive whose EVERY open item is resolved by an accepted DECISION
 *   event (data.resolves = item.id), BOTH surfaces must treat the motive as
 *   fully resolved.
 *
 * See: archive-gate-ignores-event-resolution (MEMORY.md), motive-map.mjs:70-88.
 */

// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// @ts-ignore
import { compile } from '../../hooks/lib/motive-compile.mjs'
// @ts-ignore
import { readCharter } from '../../hooks/lib/motive-charter.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const CLI  = join(ROOT, 'hooks', 'journal.mjs')

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'gw-archive-evres-'))
}

function makeMotiveDir(dir: string, slug: string): string {
  const motiveDir = join(dir, '.groundwork', 'motives', slug)
  mkdirSync(motiveDir, { recursive: true })
  return motiveDir
}

function writeCharter(dir: string, slug: string, openItemsSection: string): void {
  const motiveDir = makeMotiveDir(dir, slug)
  const md = `# motive: ${slug}\n\n## Objective\n\nTest motive.\n\n## Open items\n\n${openItemsSection}\n`
  writeFileSync(join(motiveDir, 'motive.md'), md, 'utf8')
}

function writeJournalEvents(dir: string, events: object[]): void {
  const journalDir = join(dir, '.groundwork', 'journal')
  mkdirSync(journalDir, { recursive: true })
  const lines = events.map((e) => JSON.stringify(e)).join('\n')
  writeFileSync(join(journalDir, '2026-01-01-test.jsonl'), lines + '\n', 'utf8')
}

function run(
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

function projectEnv(dir: string): Record<string, string> {
  return {
    CLAUDE_PROJECT_DIR: dir,
    JOURNAL_SESSION_ID: 'test-archive-evres',
  }
}

// ---------------------------------------------------------------------------
// Fixture: motive with two TBD items, both resolved by accepted DECISION events
// ---------------------------------------------------------------------------
const SLUG = 'evt-resolved-motive'
const OPEN_ITEMS_MD = '- TBD-1: Which database engine to use?\n- TBD-2: Which caching strategy?\n'

const DECISION_EVENTS = [
  {
    ts: '2026-01-01T10:00:00Z',
    session: 'sess-a',
    motive: SLUG,
    type: 'DECISION',
    msg: 'Decided to use PostgreSQL',
    data: { id: 'D-1', status: 'accepted', resolves: 'TBD-1' },
  },
  {
    ts: '2026-01-01T10:01:00Z',
    session: 'sess-a',
    motive: SLUG,
    type: 'DECISION',
    msg: 'Decided to use Redis for caching',
    data: { id: 'D-2', status: 'accepted', resolves: 'TBD-2' },
  },
]

// ---------------------------------------------------------------------------
// Parity suite — BOTH surfaces must be green for the test to pass
// ---------------------------------------------------------------------------

describe('motive-archive event-resolution parity — both surfaces', () => {
  let dir: string

  beforeEach(() => {
    dir = tmp()
    writeCharter(dir, SLUG, OPEN_ITEMS_MD)
    writeJournalEvents(dir, DECISION_EVENTS)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // ── Surface A: compile ────────────────────────────────────────────────────
  it('A — compile surface: open_items_summary.open === 0 when all items are resolved by DECISION events', () => {
    const charter = readCharter({ projectDir: dir, motive: SLUG })!
    expect(charter).not.toBeNull()
    expect(charter.open_items).toHaveLength(2)

    // Build events array the same way journal compile does: read charter + events
    const events = DECISION_EVENTS.map((e, i) => ({ ...e, _order: { shard: 'test.jsonl', line: i } }))
    const view = compile(events, { charter })

    expect(view.agent.open_items_summary.open, 'compile should see 0 open items after event resolution').toBe(0)
    expect(view.agent.open_items_summary.resolved, 'compile should see 2 resolved items').toBe(2)
    // Both items carry resolved_by
    const unresolved = view.agent.open_items.filter((i: any) => i.resolved_by == null)
    expect(unresolved, 'compile: no open_items should have resolved_by=null').toHaveLength(0)
  })

  // ── Surface B: archive gate ───────────────────────────────────────────────
  it('B — archive gate: exits 0 without --force when all items are resolved by DECISION events', () => {
    const r = run(['motive', 'archive', SLUG], projectEnv(dir))
    expect(r.status, `archive should exit 0; stderr: ${r.stderr}`).toBe(0)
    // Motive directory should be gone (moved to archive)
    const motiveDir = join(dir, '.groundwork', 'motives', SLUG)
    expect(existsSync(motiveDir), 'motive dir should have been moved').toBe(false)
    const archiveDir = join(dir, '.groundwork', 'archive', 'motives', SLUG)
    expect(existsSync(archiveDir), 'archive dir should exist').toBe(true)
  })

  // ── Seam: both surfaces in one assertion ──────────────────────────────────
  it('SEAM — compile AND archive agree: an all-resolved motive passes both gates', () => {
    // Compile surface must say zero open items
    const charter = readCharter({ projectDir: dir, motive: SLUG })
    const events = DECISION_EVENTS.map((e, i) => ({ ...e, _order: { shard: 'test.jsonl', line: i } }))
    const view = compile(events, { charter })
    const compileOpen = view.agent.open_items_summary.open

    // Archive gate must succeed
    const archiveResult = run(['motive', 'archive', SLUG], projectEnv(dir))

    expect(compileOpen, 'compile surface: open count should be 0').toBe(0)
    expect(archiveResult.status, `archive gate: should exit 0; stderr: ${archiveResult.stderr}`).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Negative cases — genuinely open items must still block archive
// ---------------------------------------------------------------------------

describe('motive-archive event-resolution — negative cases', () => {
  let dir: string

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 1 without --force when TBD items have NO resolving DECISION events', () => {
    dir = tmp()
    writeCharter(dir, SLUG, OPEN_ITEMS_MD)
    // No DECISION events written — items remain open
    const r = run(['motive', 'archive', SLUG], projectEnv(dir))
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/open TBD\/TBR items/)
    // Motive dir must still be in place
    const motiveDir = join(dir, '.groundwork', 'motives', SLUG)
    expect(existsSync(motiveDir)).toBe(true)
  })

  it('exits 1 when only ONE of two items is resolved', () => {
    dir = tmp()
    writeCharter(dir, SLUG, OPEN_ITEMS_MD)
    // Only TBD-1 resolved; TBD-2 remains open
    writeJournalEvents(dir, [DECISION_EVENTS[0]])
    const r = run(['motive', 'archive', SLUG], projectEnv(dir))
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/open TBD\/TBR items/)
  })

  it('exits 1 when DECISION event has status "rejected" (not accepted)', () => {
    dir = tmp()
    writeCharter(dir, SLUG, OPEN_ITEMS_MD)
    writeJournalEvents(dir, [
      { ...DECISION_EVENTS[0], data: { ...DECISION_EVENTS[0].data, status: 'rejected' } },
      DECISION_EVENTS[1],
    ])
    const r = run(['motive', 'archive', SLUG], projectEnv(dir))
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/open TBD\/TBR items/)
  })

  it('exits 0 with --force even when items are unresolved', () => {
    dir = tmp()
    writeCharter(dir, SLUG, OPEN_ITEMS_MD)
    // No events — but --force overrides
    const r = run(['motive', 'archive', SLUG, '--force'], projectEnv(dir))
    expect(r.status).toBe(0)
  })

  it('exits 0 when charter has no open items at all', () => {
    dir = tmp()
    const emptySlug = 'no-items-motive'
    writeCharter(dir, emptySlug, '<!-- no open items -->')
    const r = run(['motive', 'archive', emptySlug], projectEnv(dir))
    expect(r.status).toBe(0)
  })
})
