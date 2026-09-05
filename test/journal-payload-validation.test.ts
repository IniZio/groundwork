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

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
    {
      // AC_RETRACTION moved from LEGACY_ONLY — gw now supports this type
      type: 'AC_RETRACTION',
      malformed: { ac: 'AC1' },           // missing slice — validator rejects
      wellFormed: { ac: 'AC1', slice: 'S1', reason: 'obsolete' },
    },
    {
      // GRAPH_MUTATE moved from LEGACY_ONLY — gw now supports this type
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
})

// ---------------------------------------------------------------------------
// e2e — gw-written AC_RETRACTION is folded by motive-compile
//
// bin/journal compile reads JSONL shards; gw writes per-motive md files.
// The two surfaces use different storage paths so the legacy compile cannot
// directly read gw-written events.  This test proves fold correctness by:
//   1. Writing events via gw (proves exit 0 — the type is accepted)
//   2. Parsing the gw-written md files back into JournalEvent objects
//   3. Calling compile() from motive-compile.mjs directly with those objects
//   4. Asserting that the AC_RETRACTION removes S-e2e from ac_coverage
// This matches the actual data path: gw writes md files; the obsidian-native
// compile surface (gw journal compile, once it calls motive-compile.mjs) will
// read the same md files and fold them the same way.
// ---------------------------------------------------------------------------

