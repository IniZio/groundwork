/**
 * ARTIFACT-R-004 — DECISION id required + motive-scoped collision warning
 *
 * AC coverage:
 *  R004-AC1 — data.id absent → exit 2 naming the key
 *  R004-AC2 — data.decision absent → exit 2 naming the key
 *  R004-AC3 — data.rationale absent → exit 2 naming the key
 *  R004-AC4 — all three present → exit 0
 *  R004-AC5 — payload without alternatives → exit 0, persisted with alternatives:[]
 *  R004-AC6 — id reuse without data.revises → warning + event still written + exit 0
 *  R004-AC7 — id reuse WITH data.revises → no collision warning
 *  R004-AC8 — collision detection does NOT fire across two different motives sharing an id
 */

// @verifies ARTIFACT-R-004
// @ts-nocheck
import {
  mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync,
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
  return mkdtempSync(path.join(tmpdir(), 'gw-r004-'))
}

function makeProject(): string {
  const dir = mkTmp()
  mkdirSync(path.join(dir, '.groundwork', 'journal'), { recursive: true })
  return dir
}

function journalEnv(projectDir: string, sessionId: string): Record<string, string> {
  return {
    CLAUDE_PROJECT_DIR: projectDir,
    JOURNAL_SESSION_ID: sessionId,
    // Ensure no ambient project dir leaks in
    HOME: projectDir,
  }
}

