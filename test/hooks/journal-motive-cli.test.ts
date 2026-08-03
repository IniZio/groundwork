/**
 * S1 CLI tests: journal motive new, journal baseline, journal compile (new flags)
 *
 * Dispatch-level only — commands exist, route correctly, exit codes are correct.
 * Content assertions belong to S3/S4/S6. Stubs return inert defaults.
 *
 * Every test uses mkdtemp fixtures; never touches the real .groundwork/.
 */

// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { spawnSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const CLI = join(ROOT, 'hooks', 'journal.mjs')

function mkProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gw-motive-test-'))
  mkdirSync(join(dir, '.groundwork', 'journal'), { recursive: true })
  return dir
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
    JOURNAL_SESSION_ID: 'test-s1',
  }
}

function readShard(dir: string): object[] {
  const journalDir = join(dir, '.groundwork', 'journal')
  try {
    const files = require('fs').readdirSync(journalDir).filter((f: string) => f.endsWith('.jsonl'))
    const lines: object[] = []
    for (const f of files) {
      const raw = readFileSync(join(journalDir, f), 'utf8')
      for (const line of raw.split('\n').filter(Boolean)) {
        lines.push(JSON.parse(line))
      }
    }
    return lines
  } catch {
    return []
  }
}

function readEvents(dir: string): object[] {
  const { readdirSync } = require('fs')
  const journalDir = join(dir, '.groundwork', 'journal')
  const events: object[] = []
  let files: string[] = []
  try {
    files = readdirSync(journalDir).filter((f: string) => f.endsWith('.jsonl'))
  } catch {
    return events
  }
  for (const f of files) {
    const raw = readFileSync(join(journalDir, f), 'utf8')
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        events.push(JSON.parse(line))
      } catch { /* skip */ }
    }
  }
  return events
}

/** Append a JSONL event directly to a shard file */
function appendRawEvent(dir: string, shard: string, event: Record<string, unknown>): void {
  const journalDir = join(dir, '.groundwork', 'journal')
  writeFileSync(join(journalDir, shard), JSON.stringify(event) + '\n', { flag: 'a' })
}

/** Populate journal with minimal events for a motive */
function populateJournal(dir: string, motive: string, count = 3): void {
  for (let i = 0; i < count; i++) {
    appendRawEvent(dir, 'shard-a.jsonl', {
      ts: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      session: 'test-s1',
      motive,
      type: 'SESSION_START',
      msg: `event ${i}`,
    })
  }
}

// ---------------------------------------------------------------------------
// journal motive new (S1-AC1, S1-AC2, S1-AC3)
// ---------------------------------------------------------------------------