describe('e2e — gw-written AC_RETRACTION is folded by motive-compile', () => {
  let projectDir: string
  let scriptDir: string
  const E2E_MOTIVE = 'e2e-retract-test'

  beforeAll(() => {
    projectDir = makeProject()
    scriptDir = mkdtempSync(path.join(tmpdir(), 'gw-e2e-fold-'))
  })
  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(scriptDir, { recursive: true, force: true })
  })

  // compile() returns { compiler_version, agent, human, provenance, divergence }.
  // ac_coverage lives at view.agent.ac_coverage and has shape
  //   { met: Entry[], unmet: Entry[] }
  // where Entry = { id: string, covering: string[], missing: string[], met: bool, ... }.
  // The covering array holds bare slice ids (session prefix stripped via toBare).

  test('positive control — AC_COVERAGE alone folds S-e2e into AC-e2e covering', () => {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: 'e2e-retract' }

    // Write coverage event only — no retraction yet.
    const coverageResult = spawnSync(
      'bun',
      [GW_CLI_PATH, '--json', 'journal', 'append', '--motive', E2E_MOTIVE,
        '--type', 'AC_COVERAGE', '--msg', 'initial coverage', '--data', '{"ac":"AC-e2e","slice":"S-e2e"}'],
      { cwd: REPO_ROOT, encoding: 'utf8', env, timeout: 30_000 },
    )
    expect(coverageResult.status, 'gw AC_COVERAGE should exit 0').toBe(0)

    // Fold through motive-compile.mjs and assert S-e2e IS present.
    // This proves the assertion can fail (guard is not vacuous).
    const jDir = path.join(projectDir, '.groundwork', 'motives', E2E_MOTIVE, 'journal')
    const scriptPath = path.join(scriptDir, 'verify-coverage.mjs')
    writeFileSync(scriptPath, [
      `import { readdirSync, readFileSync } from 'node:fs'`,
      `import path from 'node:path'`,
      `import matter from 'gray-matter'`,
      `import { compile } from '${REPO_ROOT}/hooks/lib/motive-compile.mjs'`,
      `const jDir = ${JSON.stringify(jDir)}`,
      `const files = readdirSync(jDir).filter(f => f.endsWith('.md'))`,
      `const events = files.map(f => {`,
      `  const { data, content } = matter(readFileSync(path.join(jDir, f), 'utf8'))`,
      `  return { type: data.type, ts: data.ts, session: data.session || '', motive: ${JSON.stringify(E2E_MOTIVE)}, data: data.data ?? {}, msg: content.trim() }`,
      `})`,
      `const view = compile(events, {})`,
      `const acCov = view.agent.ac_coverage`,
      `const allEntries = [...(acCov?.met ?? []), ...(acCov?.unmet ?? [])]`,
      `const entry = allEntries.find(e => e.id === 'AC-e2e')`,
      `process.stdout.write('ac_coverage:' + JSON.stringify(acCov) + '\\n')`,
      `if (!entry) { process.stderr.write('FAIL: AC-e2e not found in ac_coverage\\n'); process.exit(1) }`,
      `if (!entry.covering.includes('S-e2e')) { process.stderr.write('FAIL: S-e2e not in covering; covering=' + JSON.stringify(entry.covering) + '\\n'); process.exit(1) }`,
    ].join('\n'))

    const verifyResult = spawnSync('bun', [scriptPath], {
      cwd: REPO_ROOT, encoding: 'utf8', env: process.env, timeout: 30_000,
    })
    expect(
      verifyResult.status,
      `positive control: S-e2e must appear in AC-e2e covering when no retraction present; stdout=${verifyResult.stdout} stderr=${verifyResult.stderr}`,
    ).toBe(0)
  })

  test('AC_RETRACTION via gw — motive-compile fold removes the retracted pair', () => {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: 'e2e-retract' }

    // Write AC_COVERAGE first so this test is self-sufficient regardless of
    // execution order. The positive-control test may or may not have run before
    // this one (shuffle, .only, isolation run); we must not rely on its side-effects.
    const coverageResult = spawnSync(
      'bun',
      [GW_CLI_PATH, '--json', 'journal', 'append', '--motive', E2E_MOTIVE,
        '--type', 'AC_COVERAGE', '--msg', 'initial coverage', '--data', '{"ac":"AC-e2e","slice":"S-e2e"}'],
      { cwd: REPO_ROOT, encoding: 'utf8', env, timeout: 30_000 },
    )
    expect(coverageResult.status, 'gw AC_COVERAGE (retraction-test setup) should exit 0').toBe(0)

    // Retract via gw.
    const retractionResult = spawnSync(
      'bun',
      [GW_CLI_PATH, '--json', 'journal', 'append', '--motive', E2E_MOTIVE,
        '--type', 'AC_RETRACTION', '--msg', 'retract coverage', '--data', '{"ac":"AC-e2e","slice":"S-e2e","reason":"mistaken"}'],
      { cwd: REPO_ROOT, encoding: 'utf8', env, timeout: 30_000 },
    )
    expect(retractionResult.status, 'gw AC_RETRACTION should exit 0').toBe(0)

    // Fold all events (coverage + retraction) and assert S-e2e IS absent.
    const jDir = path.join(projectDir, '.groundwork', 'motives', E2E_MOTIVE, 'journal')
    const scriptPath = path.join(scriptDir, 'verify-fold.mjs')
    writeFileSync(scriptPath, [
      `import { readdirSync, readFileSync } from 'node:fs'`,
      `import path from 'node:path'`,
      `import matter from 'gray-matter'`,
      `import { compile } from '${REPO_ROOT}/hooks/lib/motive-compile.mjs'`,
      `const jDir = ${JSON.stringify(jDir)}`,
      `const files = readdirSync(jDir).filter(f => f.endsWith('.md'))`,
      `const events = files.map(f => {`,
      `  const { data, content } = matter(readFileSync(path.join(jDir, f), 'utf8'))`,
      `  return { type: data.type, ts: data.ts, session: data.session || '', motive: ${JSON.stringify(E2E_MOTIVE)}, data: data.data ?? {}, msg: content.trim() }`,
      `})`,
      `const view = compile(events, {})`,
      `const acCov = view.agent.ac_coverage`,
      `const allEntries = [...(acCov?.met ?? []), ...(acCov?.unmet ?? [])]`,
      `const entry = allEntries.find(e => e.id === 'AC-e2e')`,
      `process.stdout.write('ac_coverage:' + JSON.stringify(acCov) + '\\n')`,
      `if (entry && entry.covering.includes('S-e2e')) { process.stderr.write('FAIL: S-e2e still present in AC-e2e covering after retraction\\n'); process.exit(1) }`,
    ].join('\n'))

    const verifyResult = spawnSync('bun', [scriptPath], {
      cwd: REPO_ROOT, encoding: 'utf8', env: process.env, timeout: 30_000,
    })
    expect(
      verifyResult.status,
      `fold: S-e2e should be absent from AC-e2e after retraction; stdout=${verifyResult.stdout} stderr=${verifyResult.stderr}`,
    ).toBe(0)
  })
})
