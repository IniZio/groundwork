/**
 * T6 — Journal DECISION structured-id discipline
 *
 * AC coverage:
 *  T6-AC1 — DECISION with no data.id: exit 0 (stored), loud stderr warning about Decision Log
 *  T6-AC2 — data.retires accepted on append (schema-valid); compile marks target superseded
 *  T6-AC3 — existing supersedes/resolves compile behaviour unchanged
 */

// @verifies ORCHESTRATION-R-004
// @ts-nocheck
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, test, expect, beforeEach, afterEach } from 'vitest'

const JOURNAL_MJS = new URL('../../hooks/journal.mjs', import.meta.url).pathname

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmp(): string {
  return mkdtempSync(path.join(tmpdir(), 'gw-t6-'))
}

function journalEnv(projectDir: string, sessionId: string): Record<string, string> {
  return { CLAUDE_PROJECT_DIR: projectDir, JOURNAL_SESSION_ID: sessionId }
}

function runJournal(args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, [JOURNAL_MJS, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function appendEventRaw(journalDir: string, shard: string, event: Record<string, unknown>): void {
  mkdirSync(journalDir, { recursive: true })
  writeFileSync(path.join(journalDir, shard), JSON.stringify(event) + '\n', { flag: 'a' })
}

function makeProject(): string {
  const dir = mkTmp()
  mkdirSync(path.join(dir, '.groundwork', 'journal'), { recursive: true })
  return dir
}

function readCompiledJson(projectDir: string, motive: string): Record<string, unknown> {
  // motiveSlug: simple motives with no special chars stay as-is
  const slug = motive
  const p = path.join(projectDir, '.groundwork', 'compiled', `${slug}.json`)
  return JSON.parse(readFileSync(p, 'utf8'))
}

// ---------------------------------------------------------------------------
// T6-AC1 — DECISION with no data.id: exit 0, event stored, loud warning to stderr
// ---------------------------------------------------------------------------

describe('T6-AC1 — id-less DECISION: stored but warns', () => {
  let tmp: string
  let env: Record<string, string>

  beforeEach(() => {
    tmp = mkTmp()
    env = journalEnv(tmp, 'sess-t6ac1')
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('exits 0 when data.id is absent', () => {
    const d = JSON.stringify({ decision: 'use Y', rationale: 'faster' })
    const r = runJournal(
      ['append', '--motive', 'feat-x', '--type', 'DECISION', '--msg', 'chose Y', '--data', d],
      env,
    )
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)
  })

  test('event is stored in the shard even without id', () => {
    const d = JSON.stringify({ decision: 'use Y', rationale: 'faster' })
    runJournal(
      ['append', '--motive', 'feat-x', '--type', 'DECISION', '--msg', 'chose Y', '--data', d],
      env,
    )
    const journalDir = path.join(tmp, '.groundwork', 'journal')
    const files = require('node:fs').readdirSync(journalDir)
    expect(files).toHaveLength(1)
    const lines = readFileSync(path.join(journalDir, files[0]), 'utf8')
      .split('\n').filter(Boolean).map(l => JSON.parse(l))
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('DECISION')
    expect(lines[0].data?.decision).toBe('use Y')
  })

  test('stderr warning mentions data.id and Decision Log', () => {
    const d = JSON.stringify({ decision: 'use Y', rationale: 'faster' })
    const r = runJournal(
      ['append', '--motive', 'feat-x', '--type', 'DECISION', '--msg', 'chose Y', '--data', d],
      env,
    )
    expect(r.stderr).toContain('data.id')
    expect(r.stderr).toContain('Decision Log')
  })

  test('warning is printed to stderr not stdout', () => {
    const d = JSON.stringify({ decision: 'use Y', rationale: 'faster' })
    const r = runJournal(
      ['append', '--motive', 'feat-x', '--type', 'DECISION', '--msg', 'chose Y', '--data', d],
      env,
    )
    // stdout should only have the normal append confirmation
    expect(r.stdout).toContain('appended DECISION')
    // stdout must NOT contain the warning text
    expect(r.stdout).not.toContain('Decision Log')
  })

  test('DECISION with valid data.id produces no warning', () => {
    const d = JSON.stringify({ id: 'D-1', decision: 'use Y', rationale: 'faster' })
    const r = runJournal(
      ['append', '--motive', 'feat-x', '--type', 'DECISION', '--msg', 'chose Y', '--data', d],
      env,
    )
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })
})

// ---------------------------------------------------------------------------
// T6-AC2 — data.retires: accepted on append, compile marks target superseded (D-36)
// ---------------------------------------------------------------------------

describe('T6-AC2 — data.retires: append + compile', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = makeProject()
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  const env = (dir: string) => ({ CLAUDE_PROJECT_DIR: dir, JOURNAL_SESSION_ID: 'test' })

  test('DECISION with data.retires is accepted on append (exit 0)', () => {
    const d = JSON.stringify({
      id: 'D-2',
      decision: 'retire D-1',
      rationale: 'D-1 is obsolete',
      retires: 'D-1',
    })
    const r = runJournal(
      ['append', '--motive', 'feat', '--type', 'DECISION', '--msg', 'retire', '--data', d],
      env(projectDir),
    )
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)
  })

  test('data.retires is stored in the event shard', () => {
    const d = JSON.stringify({
      id: 'D-2',
      decision: 'retire D-1',
      rationale: 'D-1 is obsolete',
      retires: 'D-1',
    })
    runJournal(
      ['append', '--motive', 'feat', '--type', 'DECISION', '--msg', 'retire', '--data', d],
      env(projectDir),
    )
    const journalDir = path.join(projectDir, '.groundwork', 'journal')
    const files = require('node:fs').readdirSync(journalDir)
    const lines = readFileSync(path.join(journalDir, files[0]), 'utf8')
      .split('\n').filter(Boolean).map(l => JSON.parse(l))
    expect(lines[0].data.retires).toBe('D-1')
  })

  test('compile: retiring decision references retires field', () => {
    const journalDir = path.join(projectDir, '.groundwork', 'journal')
    const shard = '2026-08-04-test.jsonl'

    // D-1: original decision
    appendEventRaw(journalDir, shard, {
      ts: new Date(Date.now() - 2000).toISOString(),
      session: 'test', motive: 'feat', type: 'DECISION',
      msg: 'original', source: 'test',
      data: { id: 'D-1', decision: 'use X', rationale: 'good at the time' },
    })
    // D-2: retires D-1
    appendEventRaw(journalDir, shard, {
      ts: new Date(Date.now() - 1000).toISOString(),
      session: 'test', motive: 'feat', type: 'DECISION',
      msg: 'retire D-1', source: 'test',
      data: { id: 'D-2', decision: 'retire D-1', rationale: 'obsolete', retires: 'D-1' },
    })

    const r = runJournal(['compile', 'feat', '--stdout', '--json', '--no-ground-truth'], env(projectDir))
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)

    const view = JSON.parse(r.stdout)
    const decisionLog: any[] = view.agent.decision_log
    const d1 = decisionLog.find(d => d.id === 'D-1')
    const d2 = decisionLog.find(d => d.id === 'D-2')

    // D-1 should be marked superseded by D-2
    expect(d1).toBeDefined()
    expect(d1.status).toBe('superseded')
    expect(d1.superseded_by).toBe('D-2')

    // D-2 should carry the retires reference
    expect(d2).toBeDefined()
    expect(d2.retires).toBe('D-1')
  })

  test('compile: retires does not affect an unknown target (no crash)', () => {
    const journalDir = path.join(projectDir, '.groundwork', 'journal')
    const shard = '2026-08-04-test.jsonl'

    appendEventRaw(journalDir, shard, {
      ts: new Date().toISOString(),
      session: 'test', motive: 'feat', type: 'DECISION',
      msg: 'retire unknown', source: 'test',
      data: { id: 'D-99', decision: 'retire ghost', rationale: 'clean up', retires: 'D-ghost' },
    })

    const r = runJournal(['compile', 'feat', '--stdout', '--json', '--no-ground-truth'], env(projectDir))
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)
    const view = JSON.parse(r.stdout)
    const d99 = view.agent.decision_log.find((d: any) => d.id === 'D-99')
    expect(d99).toBeDefined()
    expect(d99.retires).toBe('D-ghost')
  })
})

