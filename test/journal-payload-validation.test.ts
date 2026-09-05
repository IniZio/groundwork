/**
 * test/journal-payload-validation.test.ts
 *
 * Regression tests for two bug fixes in hooks/journal.mjs:
 *
 * ITEM 1 — `ac-retract` missing from HELP object
 *   The dispatch switch handles `ac-retract` but the HELP object does not list
 *   it.  `journal help` must include it; `journal help ac-retract` must succeed.
 *
 * ITEM 2 — Unvalidated payloads in cmdAppend
 *   GRAPH_MUTATE, BASELINE, and AC_COVERAGE events reach appendEvent with no
 *   schema guard.  Invalid payloads are silently accepted; this test suite
 *   proves the guards are absent (RED) so Wave 2 can add them.
 *
 * Wave 1 obligation: CREATE file, confirm RED against unmodified production.
 * Wave 2 obligation: implement fixes, confirm GREEN.
 */

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

const REPO_ROOT = '/home/newman/.local/share/groundwork'
const JOURNAL = path.join(REPO_ROOT, 'hooks/journal.mjs')
const GW_CLI_PATH = path.join(REPO_ROOT, 'src/gw/cli/main.ts')
const LEGACY_JOURNAL_BIN = path.join(REPO_ROOT, 'bin/journal')
const MOTIVE = 'test-motive'

function runJournal(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [JOURNAL, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 20_000,
  })
}

/** Minimal project skeleton that cmdAppend needs to write a shard. */
function makeProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gw-journal-pv-'))
  mkdirSync(path.join(dir, '.groundwork', 'journal'), { recursive: true })
  mkdirSync(path.join(dir, '.groundwork', 'motives', MOTIVE), { recursive: true })
  return dir
}

function projectEnv(projectDir: string): Record<string, string> {
  return {
    CLAUDE_PROJECT_DIR: projectDir,
    JOURNAL_SESSION_ID: 'test-sess-1',
  }
}

// ---------------------------------------------------------------------------
// ITEM 1 — help listing
// ---------------------------------------------------------------------------

describe('ITEM 1 — help listing', () => {
  // BUG: HELP object does not contain an 'ac-retract' key.
  // All three tests below will be RED until the HELP entry is added.

  test('journal help lists ac-retract', () => {
    const r = runJournal(['help'])
    expect(r.status).toBe(0)
    // RED: ac-retract is absent from the HELP object, so it is not printed
    expect(r.stdout).toContain('ac-retract')
  })

  test('journal help ac-retract succeeds', () => {
    const r = runJournal(['help', 'ac-retract'])
    // RED: cmdHelp looks up 'ac-retract' in HELP; not found → falls through to
    // the generic listing, which does not include '--motive', '--ac', '--slice'
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('--motive')
    expect(r.stdout).toContain('--ac')
    expect(r.stdout).toContain('--slice')
  })

  test('all dispatch commands appear in help', () => {
    const r = runJournal(['help'])
    expect(r.status).toBe(0)
    // RED: ac-retract absent; graph and migrate-tickets are present (GREEN portions)
    expect(r.stdout).toContain('ac-retract')
    expect(r.stdout).toContain('graph')
    expect(r.stdout).toContain('migrate-tickets')
  })
})

// ---------------------------------------------------------------------------
// ITEM 2 — GRAPH_MUTATE validation
// ---------------------------------------------------------------------------

describe('ITEM 2 — GRAPH_MUTATE validation', () => {
  let projectDir: string

  beforeAll(() => { projectDir = makeProject() })
  afterAll(() => { rmSync(projectDir, { recursive: true, force: true }) })

  test('missing data.op rejected', () => {
    const r = runJournal(
      ['append', '--motive', MOTIVE, '--type', 'GRAPH_MUTATE', '--msg', 'test', '--data', '{}'],
      projectEnv(projectDir),
    )
    // RED: no GRAPH_MUTATE validator → exits 0 and writes the event
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('data.op')
  })

  test('invalid data.op rejected', () => {
    const r = runJournal(
      ['append', '--motive', MOTIVE, '--type', 'GRAPH_MUTATE', '--msg', 'test', '--data', '{"op":"bad-op"}'],
      projectEnv(projectDir),
    )
    // RED: no GRAPH_MUTATE validator → exits 0 and writes the event
    expect(r.status).toBe(2)
  })

  test('valid data.op accepted — node.assert (positive control)', () => {
    const r = runJournal(
      ['append', '--motive', MOTIVE, '--type', 'GRAPH_MUTATE', '--msg', 'test', '--data', '{"op":"node.assert","id":"N-1"}'],
      projectEnv(projectDir),
    )
    // GREEN already: no validator means valid payloads pass through
    expect(r.status).toBe(0)
  })

  test('all five ops accepted', () => {
    const ops = ['node.assert', 'node.retire', 'edge.assert', 'edge.retire', 'attr.set']
    for (const op of ops) {
      const r = runJournal(
        ['append', '--motive', MOTIVE, '--type', 'GRAPH_MUTATE', '--msg', `op-${op}`, '--data', JSON.stringify({ op })],
        projectEnv(projectDir),
      )
      // GREEN already: no validator means all ops pass through
      expect(r.status, `op=${op} should exit 0`).toBe(0)
    }
  })
})