describe('journal motive new', () => {
  let projectDir: string

  beforeEach(() => { projectDir = mkProject() })
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }) })

  it('S1-AC1: creates charter file at charterPath and exits 0', () => {
    const r = run(['motive', 'new', 'demo', '--objective', 'Ship the wayfinder.'], projectEnv(projectDir))
    expect(r.status).toBe(0)
    const charterFile = join(projectDir, '.groundwork', 'motives', 'demo', 'motive.md')
    expect(existsSync(charterFile)).toBe(true)
  })

  it('S1-AC2: emits exactly one MOTIVE_CREATED event with data.objective', () => {
    const r = run(['motive', 'new', 'demo', '--objective', 'Ship it.'], projectEnv(projectDir))
    expect(r.status).toBe(0)
    const events = readEvents(projectDir)
    const created = events.filter((e: any) => e.type === 'MOTIVE_CREATED')
    expect(created).toHaveLength(1)
    expect((created[0] as any).data?.objective).toBe('Ship it.')
    expect((created[0] as any).motive).toBe('demo')
  })

  it('S1-AC2: MOTIVE_CREATED emitted even with empty --objective', () => {
    const r = run(['motive', 'new', 'demo2'], projectEnv(projectDir))
    expect(r.status).toBe(0)
    const events = readEvents(projectDir)
    const created = events.filter((e: any) => e.type === 'MOTIVE_CREATED')
    expect(created).toHaveLength(1)
    expect((created[0] as any).data).toHaveProperty('objective')
  })

  it('S1-AC3: re-running without --force exits 1 and does not modify the file', () => {
    run(['motive', 'new', 'demo', '--objective', 'Original.'], projectEnv(projectDir))
    const charterFile = join(projectDir, '.groundwork', 'motives', 'demo', 'motive.md')
    const before = readFileSync(charterFile, 'utf8')

    const r2 = run(['motive', 'new', 'demo', '--objective', 'Overwrite attempt.'], projectEnv(projectDir))
    expect(r2.status).toBe(1)
    expect(r2.stderr).toMatch(/already exists/)

    // File unchanged
    const after = readFileSync(charterFile, 'utf8')
    expect(after).toBe(before)
  })

  it('S1-AC3: --force overwrites the existing charter and emits no second MOTIVE_CREATED', () => {
    run(['motive', 'new', 'demo', '--objective', 'Original.'], projectEnv(projectDir))

    // With --force should succeed
    const r2 = run(['motive', 'new', 'demo', '--objective', 'Overwritten.', '--force'], projectEnv(projectDir))
    expect(r2.status).toBe(0)

    // Still only one MOTIVE_CREATED (force does not emit another)
    const events = readEvents(projectDir)
    const created = events.filter((e: any) => e.type === 'MOTIVE_CREATED')
    expect(created).toHaveLength(1)
  })

  it('exits 2 when no slug is given', () => {
    const r = run(['motive', 'new'], projectEnv(projectDir))
    expect(r.status).toBe(2)
  })

  it('exits 2 for unknown motive subcommand', () => {
    const r = run(['motive', 'bogus-subcmd'], projectEnv(projectDir))
    expect(r.status).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// journal baseline (S1-AC4)
// ---------------------------------------------------------------------------

describe('journal baseline', () => {
  let projectDir: string

  beforeEach(() => { projectDir = mkProject() })
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }) })

  it('S1-AC4: exits 0 and appends exactly one BASELINE event with data.name and data.shard', () => {
    const r = run(['baseline', 'b1', '--motive', 'demo'], projectEnv(projectDir))
    expect(r.status).toBe(0)
    const events = readEvents(projectDir)
    const baselines = events.filter((e: any) => e.type === 'BASELINE')
    expect(baselines).toHaveLength(1)
    const b = baselines[0] as any
    expect(b.data.name).toBe('b1')
    expect(typeof b.data.shard).toBe('string')
    // shard must be a basename (no path separators)
    expect(b.data.shard).not.toContain('/')
    expect(b.data.shard).toMatch(/\.jsonl$/)
  })

  it('S1-AC4: data.shard equals the basename of the shard file written to', () => {
    run(['baseline', 'b1', '--motive', 'demo'], projectEnv(projectDir))
    const events = readEvents(projectDir)
    const b = events.find((e: any) => e.type === 'BASELINE') as any
    const shardBasename = b.data.shard
    // The shard file must exist in .groundwork/journal/
    const shardPath = join(projectDir, '.groundwork', 'journal', shardBasename)
    expect(existsSync(shardPath)).toBe(true)
  })

  it('exits 2 without --motive', () => {
    const r = run(['baseline', 'b1'], projectEnv(projectDir))
    expect(r.status).toBe(2)
  })

  it('exits 2 without a name positional', () => {
    const r = run(['baseline', '--motive', 'demo'], projectEnv(projectDir))
    expect(r.status).toBe(2)
  })

  it('warns on duplicate name but still writes and exits 0', () => {
    run(['baseline', 'b1', '--motive', 'demo'], projectEnv(projectDir))
    const r2 = run(['baseline', 'b1', '--motive', 'demo'], projectEnv(projectDir))
    expect(r2.status).toBe(0)
    expect(r2.stderr).toMatch(/already exists/)
    // Two BASELINE events now
    const events = readEvents(projectDir)
    const baselines = events.filter((e: any) => e.type === 'BASELINE')
    expect(baselines).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// journal compile --at <name> (S1-AC5)
// ---------------------------------------------------------------------------

describe('journal compile --at baseline-name', () => {
  let projectDir: string

  beforeEach(() => { projectDir = mkProject() })
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }) })

  it('S1-AC5: numeric --at still works (ordinal path unchanged)', () => {
    populateJournal(projectDir, 'test-m', 3)
    const r = run(['compile', 'test-m', '--at', '2', '--no-ground-truth'], projectEnv(projectDir))
    expect(r.status).toBe(0)
  })

  it('S1-AC5: non-numeric --at with no matching baseline exits 2 and lists known baselines', () => {
    populateJournal(projectDir, 'test-m', 3)
    // No BASELINE events → known list is (none)
    const r = run(['compile', 'test-m', '--at', 'missing-baseline', '--no-ground-truth'], projectEnv(projectDir))
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/missing-baseline/)
    expect(r.stderr).toMatch(/Known baselines/)
  })

  it('S1-AC5: non-numeric --at with a BASELINE event in stream exits 2 when name mismatches and lists known baselines', () => {
    populateJournal(projectDir, 'test-m', 3)
    // Inject a BASELINE event named 'snap1'
    appendRawEvent(projectDir, 'shard-a.jsonl', {
      ts: '2026-01-01T00:01:00.000Z',
      session: 'test-s1',
      motive: 'test-m',
      type: 'BASELINE',
      msg: 'baseline: snap1',
      data: { name: 'snap1', shard: 'shard-a.jsonl' },
    })
    // Use a DIFFERENT name that does not exist → exit 2; message should list 'snap1'
    const r = run(['compile', 'test-m', '--at', 'nonexistent-baseline', '--no-ground-truth'], projectEnv(projectDir))
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('nonexistent-baseline')
    expect(r.stderr).toContain('snap1')
  })

  it('S1-AC5: non-numeric --at that resolves to a known baseline succeeds (exit 0)', () => {
    populateJournal(projectDir, 'test-m', 3)
    appendRawEvent(projectDir, 'shard-a.jsonl', {
      ts: '2026-01-01T00:01:00.000Z',
      session: 'test-s1',
      motive: 'test-m',
      type: 'BASELINE',
      msg: 'baseline: snap1',
      data: { name: 'snap1', shard: 'shard-a.jsonl' },
    })
    const r = run(['compile', 'test-m', '--at', 'snap1', '--no-ground-truth'], projectEnv(projectDir))
    expect(r.status).toBe(0)
  })

  it('S1-AC5: bare --at (no value) exits 2', () => {
    populateJournal(projectDir, 'test-m', 3)
    const r = run(['compile', 'test-m', '--at', '--no-ground-truth'], projectEnv(projectDir))
    // --at gets value '--no-ground-truth' due to flag parsing, but that's a non-numeric name → exit 2
    // OR if parsed as bare boolean → exit 2 with usage error
    expect(r.status).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// journal compile --html (S1-AC6)
// ---------------------------------------------------------------------------

describe('journal compile --html', () => {
  let projectDir: string

  beforeEach(() => { projectDir = mkProject() })
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }) })

  it('S1-AC6: --html writes .html file alongside .json/.md', () => {
    populateJournal(projectDir, 'test-m', 3)
    const r = run(['compile', 'test-m', '--html', '--no-ground-truth'], projectEnv(projectDir))
    expect(r.status).toBe(0)
    const htmlPath = join(projectDir, '.groundwork', 'compiled', 'test-m.html')
    expect(existsSync(htmlPath)).toBe(true)
  })

  it('S1-AC6: --stdout --html writes no files', () => {
    populateJournal(projectDir, 'test-m', 3)
    const r = run(['compile', 'test-m', '--html', '--stdout', '--no-ground-truth'], projectEnv(projectDir))
    expect(r.status).toBe(0)
    const htmlPath = join(projectDir, '.groundwork', 'compiled', 'test-m.html')
    const jsonPath = join(projectDir, '.groundwork', 'compiled', 'test-m.json')
    expect(existsSync(htmlPath)).toBe(false)
    expect(existsSync(jsonPath)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// journal compile --tbd (S1-AC8 / plan §tbd)
// ---------------------------------------------------------------------------

describe('journal compile --tbd', () => {
  let projectDir: string

  beforeEach(() => { projectDir = mkProject() })
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }) })

  it('with --tbd prints open items count to stderr and exits 0', () => {
    populateJournal(projectDir, 'test-m', 3)
    const r = run(['compile', 'test-m', '--tbd', '--no-ground-truth'], projectEnv(projectDir))
    expect(r.status).toBe(0)
    // Stub readCharter returns null so open_items is [] → count is 0
    expect(r.stderr).toMatch(/open TBD\/TBR items: 0/)
  })

  it('without --tbd no open-items count line is printed', () => {
    populateJournal(projectDir, 'test-m', 3)
    const r = run(['compile', 'test-m', '--no-ground-truth'], projectEnv(projectDir))
    expect(r.status).toBe(0)
    expect(r.stderr).not.toMatch(/open TBD\/TBR items/)
  })
})