function runJournal(args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, [JOURNAL_MJS, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function readShard(projectDir: string, sessionId: string): unknown[] {
  const journalDir = path.join(projectDir, '.groundwork', 'journal')
  // Shard path is date-prefixed: <date>-<sessionId>.jsonl
  let files: string[]
  try {
    files = readdirSync(journalDir)
  } catch {
    return []
  }
  const match = files.find((f) => f.endsWith(`-${sessionId}.jsonl`))
  if (!match) return []
  try {
    return readFileSync(path.join(journalDir, match), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// R004-AC1 — data.id absent → exit 2
// ---------------------------------------------------------------------------

describe('R004-AC1 — data.id absent: exit 2', () => {
  let tmp: string
  let env: Record<string, string>

  beforeEach(() => {
    tmp = makeProject()
    env = journalEnv(tmp, 'sess-r004-ac1')
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('exits 2 when data.id is absent', () => {
    const d = JSON.stringify({ decision: 'use Y', rationale: 'faster' })
    const r = runJournal(
      ['append', '--motive', 'feat-x', '--type', 'DECISION', '--msg', 'chose Y', '--data', d],
      env,
    )
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/data\.id/)
  })
})

// ---------------------------------------------------------------------------
// R004-AC2 — data.decision absent → exit 2
// ---------------------------------------------------------------------------

describe('R004-AC2 — data.decision absent: exit 2', () => {
  let tmp: string
  let env: Record<string, string>

  beforeEach(() => {
    tmp = makeProject()
    env = journalEnv(tmp, 'sess-r004-ac2')
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('exits 2 when data.decision is absent', () => {
    const d = JSON.stringify({ id: 'D-1', rationale: 'faster' })
    const r = runJournal(
      ['append', '--motive', 'feat-x', '--type', 'DECISION', '--msg', 'chose Y', '--data', d],
      env,
    )
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/data\.decision/)
  })
})

// ---------------------------------------------------------------------------
// R004-AC3 — data.rationale absent → exit 2
// ---------------------------------------------------------------------------

describe('R004-AC3 — data.rationale absent: exit 2', () => {
  let tmp: string
  let env: Record<string, string>

  beforeEach(() => {
    tmp = makeProject()
    env = journalEnv(tmp, 'sess-r004-ac3')
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('exits 2 when data.rationale is absent', () => {
    const d = JSON.stringify({ id: 'D-1', decision: 'use Y' })
    const r = runJournal(
      ['append', '--motive', 'feat-x', '--type', 'DECISION', '--msg', 'chose Y', '--data', d],
      env,
    )
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/data\.rationale/)
  })
})

// ---------------------------------------------------------------------------
// R004-AC4 — all three present → exit 0
// ---------------------------------------------------------------------------

describe('R004-AC4 — all required fields present: exit 0', () => {
  let tmp: string
  let env: Record<string, string>

  beforeEach(() => {
    tmp = makeProject()
    env = journalEnv(tmp, 'sess-r004-ac4')
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('exits 0 when id, decision, rationale are all present', () => {
    const d = JSON.stringify({ id: 'D-1', decision: 'use Y', rationale: 'faster' })
    const r = runJournal(
      ['append', '--motive', 'feat-x', '--type', 'DECISION', '--msg', 'chose Y', '--data', d],
      env,
    )
    expect(r.status).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// R004-AC5 — no alternatives in payload → exit 0, alternatives:[] persisted
// ---------------------------------------------------------------------------

describe('R004-AC5 — alternatives optional, defaults to []', () => {
  let tmp: string
  let env: Record<string, string>

  beforeEach(() => {
    tmp = makeProject()
    env = journalEnv(tmp, 'sess-r004-ac5')
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('exits 0 when alternatives is absent, persisted with alternatives:[]', () => {
    const d = JSON.stringify({ id: 'D-1', decision: 'use Y', rationale: 'faster' })
    const r = runJournal(
      ['append', '--motive', 'feat-x', '--type', 'DECISION', '--msg', 'chose Y', '--data', d],
      env,
    )
    expect(r.status).toBe(0)
    const events = readShard(tmp, 'sess-r004-ac5')
    expect(events).toHaveLength(1)
    const evt = events[0] as any
    expect(evt.data.alternatives).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// R004-AC6 — id reuse without data.revises → warning + event written + exit 0
// ---------------------------------------------------------------------------

describe('R004-AC6 — id reuse without revises: warning + written + exit 0', () => {
  let tmp: string
  let env1: Record<string, string>
  let env2: Record<string, string>

  beforeEach(() => {
    tmp = makeProject()
    env1 = journalEnv(tmp, 'sess-r004-ac6-first')
    env2 = journalEnv(tmp, 'sess-r004-ac6-second')
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('warns on reuse, writes event, exits 0', () => {
    const d1 = JSON.stringify({ id: 'D-42', decision: 'first', rationale: 'because' })
    runJournal(
      ['append', '--motive', 'feat-x', '--type', 'DECISION', '--msg', 'first use', '--data', d1],
      env1,
    )

    const d2 = JSON.stringify({ id: 'D-42', decision: 'second', rationale: 'better' })
    const r2 = runJournal(
      ['append', '--motive', 'feat-x', '--type', 'DECISION', '--msg', 'second use', '--data', d2],
      env2,
    )

    expect(r2.status).toBe(0)
    expect(r2.stderr).toMatch(/D-42/)
    expect(r2.stderr).toMatch(/WARNING/)

    // Both events should be written
    const s1 = readShard(tmp, 'sess-r004-ac6-first')
    const s2 = readShard(tmp, 'sess-r004-ac6-second')
    expect(s1).toHaveLength(1)
    expect(s2).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// R004-AC7 — id reuse WITH data.revises → no collision warning
// ---------------------------------------------------------------------------

describe('R004-AC7 — id reuse with data.revises: no warning', () => {
  let tmp: string
  let env1: Record<string, string>
  let env2: Record<string, string>

  beforeEach(() => {
    tmp = makeProject()
    env1 = journalEnv(tmp, 'sess-r004-ac7-first')
    env2 = journalEnv(tmp, 'sess-r004-ac7-second')
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('no collision warning when data.revises is present', () => {
    const d1 = JSON.stringify({ id: 'D-99', decision: 'first', rationale: 'because' })
    runJournal(
      ['append', '--motive', 'feat-x', '--type', 'DECISION', '--msg', 'first use', '--data', d1],
      env1,
    )

    const d2 = JSON.stringify({ id: 'D-99', decision: 'revised', rationale: 'better now', revises: 'D-99' })
    const r2 = runJournal(
      ['append', '--motive', 'feat-x', '--type', 'DECISION', '--msg', 'revise', '--data', d2],
      env2,
    )

    expect(r2.status).toBe(0)
    expect(r2.stderr).not.toMatch(/WARNING/)
    expect(r2.stderr).not.toMatch(/D-99.*already exists/)
  })
})

// ---------------------------------------------------------------------------
// R004-AC8 — collision detection does NOT fire across two different motives sharing an id
// ---------------------------------------------------------------------------

describe('R004-AC8 — same id in different motives: no cross-motive collision', () => {
  let tmp: string
  let env1: Record<string, string>
  let env2: Record<string, string>

  beforeEach(() => {
    tmp = makeProject()
    env1 = journalEnv(tmp, 'sess-r004-ac8-motA')
    env2 = journalEnv(tmp, 'sess-r004-ac8-motB')
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('no warning when same id used in a different motive', () => {
    const d1 = JSON.stringify({ id: 'D-1', decision: 'motive A choice', rationale: 'for A' })
    runJournal(
      ['append', '--motive', 'motive-a', '--type', 'DECISION', '--msg', 'motive A', '--data', d1],
      env1,
    )

    const d2 = JSON.stringify({ id: 'D-1', decision: 'motive B choice', rationale: 'for B' })
    const r2 = runJournal(
      ['append', '--motive', 'motive-b', '--type', 'DECISION', '--msg', 'motive B', '--data', d2],
      env2,
    )

    expect(r2.status).toBe(0)
    expect(r2.stderr).not.toMatch(/WARNING/)
    expect(r2.stderr).not.toMatch(/already exists/)
  })
})