// ---------------------------------------------------------------------------
// T6-AC3 — existing supersedes/resolves compile behaviour unchanged
// ---------------------------------------------------------------------------

describe('T6-AC3 — supersedes/resolves compile unchanged', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = makeProject()
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  const env = (dir: string) => ({ CLAUDE_PROJECT_DIR: dir, JOURNAL_SESSION_ID: 'test' })

  test('supersedes marks target superseded (unchanged)', () => {
    const journalDir = path.join(projectDir, '.groundwork', 'journal')
    const shard = '2026-08-04-test.jsonl'

    appendEventRaw(journalDir, shard, {
      ts: new Date(Date.now() - 2000).toISOString(),
      session: 'test', motive: 'feat', type: 'DECISION', msg: 'old',
      data: { id: 'D-A', decision: 'use A', rationale: 'then' },
    })
    appendEventRaw(journalDir, shard, {
      ts: new Date(Date.now() - 1000).toISOString(),
      session: 'test', motive: 'feat', type: 'DECISION', msg: 'new',
      data: { id: 'D-B', decision: 'use B', rationale: 'now', supersedes: 'D-A' },
    })

    const r = runJournal(['compile', 'feat', '--stdout', '--json', '--no-ground-truth'], env(projectDir))
    expect(r.status).toBe(0)
    const view = JSON.parse(r.stdout)
    const dA = view.agent.decision_log.find((d: any) => d.id === 'D-A')
    const dB = view.agent.decision_log.find((d: any) => d.id === 'D-B')
    expect(dA.status).toBe('superseded')
    expect(dA.superseded_by).toBe('D-B')
    expect(dB.supersedes).toBe('D-A')
  })

  test('resolves references are carried through unchanged', () => {
    const journalDir = path.join(projectDir, '.groundwork', 'journal')
    const shard = '2026-08-04-test.jsonl'

    appendEventRaw(journalDir, shard, {
      ts: new Date().toISOString(),
      session: 'test', motive: 'feat', type: 'DECISION', msg: 'resolves item',
      data: { id: 'D-C', decision: 'use C', rationale: 'because', resolves: 'TBD-5', status: 'accepted' },
    })

    const r = runJournal(['compile', 'feat', '--stdout', '--json', '--no-ground-truth'], env(projectDir))
    expect(r.status).toBe(0)
    const view = JSON.parse(r.stdout)
    const dC = view.agent.decision_log.find((d: any) => d.id === 'D-C')
    expect(dC.resolves).toBe('TBD-5')
    expect(dC.status).toBe('accepted')
  })
})