// ---------------------------------------------------------------------------
// journal compile charter→compile join (S1-AC7)
// ---------------------------------------------------------------------------

describe('journal compile charter join', () => {
  let projectDir: string

  beforeEach(() => { projectDir = mkProject() })
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }) })

  it('S1-AC7: compile succeeds when a charter file exists on disk (join wired, stub returns null)', () => {
    populateJournal(projectDir, 'test-m', 3)
    // Create a charter file (stub readCharter still returns null, but path exists)
    const charterDir = join(projectDir, '.groundwork', 'motives', 'test-m')
    mkdirSync(charterDir, { recursive: true })
    writeFileSync(join(charterDir, 'motive.md'), '# Motive: test-m\n')

    const r = run(['compile', 'test-m', '--no-ground-truth'], projectEnv(projectDir))
    expect(r.status).toBe(0)
    // The join does not crash; real charter injection is verified by S3/wave-2 X-AC7
  })
})

// ---------------------------------------------------------------------------
// journal help (X-AC4 partial)
// ---------------------------------------------------------------------------

describe('journal help', () => {
  it('help output lists motive command', () => {
    const r = run(['help'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('motive')
  })

  it('help output lists baseline command', () => {
    const r = run(['help'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('baseline')
  })

  it('journal help motive exits 0 with usage', () => {
    const r = run(['help', 'motive'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('motive new')
  })

  it('journal help baseline exits 0 with usage', () => {
    const r = run(['help', 'baseline'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('--motive')
  })

  it('compile help lists --html and --tbd flags', () => {
    const r = run(['help', 'compile'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('--html')
    expect(r.stdout).toContain('--tbd')
  })
})
