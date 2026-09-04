// @ts-nocheck
/**
 * journal-revises-collision.test.ts
 *
 * Tests for the `data.revises` collision-guard contract in hooks/journal.mjs
 * and parity with hooks/lib/motive-compile.mjs (ARTIFACT-R-011, D-62).
 *
 * The spec: `data.revises` MUST equal the entry's own `data.id` to suppress
 * the append-time collision warning. Any other value (true, a different id,
 * absent) MUST still warn. The same payload must produce consistent verdicts
 * at append time AND at compile time (parity).
 *
 * @verifies revises === id suppresses append warning
 * @verifies revises: true still warns (regression guard)
 * @verifies revises naming a different id still warns
 * @verifies no revises still warns
 * @verifies parity: append-suppress ↔ compile unmarked_collision absent
 * @verifies parity: append-warn ↔ compile unmarked_collision present
 * @verifies stop-gate unmarked-collision line carries [motive] attribution
 * @verifies stop-gate advisory is non-blocking (exit 0, continue: true)
 */

import { execFileSync, spawnSync } from 'node:child_process'
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '../..')
const JOURNAL_CLI = path.join(ROOT, 'hooks', 'journal.mjs')
const STOP_GATE = path.join(ROOT, 'bin', 'gw-hook')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmp(): string {
  return mkdtempSync(path.join(tmpdir(), 'gw-revises-'))
}

function journalEnv(projectDir: string, sessionId = 'sess-1'): Record<string, string> {
  // Explicitly DO NOT inherit CLAUDE_PROJECT_DIR from the outer process
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== 'CLAUDE_PROJECT_DIR' && k !== 'JOURNAL_SESSION_ID') env[k] = v
  }
  env.CLAUDE_PROJECT_DIR = projectDir
  env.JOURNAL_SESSION_ID = sessionId
  return env
}