// ---------------------------------------------------------------------------
// ITEM 2 — BASELINE validation
// ---------------------------------------------------------------------------

describe('ITEM 2 — BASELINE validation', () => {
  let projectDir: string

  beforeAll(() => { projectDir = makeProject() })
  afterAll(() => { rmSync(projectDir, { recursive: true, force: true }) })

  test('nameless payload exits 0 (BASELINE validator removed in Wave 1)', () => {
    const r = runJournal(
      ['append', '--motive', MOTIVE, '--type', 'BASELINE', '--msg', 'test', '--data', '{"shard":"s0"}'],
      projectEnv(projectDir),
    )
    // BASELINE validator was removed — nameless payloads are free-form and accepted
    expect(r.status).toBe(0)
  })

  test('valid data.name accepted (positive control)', () => {
    const r = runJournal(
      ['append', '--motive', MOTIVE, '--type', 'BASELINE', '--msg', 'test', '--data', '{"name":"v1","shard":"s1"}'],
      projectEnv(projectDir),
    )
    // GREEN already: no validator means valid payloads pass through
    expect(r.status).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// ITEM 2 — AC_COVERAGE validation
// ---------------------------------------------------------------------------

describe('ITEM 2 — AC_COVERAGE validation', () => {
  let projectDir: string

  beforeAll(() => { projectDir = makeProject() })
  afterAll(() => { rmSync(projectDir, { recursive: true, force: true }) })

  test('single-AC form accepted — { ac, slice } (positive control)', () => {
    const r = runJournal(
      ['append', '--motive', MOTIVE, '--type', 'AC_COVERAGE', '--msg', 'test', '--data', '{"ac":"AC-1","slice":"S-1"}'],
      projectEnv(projectDir),
    )
    // GREEN already: no validator, write proceeds
    expect(r.status).toBe(0)
  })

  test('array-covers form accepted — { slice, covers } (positive control)', () => {
    const r = runJournal(
      ['append', '--motive', MOTIVE, '--type', 'AC_COVERAGE', '--msg', 'test', '--data', '{"slice":"S-1","covers":["AC-1"]}'],
      projectEnv(projectDir),
    )
    // GREEN already: no validator, write proceeds
    expect(r.status).toBe(0)
  })

  test('declaration form accepted — { ac, covering } (positive control)', () => {
    const r = runJournal(
      ['append', '--motive', MOTIVE, '--type', 'AC_COVERAGE', '--msg', 'test', '--data', '{"ac":"AC-1","covering":[]}'],
      projectEnv(projectDir),
    )
    // GREEN already: no validator, write proceeds
    expect(r.status).toBe(0)
  })

  test('empty payload rejected', () => {
    const r = runJournal(
      ['append', '--motive', MOTIVE, '--type', 'AC_COVERAGE', '--msg', 'test', '--data', '{}'],
      projectEnv(projectDir),
    )
    // RED: no AC_COVERAGE validator → exits 0 and writes the event
    expect(r.status).toBe(2)
  })

  test('covers without slice rejected', () => {
    const r = runJournal(
      ['append', '--motive', MOTIVE, '--type', 'AC_COVERAGE', '--msg', 'test', '--data', '{"covers":["AC-1"]}'],
      projectEnv(projectDir),
    )
    // RED: no AC_COVERAGE validator → exits 0 and writes the event
    expect(r.status).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// ITEM 2 — existing validators regression (must stay GREEN)
// ---------------------------------------------------------------------------

describe('ITEM 2 — existing validators regression', () => {
  let projectDir: string

  beforeAll(() => { projectDir = makeProject() })
  afterAll(() => { rmSync(projectDir, { recursive: true, force: true }) })

  test('DECISION valid payload accepted (positive control)', () => {
    const data = JSON.stringify({ id: 'D-1', decision: 'use X', rationale: 'because Y' })
    const r = runJournal(
      ['append', '--motive', MOTIVE, '--type', 'DECISION', '--msg', 'test', '--data', data],
      projectEnv(projectDir),
    )
    expect(r.status).toBe(0)
  })

  test('AC_RETRACTION valid payload accepted (positive control)', () => {
    const data = JSON.stringify({ ac: 'AC-1', slice: 'S-1', reason: 'was wrong' })
    const r = runJournal(
      ['append', '--motive', MOTIVE, '--type', 'AC_RETRACTION', '--msg', 'test', '--data', data],
      projectEnv(projectDir),
    )
    expect(r.status).toBe(0)
  })

  test('DECISION missing id still rejected', () => {
    const data = JSON.stringify({ decision: 'use X', rationale: 'because Y' })
    const r = runJournal(
      ['append', '--motive', MOTIVE, '--type', 'DECISION', '--msg', 'test', '--data', data],
      projectEnv(projectDir),
    )
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('data.id')
  })

  test('AC_RETRACTION missing slice still rejected', () => {
    const data = JSON.stringify({ ac: 'AC-1', reason: 'was wrong' })
    const r = runJournal(
      ['append', '--motive', MOTIVE, '--type', 'AC_RETRACTION', '--msg', 'test', '--data', data],
      projectEnv(projectDir),
    )
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('data.slice')
  })
})

// ---------------------------------------------------------------------------
// BASELINE regression — nameless eval-skill payload exits 0 on both surfaces
// Regression guard: if the BASELINE validator is re-added (requiring data.name),
// these tests go RED, alerting that the eval-skill documented payload broke.
// ---------------------------------------------------------------------------

const BASELINE_EVAL_PAYLOAD = JSON.stringify({
  suite: 'x', cases: 6, avg_score: 3.1, run_date: '2026-09-05',
})

describe('BASELINE regression — nameless eval-skill payload exits 0 on both surfaces', () => {
  let projectDir: string

  beforeAll(() => { projectDir = makeProject() })
  afterAll(() => { rmSync(projectDir, { recursive: true, force: true }) })

  test('legacy surface: nameless BASELINE exits 0', () => {
    const r = runJournal(
      ['append', '--motive', MOTIVE, '--type', 'BASELINE', '--msg', 'baseline pin', '--data', BASELINE_EVAL_PAYLOAD],
      { CLAUDE_PROJECT_DIR: projectDir, JOURNAL_SESSION_ID: 'rg-verify', CLAUDE_CODE_SESSION_ID: 'rg-verify' },
    )
    expect(r.status).toBe(0)
  })

  test('gw surface: nameless BASELINE exits 0', () => {
    const r = spawnSync('bun', [
      GW_CLI_PATH, '--json', 'journal', 'append',
      '--motive', MOTIVE, '--type', 'BASELINE', '--msg', 'baseline pin', '--data', BASELINE_EVAL_PAYLOAD,
    ], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: 'rg-verify' },
      timeout: 30_000,
    })
    expect(r.status).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Cross-surface exit-code parity — malformed payloads
// Both legacy (hooks/journal.mjs via bin/journal) and gw (src/gw/cli/main.ts)
// must agree on exit code for each type: non-zero for malformed, 0 for valid.
// ---------------------------------------------------------------------------

describe('cross-surface exit-code parity — malformed payloads', () => {
  let projectDir: string

  beforeAll(() => { projectDir = makeProject() })
  afterAll(() => { rmSync(projectDir, { recursive: true, force: true }) })

  // Types supported by BOTH surfaces (gw schema/journal.ts VALID_TYPES includes these)
  const BOTH_SURFACE_CASES = [
    {
      type: 'DECISION',
      malformed: {},
      wellFormed: { id: 'D-test', decision: 'use X', rationale: 'because Y' },
    },
    {
      type: 'AC_COVERAGE',
      malformed: {},
      wellFormed: { ac: 'AC1', slice: 'S1' },
    },
  ] as const

  // Types supported by legacy surface only — gw rejects them (type not in gw VALID_TYPES)
  // Parity: both exit non-zero for malformed; only legacy exits 0 for well-formed.
  const LEGACY_ONLY_CASES = [
    {
      type: 'AC_RETRACTION',
      malformed: { ac: 'AC1' },           // missing slice — validator rejects
      wellFormed: { ac: 'AC1', slice: 'S1', reason: 'obsolete' },
    },
    {
      type: 'GRAPH_MUTATE',
      malformed: { op: 'invalid-op' },    // invalid op — validator rejects
      wellFormed: { op: 'node.assert', node: 'foo', label: 'Foo' },
    },
  ] as const

  for (const { type, malformed, wellFormed } of BOTH_SURFACE_CASES) {
    describe(type, () => {
      test('malformed payload — both surfaces exit non-zero and agree', () => {
        const sessionId = `test-parity-${type}`
        const sharedEnv = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: sessionId }
        const legacyResult = spawnSync(
          LEGACY_JOURNAL_BIN,
          ['append', '--motive', MOTIVE, '--type', type, '--msg', 'test', '--data', JSON.stringify(malformed)],
          { cwd: REPO_ROOT, encoding: 'utf8', env: { ...sharedEnv, JOURNAL_SESSION_ID: sessionId }, timeout: 20_000 },
        )
        const gwResult = spawnSync(
          'bun',
          [GW_CLI_PATH, '--json', 'journal', 'append', '--motive', MOTIVE, '--type', type, '--msg', 'test', '--data', JSON.stringify(malformed)],
          { cwd: REPO_ROOT, encoding: 'utf8', env: sharedEnv, timeout: 30_000 },
        )
        expect(legacyResult.status, `legacy ${type} malformed should be non-zero`).not.toBe(0)
        expect(gwResult.status, `gw ${type} malformed should be non-zero`).not.toBe(0)
        expect(legacyResult.status, `${type} exit codes must agree`).toBe(gwResult.status)
      })

      test('well-formed payload — both surfaces exit 0', () => {
        const sessionId = `test-parity-${type}-ok`
        const sharedEnv = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: sessionId }
        const legacyResult = spawnSync(
          LEGACY_JOURNAL_BIN,
          ['append', '--motive', MOTIVE, '--type', type, '--msg', 'test', '--data', JSON.stringify(wellFormed)],
          { cwd: REPO_ROOT, encoding: 'utf8', env: { ...sharedEnv, JOURNAL_SESSION_ID: sessionId }, timeout: 20_000 },
        )
        const gwResult = spawnSync(
          'bun',
          [GW_CLI_PATH, '--json', 'journal', 'append', '--motive', MOTIVE, '--type', type, '--msg', 'test', '--data', JSON.stringify(wellFormed)],
          { cwd: REPO_ROOT, encoding: 'utf8', env: sharedEnv, timeout: 30_000 },
        )
        expect(legacyResult.status, `legacy ${type} well-formed should exit 0`).toBe(0)
        expect(gwResult.status, `gw ${type} well-formed should exit 0`).toBe(0)
      })
    })
  }

  for (const { type, malformed, wellFormed } of LEGACY_ONLY_CASES) {
    describe(`${type} (legacy-only — gw VALID_TYPES excludes this event type)`, () => {
      test('malformed payload — both surfaces exit non-zero and agree', () => {
        // gw exits non-zero for unknown type; legacy exits non-zero for validator failure.
        // Both exit non-zero → codes agree (both 2).
        const sessionId = `test-parity-${type}`
        const sharedEnv = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: sessionId }
        const legacyResult = spawnSync(
          LEGACY_JOURNAL_BIN,
          ['append', '--motive', MOTIVE, '--type', type, '--msg', 'test', '--data', JSON.stringify(malformed)],
          { cwd: REPO_ROOT, encoding: 'utf8', env: { ...sharedEnv, JOURNAL_SESSION_ID: sessionId }, timeout: 20_000 },
        )
        const gwResult = spawnSync(
          'bun',
          [GW_CLI_PATH, '--json', 'journal', 'append', '--motive', MOTIVE, '--type', type, '--msg', 'test', '--data', JSON.stringify(malformed)],
          { cwd: REPO_ROOT, encoding: 'utf8', env: sharedEnv, timeout: 30_000 },
        )
        expect(legacyResult.status, `legacy ${type} malformed should be non-zero`).not.toBe(0)
        expect(gwResult.status, `gw ${type} malformed should be non-zero`).not.toBe(0)
        expect(legacyResult.status, `${type} exit codes must agree`).toBe(gwResult.status)
      })

      test('well-formed payload — legacy exits 0 (positive control)', () => {
        // gw does not support this type; only legacy surface is tested here.
        const sessionId = `test-parity-${type}-ok`
        const legacyResult = spawnSync(
          LEGACY_JOURNAL_BIN,
          ['append', '--motive', MOTIVE, '--type', type, '--msg', 'test', '--data', JSON.stringify(wellFormed)],
          { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, JOURNAL_SESSION_ID: sessionId, CLAUDE_CODE_SESSION_ID: sessionId }, timeout: 20_000 },
        )
        expect(legacyResult.status, `legacy ${type} well-formed should exit 0`).toBe(0)
      })
    })
  }
})
