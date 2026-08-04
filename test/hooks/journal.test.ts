/**
 * Tests for hooks/journal.mjs and hooks/lib/journal-io.mjs
 *
 * AC coverage map:
 *  AC 1  — append-creates-line, append-exit-zero
 *  AC 2  — invalid-type-exits-2, invalid-type-lists-types
 *  AC 3  — show-motive-filter-across-shards
 *  AC 4  — concurrent-append-no-interleaving  (genuine multi-process)
 *  AC 5  — never-rewrite  (mutation proof)
 *  AC 6  — show-defaults-since7d-last30, withheld-footer  (mutation proof)
 *  AC 7  — brief-at-most-2-lines
 *  AC 8  — digest-summary-plus-verbatim-tail
 *  AC 9  — decision-spec-change-never-compressed  (mutation proof)
 *  AC 10 — digest-prints-recovery-command
 *  AC 11 — --motive is the only scope flag; --rfc is unknown/rejected
 */

// @ts-nocheck
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { describe, expect, test, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '../..')
const CLI = path.join(ROOT, 'hooks', 'journal.mjs')

function mkTmp(): string {
  return mkdtempSync(path.join(tmpdir(), 'journal-test-'))
}

function runJournal(
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

function journalEnv(projectDir: string, sessionId: string): Record<string, string> {
  return {
    CLAUDE_PROJECT_DIR: projectDir,
    JOURNAL_SESSION_ID: sessionId,
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function shardPath(projectDir: string, sessionId: string): string {
  return path.join(projectDir, '.groundwork', 'journal', `${today()}-${sessionId}.jsonl`)
}

function readShard(p: string): object[] {
  try {
    return readFileSync(p, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// AC 1 — append creates exactly one JSON line, exits 0
// ---------------------------------------------------------------------------

describe('AC 1 — append writes one line', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('append-creates-shard-and-exits-0', () => {
    const env = journalEnv(tmp, 'sess1')
    const r = runJournal(
      ['append', '--motive', 'R-001', '--type', 'MILESTONE', '--msg', 'wave 1 landed'],
      env,
    )
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)

    const events = readShard(shardPath(tmp, 'sess1'))
    expect(events).toHaveLength(1)
    const e = events[0] as any
    expect(e.motive).toBe('R-001')
    expect(e.type).toBe('MILESTONE')
    expect(e.msg).toBe('wave 1 landed')
    expect(e.session).toBe('sess1')
    expect(e.source).toBe('cli:journal')
    expect(typeof e.ts).toBe('string')
  })

  test('append-second-event-appends-not-overwrites', () => {
    const env = journalEnv(tmp, 'sess1')
    runJournal(['append', '--motive', 'R-001', '--type', 'MILESTONE', '--msg', 'first'], env)
    runJournal(['append', '--motive', 'R-001', '--type', 'FAILURE', '--msg', 'second'], env)

    const events = readShard(shardPath(tmp, 'sess1'))
    expect(events).toHaveLength(2)
    expect((events[0] as any).type).toBe('MILESTONE')
    expect((events[1] as any).type).toBe('FAILURE')
  })

  test('append-with-data-field', () => {
    const env = journalEnv(tmp, 'sess1')
    runJournal(
      ['append', '--motive', 'R-001', '--type', 'SPEC_CHANGE', '--msg', 'rev 2',
        '--data', '{"concept":"C-FOO","revision":2}'],
      env,
    )
    const events = readShard(shardPath(tmp, 'sess1'))
    expect((events[0] as any).data).toEqual({ concept: 'C-FOO', revision: 2 })
  })
})

// ---------------------------------------------------------------------------
// AC 2 — invalid type exits 2 and lists valid types
// ---------------------------------------------------------------------------

describe('AC 2 — invalid type error', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('invalid-type-exits-2', () => {
    const r = runJournal(
      ['append', '--motive', 'R-001', '--type', 'BOGUS_TYPE', '--msg', 'hi'],
      journalEnv(tmp, 'sess1'),
    )
    expect(r.status).toBe(2)
  })

  test('invalid-type-lists-all-14-types-including-new', () => {
    const r = runJournal(
      ['append', '--motive', 'R-001', '--type', 'BOGUS', '--msg', 'hi'],
      journalEnv(tmp, 'sess1'),
    )
    const combined = r.stderr + r.stdout
    const EXPECTED = [
      'DECISION', 'SPEC_CHANGE', 'LINT_DRIFT',
      'PROTOTYPE_RESULT', 'FAILURE', 'MILESTONE', 'TASK_COMPLETE',
      'GATE', 'VERIFICATION', 'WAIVER', 'HANDOFF', 'SESSION_START',
      'SPEC_DRIFT', 'SESSION_END',
    ]
    for (const t of EXPECTED) {
      expect(combined, `missing type ${t} in error output`).toContain(t)
    }
  })

  test('missing-required-flags-exits-2', () => {
    const r = runJournal(['append', '--motive', 'R-001'], journalEnv(tmp, 'sess1'))
    expect(r.status).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// AC 3 — show --motive reads all shards and filters by motive
// ---------------------------------------------------------------------------

describe('AC 3 — show --motive across shards', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('show-motive-filters-across-two-shards-ordered-by-ts', () => {
    const journalDir = path.join(tmp, '.groundwork', 'journal')
    mkdirSync(journalDir, { recursive: true })

    const ts1 = '2026-07-24T10:00:00Z'
    const ts2 = '2026-07-25T10:00:00Z'
    const ts3 = '2026-07-25T11:00:00Z'

    writeFileSync(
      path.join(journalDir, '2026-07-24-sessA.jsonl'),
      JSON.stringify({ ts: ts1, session: 'sessA', motive: 'R-001', type: 'MILESTONE', msg: 'first' }) + '\n' +
      JSON.stringify({ ts: ts2, session: 'sessA', motive: 'R-002', type: 'FAILURE', msg: 'other motive' }) + '\n',
    )
    writeFileSync(
      path.join(journalDir, '2026-07-25-sessB.jsonl'),
      JSON.stringify({ ts: ts3, session: 'sessB', motive: 'R-001', type: 'GATE', msg: 'approved' }) + '\n',
    )

    const r = runJournal(
      ['show', '--motive', 'R-001', '--since', '9999d', '--last', '9999'],
      { CLAUDE_PROJECT_DIR: tmp, JOURNAL_SESSION_ID: 'sessB' },
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('MILESTONE')
    expect(r.stdout).toContain('GATE')
    expect(r.stdout).not.toContain('FAILURE')

    // ts1 must appear before ts3 (ascending order)
    const milestonePos = r.stdout.indexOf('MILESTONE')
    const gatePos = r.stdout.indexOf('GATE')
    expect(milestonePos).toBeLessThan(gatePos)
  })
})

// ---------------------------------------------------------------------------
// AC 4 — concurrent append safety (genuine multi-process)
// ---------------------------------------------------------------------------

describe('AC 4 — concurrent append (multi-process)', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('concurrent-appends-produce-valid-json-no-interleaving', async () => {
    const PROCESSES = 20
    const SESSION = 'concsess'
    const env = {
      ...process.env,
      CLAUDE_PROJECT_DIR: tmp,
      JOURNAL_SESSION_ID: SESSION,
    }

    // Spawn PROCESSES concurrent appenders
    const children = Array.from({ length: PROCESSES }, (_, i) =>
      new Promise<void>((resolve, reject) => {
        const p = spawn('node', [
          CLI, 'append',
          '--motive', 'R-CONC',
          '--type', 'MILESTONE',
          '--msg', `concurrent event ${i}`,
        ], { env })
        p.on('close', code => {
          if (code === 0) resolve()
          else reject(new Error(`process ${i} exited with code ${code}`))
        })
      }),
    )

    await Promise.all(children)

    const shard = shardPath(tmp, SESSION)
    const lines = readFileSync(shard, 'utf8')
      .split('\n')
      .filter(Boolean)

    // Exactly PROCESSES lines written
    expect(lines).toHaveLength(PROCESSES)

    // Every line must be valid JSON
    for (const line of lines) {
      let parsed: any
      expect(() => { parsed = JSON.parse(line) }, `not valid JSON: ${line}`).not.toThrow()
      expect(parsed.type).toBe('MILESTONE')
      expect(parsed.motive).toBe('R-CONC')
    }
  }, 30_000)
})

// ---------------------------------------------------------------------------
// AC 5 — never rewrite or truncate (mutation proof)
// ---------------------------------------------------------------------------

describe('AC 5 — never rewrite / truncate', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('second-append-does-not-truncate-first-line', () => {
    const env = journalEnv(tmp, 'sessNR')
    runJournal(['append', '--motive', 'R-1', '--type', 'DECISION', '--msg', 'keep me',
      '--data', '{"id":"D-1","decision":"use ESM","rationale":"native Node support"}'], env)

    // Capture byte length after first write
    const shard = shardPath(tmp, 'sessNR')
    const lenAfterFirst = readFileSync(shard).length

    runJournal(['append', '--motive', 'R-1', '--type', 'MILESTONE', '--msg', 'second'], env)

    const lenAfterSecond = readFileSync(shard).length
    // File must have grown, never shrunk
    expect(lenAfterSecond).toBeGreaterThan(lenAfterFirst)
  })

  /**
   * MUTATION PROOF for AC 5:
   * If we change appendEvent to use 'w' (truncate) instead of 'a' (append),
   * the test above fails because the file would only ever contain one line.
   */
  test('shard-file-is-never-shorter-after-append-mutation-guard', () => {
    const env = journalEnv(tmp, 'sessNR2')
    const shard = shardPath(tmp, 'sessNR2')

    // Write 5 events
    for (let i = 0; i < 5; i++) {
      runJournal(['append', '--motive', 'R-1', '--type', 'MILESTONE', '--msg', `event ${i}`], env)
    }

    const lines = readShard(shard)
    // All 5 must be present — a truncating write would leave only the last
    expect(lines).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// AC 6 — show defaults + withheld footer (mutation proof)
// ---------------------------------------------------------------------------

describe('AC 6 — show defaults: --since 7d, --last 30, withheld footer', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  function writeEvent(journalDir: string, shard: string, overrides: object) {
    mkdirSync(journalDir, { recursive: true })
    const event = {
      ts: new Date().toISOString(),
      session: 'sx',
      motive: 'R-DEF',
      type: 'MILESTONE',
      msg: 'test',
      ...overrides,
    }
    const fp = path.join(journalDir, shard)
    writeFileSync(fp, JSON.stringify(event) + '\n', { flag: 'a' })
  }

  test('bare-show-applies-since-7d-and-last-30', () => {
    const journalDir = path.join(tmp, '.groundwork', 'journal')

    // Write 35 recent events and 2 old events
    for (let i = 0; i < 35; i++) {
      const ts = new Date(Date.now() - i * 60_000).toISOString() // recent
      writeEvent(journalDir, `${today()}-sx.jsonl`, { ts, msg: `recent ${i}` })
    }
    // Old event (10 days ago) — should be excluded by --since 7d
    const oldTs = new Date(Date.now() - 10 * 24 * 3600_000).toISOString()
    writeEvent(journalDir, '2000-01-01-sx.jsonl', { ts: oldTs, msg: 'ancient' })

    const r = runJournal(
      ['show'],
      { CLAUDE_PROJECT_DIR: tmp, JOURNAL_SESSION_ID: 'sx' },
    )

    // No --motive, no --since → shows ≤ 30 events from last 7d
    expect(r.stdout).not.toContain('ancient')

    // Footer must appear (35 recent events → 5 withheld by --last 30)
    expect(r.stdout).toMatch(/older events not shown/)
    expect(r.stdout).toContain('--last 30')
    expect(r.stdout).toContain('--since 7d')
  })

  test('withheld-count-is-accurate', () => {
    const journalDir = path.join(tmp, '.groundwork', 'journal')

    // Write exactly 40 recent events
    for (let i = 0; i < 40; i++) {
      const ts = new Date(Date.now() - i * 60_000).toISOString()
      writeEvent(journalDir, `${today()}-sx2.jsonl`, { ts, msg: `e ${i}` })
    }

    const r = runJournal(
      ['show'],
      { CLAUDE_PROJECT_DIR: tmp, JOURNAL_SESSION_ID: 'sx2' },
    )
    // 40 recent - 30 shown = 10 withheld
    expect(r.stdout).toContain('10 older events not shown')
  })
})

// ---------------------------------------------------------------------------
// AC 7 — --brief emits at most 2 lines per event
// ---------------------------------------------------------------------------

describe('AC 7 — --brief mode', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('brief-emits-at-most-2-lines-per-event', () => {
    const env = journalEnv(tmp, 'sessB')

    // Append event with data (full format would be 3 lines)
    runJournal(
      ['append', '--motive', 'R-007', '--type', 'SPEC_CHANGE', '--msg', 'rev 3',
        '--data', '{"concept":"C-X","revision":3}'],
      env,
    )
    runJournal(['append', '--motive', 'R-007', '--type', 'MILESTONE', '--msg', 'done'], env)

    const r = runJournal(
      ['show', '--motive', 'R-007', '--since', '9999d', '--brief'],
      env,
    )
    expect(r.status).toBe(0)

    // Count non-empty output lines (excluding footer)
    const lines = r.stdout.split('\n').filter(l => l.trim() && !l.startsWith('…'))
    // 2 events × at most 2 lines each = at most 4 lines
    expect(lines.length).toBeLessThanOrEqual(4)
    // Must not emit data line in brief mode
    expect(r.stdout).not.toContain('data:')
  })
})

// ---------------------------------------------------------------------------
// AC 8 — digest emits summary of prefix + verbatim tail
// ---------------------------------------------------------------------------

describe('AC 8 — digest command', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  function writeManyEvents(journalDir: string, motive: string, n: number) {
    mkdirSync(journalDir, { recursive: true })
    const fp = path.join(journalDir, `${today()}-sd.jsonl`)
    for (let i = 0; i < n; i++) {
      const ts = new Date(Date.now() - (n - i) * 1000).toISOString()
      const line = JSON.stringify({
        ts, session: 'sd', motive, type: 'MILESTONE', msg: `event ${i}`,
      })
      writeFileSync(fp, line + '\n', { flag: 'a' })
    }
  }

  test('digest-emits-verbatim-when-below-trigger', () => {
    const env = { CLAUDE_PROJECT_DIR: tmp, JOURNAL_SESSION_ID: 'sd' }
    const journalDir = path.join(tmp, '.groundwork', 'journal')
    writeManyEvents(journalDir, 'R-DIG', 5)

    const r = runJournal(['digest', '--motive', 'R-DIG'], env)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('event 0')
    expect(r.stdout).toContain('event 4')
  })

  test('digest-with-rebuild-produces-summary-and-tail', () => {
    const env = { CLAUDE_PROJECT_DIR: tmp, JOURNAL_SESSION_ID: 'sd2' }
    const journalDir = path.join(tmp, '.groundwork', 'journal')
    // Write 65 events → tail trigger (60) exceeded, folds 35 into prefix, keeps 30
    writeManyEvents(journalDir, 'R-DIG2', 65)

    const r = runJournal(['digest', '--motive', 'R-DIG2', '--rebuild'], env)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('DIGEST SUMMARY')
    expect(r.stdout).toContain('VERBATIM TAIL')
  })
})

// ---------------------------------------------------------------------------
// AC 9 — DECISION and SPEC_CHANGE never compressed (mutation proof)
// ---------------------------------------------------------------------------

describe('AC 9 — DECISION/SPEC_CHANGE never in digest summary', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('decision-and-spec-change-appear-verbatim-in-digest-not-in-summary-count', () => {
    const journalDir = path.join(tmp, '.groundwork', 'journal')
    mkdirSync(journalDir, { recursive: true })
    const fp = path.join(journalDir, `${today()}-sd9.jsonl`)

    // Put DECISION and SPEC_CHANGE at the OLDEST timestamps so they land in the
    // folded prefix (not the verbatim tail) when --rebuild is applied.
    const baseTs = Date.now() - 200_000 // 200 s ago — oldest
    const tsD = new Date(baseTs).toISOString()
    writeFileSync(fp, JSON.stringify({
      ts: tsD, session: 'sd9', motive: 'R-NC', type: 'DECISION',
      msg: 'chose approach A because of reason X',
    }) + '\n', { flag: 'a' })
    const tsSC = new Date(baseTs + 1000).toISOString()
    writeFileSync(fp, JSON.stringify({
      ts: tsSC, session: 'sd9', motive: 'R-NC', type: 'SPEC_CHANGE',
      msg: 'C-FOO rev 3->4',
    }) + '\n', { flag: 'a' })

    // Write 63 more MILESTONE events (newer, will fill the rest of the 65-event total)
    for (let i = 0; i < 63; i++) {
      const ts = new Date(baseTs + 2000 + i * 1000).toISOString()
      writeFileSync(fp, JSON.stringify({
        ts, session: 'sd9', motive: 'R-NC', type: 'MILESTONE', msg: `event ${i}`,
      }) + '\n', { flag: 'a' })
    }

    const env = { CLAUDE_PROJECT_DIR: tmp, JOURNAL_SESSION_ID: 'sd9' }
    const r = runJournal(['digest', '--motive', 'R-NC', '--rebuild'], env)
    expect(r.status).toBe(0)

    // DECISION and SPEC_CHANGE must NOT appear in the "N event(s)" summary counts
    // but MUST appear somewhere in the output (preserved verbatim)
    const summarySection = r.stdout.split('VERBATIM TAIL')[0]
    expect(summarySection).not.toMatch(/DECISION:\s+\d+ event/)
    expect(summarySection).not.toMatch(/SPEC_CHANGE:\s+\d+ event/)

    // Their messages must be visible (preserved section or tail)
    expect(r.stdout).toContain('chose approach A because of reason X')
    expect(r.stdout).toContain('C-FOO rev 3->4')
  })
})

// ---------------------------------------------------------------------------
// AC 11 — --motive is the only scope flag; --rfc is unknown/rejected
// ---------------------------------------------------------------------------

describe('AC 11 — --motive only; --rfc removed', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('append --motive writes motive key, no rfc key, source=cli:journal', () => {
    const env = journalEnv(tmp, 'sessM')
    const r = runJournal(
      ['append', '--motive', 'my-feature', '--type', 'MILESTONE', '--msg', 'motive test'],
      env,
    )
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)
    expect(r.stderr).not.toContain('deprecated')

    const events = readShard(shardPath(tmp, 'sessM'))
    expect(events).toHaveLength(1)
    const e = events[0] as any
    expect(e.motive).toBe('my-feature')
    expect(e.rfc).toBeUndefined()
    expect(e.source).toBe('cli:journal')
    expect(e.type).toBe('MILESTONE')
  })

  test('append --rfc is treated as an unknown flag (no special handling)', () => {
    const env = journalEnv(tmp, 'sessRfc')
    // With --rfc alone (no --motive), append should exit 2 for missing --motive
    const r = runJournal(
      ['append', '--rfc', 'R-OLD', '--type', 'MILESTONE', '--msg', 'old caller'],
      env,
    )
    // No special deprecated handling — --rfc is just an unknown flag; --motive is missing
    expect(r.status).toBe(2)
    expect(r.stderr).not.toContain('deprecated')
  })

  test('show --motive works as filter without deprecation warning', () => {
    const env = journalEnv(tmp, 'sessMS')
    runJournal(['append', '--motive', 'feat-a', '--type', 'MILESTONE', '--msg', 'a'], env)
    runJournal(['append', '--motive', 'feat-b', '--type', 'MILESTONE', '--msg', 'b'], env)

    const r = runJournal(['show', '--motive', 'feat-a', '--since', '9999d'], env)
    expect(r.status).toBe(0)
    expect(r.stderr).not.toContain('deprecated')
    expect(r.stdout).toContain('feat-a')
    expect(r.stdout).not.toContain('feat-b')
  })

  test('append without --motive exits 2', () => {
    const env = journalEnv(tmp, 'sessE')
    const r = runJournal(['append', '--type', 'MILESTONE', '--msg', 'no scope'], env)
    expect(r.status).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// AC 10 — digest prints recovery command
// ---------------------------------------------------------------------------

describe('AC 10 — digest prints recovery command', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('digest-prints-recovery-command-after-summary', () => {
    const journalDir = path.join(tmp, '.groundwork', 'journal')
    mkdirSync(journalDir, { recursive: true })
    const fp = path.join(journalDir, `${today()}-sd10.jsonl`)
    // Write 65 events to trigger digest
    for (let i = 0; i < 65; i++) {
      const ts = new Date(Date.now() - (70 - i) * 1000).toISOString()
      writeFileSync(fp, JSON.stringify({
        ts, session: 'sd10', motive: 'R-RC', type: 'MILESTONE', msg: `event ${i}`,
      }) + '\n', { flag: 'a' })
    }

    const env = { CLAUDE_PROJECT_DIR: tmp, JOURNAL_SESSION_ID: 'sd10' }
    const r = runJournal(['digest', '--motive', 'R-RC', '--rebuild'], env)
    expect(r.status).toBe(0)

    // Must contain a command the user can run to retrieve ground truth
    expect(r.stdout).toContain('journal show --motive R-RC')
    // Must print the watermark
    expect(r.stdout).toMatch(/Watermark: \d{4}-\d{2}-\d{2}/)
  })
})

// ---------------------------------------------------------------------------
// AC 12 (TBD-12) — DECISION schema validation
// ---------------------------------------------------------------------------

describe('AC 12 — DECISION schema validation', () => {
  let tmp: string
  let env: Record<string, string>

  beforeEach(() => {
    tmp = mkTmp()
    env = journalEnv(tmp, 'sess-d12')
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  const validData = JSON.stringify({
    id: 'D-1',
    decision: 'use ESM modules',
    rationale: 'native Node support',
    alternatives: ['CJS', 'Bun'],
  })

  test('valid DECISION with all fields exits 0', () => {
    const r = runJournal(
      ['append', '--motive', 'R-001', '--type', 'DECISION', '--msg', 'arch choice',
        '--data', validData],
      env,
    )
    expect(r.status).toBe(0)
  })

  test('alternatives defaults to [] when absent', () => {
    const d = JSON.stringify({ id: 'D-2', decision: 'chose X', rationale: 'why' })
    const r = runJournal(
      ['append', '--motive', 'R-001', '--type', 'DECISION', '--msg', 'arch', '--data', d],
      env,
    )
    expect(r.status).toBe(0)
    const journalDir = path.join(tmp, '.groundwork', 'journal')
    const files = readdirSync(journalDir)
    const line = JSON.parse(readFileSync(path.join(journalDir, files[0]), 'utf8').trim())
    expect(line.data.alternatives).toEqual([])
  })

  test('missing decision key exits 2 and names the key', () => {
    const d = JSON.stringify({ id: 'D-3', rationale: 'why' })
    const r = runJournal(
      ['append', '--motive', 'R-001', '--type', 'DECISION', '--msg', 'arch', '--data', d],
      env,
    )
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('decision')
  })

  test('missing rationale key exits 2 and names the key', () => {
    const d = JSON.stringify({ id: 'D-4', decision: 'use X' })
    const r = runJournal(
      ['append', '--motive', 'R-001', '--type', 'DECISION', '--msg', 'arch', '--data', d],
      env,
    )
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('rationale')
  })

  test('missing data.id exits 0 with loud warning (T6: warn, not block)', () => {
    const d = JSON.stringify({ decision: 'use X', rationale: 'why' })
    const r = runJournal(
      ['append', '--motive', 'R-001', '--type', 'DECISION', '--msg', 'arch', '--data', d],
      env,
    )
    // T6: id-less DECISION is stored (exit 0) but warns to stderr
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('data.id')
    expect(r.stderr).toContain('Decision Log')
  })

  test('non-DECISION type is unaffected by schema check', () => {
    const r = runJournal(
      ['append', '--motive', 'R-001', '--type', 'MILESTONE', '--msg', 'done'],
      env,
    )
    expect(r.status).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// AC 13 — motive archive subcommand
// ---------------------------------------------------------------------------

describe('AC 13 — motive archive', () => {
  let tmp: string
  let env: Record<string, string>

  beforeEach(() => {
    tmp = mkTmp()
    env = journalEnv(tmp, 'sess-archive')
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  function createMotive(projectDir: string, slug: string, openItems = ''): void {
    const dir = path.join(projectDir, '.groundwork', 'motives', slug)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'motive.md'), [
      `# motive: ${slug}`,
      '',
      '## Objective',
      'test motive',
      '',
      '## Open items',
      openItems,
    ].join('\n'))
  }

  test('archives a motive with no open items (exit 0, dir moved)', () => {
    createMotive(tmp, 'done-feat')
    const r = runJournal(['motive', 'archive', 'done-feat'], env)
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)
    expect(r.stdout).toContain('archived motive "done-feat"')

    // Source dir gone
    const srcDir = path.join(tmp, '.groundwork', 'motives', 'done-feat')
    expect(existsSync(srcDir)).toBe(false)

    // Archive dir present
    const archDir = path.join(tmp, '.groundwork', 'archive', 'motives', 'done-feat')
    expect(existsSync(archDir)).toBe(true)
    expect(existsSync(path.join(archDir, 'motive.md'))).toBe(true)
  })

  test('appends MILESTONE event to journal shard', () => {
    createMotive(tmp, 'done-feat2')
    runJournal(['motive', 'archive', 'done-feat2'], env)

    const events = readShard(shardPath(tmp, 'sess-archive'))
    const ev = (events as any[]).find(e => e.motive === 'done-feat2' && e.type === 'MILESTONE')
    expect(ev).toBeDefined()
    expect(ev.msg).toContain('archived')
  })

  test('refuses to archive motive with open TBD items unless --force', () => {
    createMotive(tmp, 'open-feat', '- TBD-1: still open')
    const r = runJournal(['motive', 'archive', 'open-feat'], env)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('open')

    // Dir should still be in motives/
    const srcDir = path.join(tmp, '.groundwork', 'motives', 'open-feat')
    expect(existsSync(srcDir)).toBe(true)
  })

  test('--force archives despite open TBD items', () => {
    createMotive(tmp, 'force-feat', '- TBD-1: still open')
    const r = runJournal(['motive', 'archive', 'force-feat', '--force'], env)
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)
    const archDir = path.join(tmp, '.groundwork', 'archive', 'motives', 'force-feat')
    expect(existsSync(archDir)).toBe(true)
  })

  test('exits 1 for unknown slug', () => {
    const r = runJournal(['motive', 'archive', 'no-such-motive'], env)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('not found')
  })

  test('help documents archive subcommand', () => {
    const r = runJournal(['help', 'motive'], env)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('archive')
  })
})