function runJournal(args: string[], projectDir: string, sessionId = 'sess-1') {
  const result = spawnSync('node', [JOURNAL_CLI, ...args], {
    encoding: 'utf8',
    env: journalEnv(projectDir, sessionId),
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

/** Append a DECISION event via the CLI and return stdout+stderr. */
function appendDecision(
  projectDir: string,
  opts: {
    id?: string
    revises?: unknown
    motive?: string
    sessionId?: string
  } = {},
) {
  const id = opts.id ?? 'D-99'
  const motive = opts.motive ?? 'test-motive'
  const payload: Record<string, unknown> = {
    id,
    decision: 'use X',
    rationale: 'because X is best',
    alternatives: [],
  }
  if (opts.revises !== undefined) payload.revises = opts.revises

  return runJournal(
    [
      'append',
      '--motive', motive,
      '--type', 'DECISION',
      '--msg', 'arch choice',
      '--data', JSON.stringify(payload),
    ],
    projectDir,
    opts.sessionId ?? 'sess-1',
  )
}

/** Write a JSONL shard directly (for parity and stop-gate tests). */
function writeShard(projectDir: string, sessionId: string, events: object[]): void {
  const journalDir = path.join(projectDir, '.groundwork', 'journal')
  mkdirSync(journalDir, { recursive: true })
  const today = new Date().toISOString().slice(0, 10)
  const file = path.join(journalDir, `${today}-${sessionId}.jsonl`)
  writeFileSync(file, events.map(e => JSON.stringify(e)).join('\n') + '\n')
}

/** Create a motive directory so stop-gate per-motive scope works. */
function createMotiveDir(projectDir: string, slug: string): void {
  mkdirSync(path.join(projectDir, '.groundwork', 'motives', slug), { recursive: true })
}

/** Write a completed ledger with advisor APPROVE so the allow path fires (advisories are emitted). */
function writeLedger(projectDir: string, sessionId = 'sess-sg'): void {
  writeFileSync(
    path.join(projectDir, '.groundwork', 'run.json'),
    JSON.stringify({
      active: true,
      session_id: sessionId,
      reinforcements: 0,
      slices: [{ id: 'S1', kind: 'impl', status: 'complete' }],
      gate: { advisor: 'APPROVE' },
    }, null, 2),
  )
}

function runStopGate(projectDir: string, sessionId = 'sess-sg'): { continue?: boolean; decision?: string; reason?: string } {
  const input = JSON.stringify({ cwd: projectDir, session_id: sessionId })
  const out = execFileSync(STOP_GATE, ['hook', 'stop-gate'], {
    input,
    encoding: 'utf8',
    env: journalEnv(projectDir, sessionId),
  })
  return JSON.parse(out)
}

// ---------------------------------------------------------------------------
// Setup — shared temp dir
// ---------------------------------------------------------------------------

let tmp: string

beforeEach(() => {
  tmp = mkTmp()
  mkdirSync(path.join(tmp, '.groundwork'), { recursive: true })
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Append-time collision-guard tests
// ---------------------------------------------------------------------------

describe('append: collision guard', () => {
  it('no collision on first append — no warning', () => {
    const r = appendDecision(tmp, { id: 'D-1' })
    expect(r.status).toBe(0)
    expect(r.stderr).not.toContain('WARNING')
  })

  it('revises === id suppresses the warning (valid refinement)', () => {
    appendDecision(tmp, { id: 'D-1', sessionId: 'sess-1' })
    const r = appendDecision(tmp, { id: 'D-1', revises: 'D-1', sessionId: 'sess-2' })
    expect(r.status).toBe(0)
    expect(r.stderr).not.toContain('WARNING')
  })

  it('revises: true still warns — truthy is NOT a valid refinement marker', () => {
    appendDecision(tmp, { id: 'D-1', sessionId: 'sess-1' })
    const r = appendDecision(tmp, { id: 'D-1', revises: true, sessionId: 'sess-2' })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('WARNING')
  })

  it('revises naming a DIFFERENT id still warns', () => {
    appendDecision(tmp, { id: 'D-1', sessionId: 'sess-1' })
    const r = appendDecision(tmp, { id: 'D-1', revises: 'D-99', sessionId: 'sess-2' })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('WARNING')
  })

  it('no revises field warns on same-id reuse', () => {
    appendDecision(tmp, { id: 'D-1', sessionId: 'sess-1' })
    const r = appendDecision(tmp, { id: 'D-1', sessionId: 'sess-2' })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('WARNING')
  })

  it('warning message instructs author to set revises to the own id', () => {
    appendDecision(tmp, { id: 'D-42', sessionId: 'sess-1' })
    const r = appendDecision(tmp, { id: 'D-42', sessionId: 'sess-2' })
    expect(r.stderr).toContain('"D-42"')
    // old text "set to true" must not appear
    expect(r.stderr).not.toContain('set to true')
  })
})

// ---------------------------------------------------------------------------
// Parity tests: append ↔ compile
// ---------------------------------------------------------------------------

describe('parity: append-time and compile-time agree', () => {
  /**
   * Build a two-event in-memory fixture and compile it to check
   * unmarked_collision, mirroring what the append-time guard tests.
   */
  async function compileRevises(revisesValue: unknown): Promise<{ unmarked: boolean }> {
    const { compile } = await import('../../hooks/lib/motive-compile.mjs')
    function makeEvent(extra: Record<string, unknown> = {}) {
      return {
        type: 'DECISION',
        motive: 'test',
        ts: '2026-08-04T10:00:00.000Z',
        data: {
          id: 'D-1',
          decision: 'use X',
          rationale: 'r',
          alternatives: [],
          ...extra,
        },
        _order: { shard: 'test.jsonl', line: 0 },
      }
    }
    const first = makeEvent()
    const second = revisesValue === undefined
      ? makeEvent()
      : makeEvent({ revises: revisesValue })

    const view = compile([first, second])
    const entry = view?.agent?.decision_log?.find((d: any) => d.id === 'D-1')
    return { unmarked: !!entry?.unmarked_collision }
  }

  it('revises === id: append suppresses warning AND compile has no unmarked_collision', async () => {
    // append side
    appendDecision(tmp, { id: 'D-1', sessionId: 'sess-1' })
    const r = appendDecision(tmp, { id: 'D-1', revises: 'D-1', sessionId: 'sess-2' })
    expect(r.stderr).not.toContain('WARNING')

    // compile side
    const { unmarked } = await compileRevises('D-1')
    expect(unmarked).toBe(false)
  })

  it('revises: true: append warns AND compile has unmarked_collision', async () => {
    // append side
    appendDecision(tmp, { id: 'D-1', sessionId: 'sess-1' })
    const r = appendDecision(tmp, { id: 'D-1', revises: true, sessionId: 'sess-2' })
    expect(r.stderr).toContain('WARNING')

    // compile side
    const { unmarked } = await compileRevises(true)
    expect(unmarked).toBe(true)
  })

  it('no revises: append warns AND compile has unmarked_collision', async () => {
    // append side
    appendDecision(tmp, { id: 'D-1', sessionId: 'sess-1' })
    const r = appendDecision(tmp, { id: 'D-1', sessionId: 'sess-2' })
    expect(r.stderr).toContain('WARNING')

    // compile side
    const { unmarked } = await compileRevises(undefined)
    expect(unmarked).toBe(true)
  })

  it('revises = different id: append warns AND compile has unmarked_collision', async () => {
    // append side
    appendDecision(tmp, { id: 'D-1', sessionId: 'sess-1' })
    const r = appendDecision(tmp, { id: 'D-1', revises: 'D-99', sessionId: 'sess-2' })
    expect(r.stderr).toContain('WARNING')

    // compile side
    const { unmarked } = await compileRevises('D-99')
    expect(unmarked).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Stop-gate advisory: motive attribution
// ---------------------------------------------------------------------------

describe('stop-gate: unmarked-collision line carries [motive] attribution', () => {
  it('advisory line includes [motive-slug] and names the id', () => {
    const slug = 'my-feature'
    createMotiveDir(tmp, slug)
    writeLedger(tmp)

    // Write two same-id DECISION events with no revises — yields unmarked_collision
    writeShard(tmp, 'sess-sg', [
      {
        ts: '2026-08-04T10:00:00.000Z',
        session: 'sess-sg',
        motive: slug,
        type: 'DECISION',
        msg: 'first',
        data: { id: 'D-5', decision: 'use X', rationale: 'r', alternatives: [] },
      },
      {
        ts: '2026-08-04T11:00:00.000Z',
        session: 'sess-sg',
        motive: slug,
        type: 'DECISION',
        msg: 'second — same id, no revises',
        data: { id: 'D-5', decision: 'use Y', rationale: 'r2', alternatives: [] },
      },
    ])

    const result = runStopGate(tmp)

    // Must be non-blocking
    expect(result.continue).toBe(true)

    // The advisory text must carry [motive-slug]
    const reason = result.reason ?? ''
    expect(reason).toContain('[my-feature]')
    expect(reason).toContain('D-5')
    expect(reason).toContain('possible unmarked id reuse')
  })

  it('advisory is non-blocking (exit 0) even when unmarked collisions exist', () => {
    const slug = 'another-motive'
    createMotiveDir(tmp, slug)
    writeLedger(tmp)
    writeShard(tmp, 'sess-sg', [
      {
        ts: '2026-08-04T10:00:00.000Z',
        session: 'sess-sg',
        motive: slug,
        type: 'DECISION',
        msg: 'first',
        data: { id: 'D-7', decision: 'use X', rationale: 'r', alternatives: ['a'] },
      },
      {
        ts: '2026-08-04T11:00:00.000Z',
        session: 'sess-sg',
        motive: slug,
        type: 'DECISION',
        msg: 'second',
        data: { id: 'D-7', decision: 'use Y', rationale: 'r2', alternatives: ['a'] },
      },
    ])

    // Must NOT throw (execFileSync would throw on non-zero exit)
    const result = runStopGate(tmp)
    expect(result.continue).toBe(true)
  })
})
