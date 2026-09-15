/**
 * AC-charter–ledger PARITY test — pins the id-string join across the
 * append/compile seam.
 *
 * The seam under test:
 *   DECLARE side  hooks/lib/motive-charter.mjs → parseAcceptanceCriteria()
 *                 parses "- AC-<id>: statement" and returns { id: "AC-<id>" }
 *   CLAIM  side   hooks/ledger.mjs → cmdAdd() stores flags['covers-ac'].split(',').map(s => s.trim())
 *                 hooks/ledger.mjs → cmdComplete() emits AC_COVERAGE events { data: { slice, ac } }
 *   JOIN   side   hooks/lib/motive-compile.mjs → AC_COVERAGE handler keys on String(d.ac)
 *                 compile() seeds acCoverageMap from charter { id } strings; no normalisation bridge
 *
 * If either side normalises ids differently (case fold, zero-pad, trim-different) the two
 * keys drift apart: one AC is unmet forever, one is orphaned — and both sides' own tests pass.
 *
 * ISOLATION: every test creates its own mkdtemp project dir and writes its own charter
 * fixture. The real repo tree is never read or written.  CLAUDE_PROJECT_DIR is always
 * overridden to the temp dir.  CLAUDE_CODE_SESSION_ID is always absent so the ledger
 * uses the legacy run.json path inside the temp dir.
 */

// @ts-nocheck
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, test, expect, beforeEach, afterEach } from 'vitest'

const ROOT = new URL('../../', import.meta.url).pathname
const LEDGER_CLI = join(ROOT, 'hooks', 'ledger.mjs')
const JOURNAL_CLI = join(ROOT, 'hooks', 'journal.mjs')

/** Unique motive id per test-run prefix; tests pick a suffix. */
const MOTIVE = 'parity-ac-test'

let projectDir: string

/** Build an env block that isolates the CLI to the temp project. */
function makeEnv(): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    CLAUDE_PROJECT_DIR: projectDir,
  }
  return env
}

function spawnLedger(
  args: string[],
  opts: { input?: string } = {},
): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [LEDGER_CLI, ...args], {
    env: makeEnv(),
    encoding: 'utf8',
    input: opts.input,
  })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function spawnJournal(
  args: string[],
): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [JOURNAL_CLI, ...args], {
    env: makeEnv(),
    encoding: 'utf8',
  })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/**
 * Write a motive charter with three ACs.
 * motive id "parity-ac-test" → charter at .groundwork/motives/parity-ac-test/motive.md
 */
function writeCharter(content?: string): void {
  const charterDir = join(projectDir, '.groundwork', 'motives', MOTIVE)
  mkdirSync(charterDir, { recursive: true })
  writeFileSync(
    join(charterDir, 'motive.md'),
    content ?? DEFAULT_CHARTER,
  )
}

const DEFAULT_CHARTER = `\
# parity-ac-test

## Objective

Parity fixture for the charter–ledger join seam test.

## Acceptance criteria

- AC-1: First criterion — must always appear
- AC-2: Second criterion — claimed by slice with surrounding whitespace
- AC-3: Third criterion — intentionally unclaimed (declared-but-uncovered)
`

/**
 * Initialise a fresh ledger for MOTIVE and return the write-token.
 * The seed JSON has no slices so all slices come from subsequent ledger add calls.
 */
function initLedger(): string {
  const seed = JSON.stringify({
    version: 1,
    active: true,
    brief: 'parity test run',
    slices: [],
    gate: {},
  })
  const { code, stdout, stderr } = spawnLedger(
    ['init', '-', '--motive', MOTIVE],
    { input: seed },
  )
  if (code !== 0) throw new Error(`ledger init failed (${code}): ${stderr}\n${stdout}`)

  const m = stdout.match(/write_token:\s+(\S+)/)
  if (!m) throw new Error(`write_token not found in ledger init stdout:\n${stdout}`)
  return m[1]
}

/**
 * Run "journal compile <MOTIVE> --no-ground-truth --stdout --json" and parse
 * the result.  Returns view.agent.ac_coverage.
 * --no-ground-truth avoids reading any file outside the temp project; completeness
 * is still verifiable because ledger complete emits TASK_COMPLETE events into the
 * journal shard, and the compile fold uses those events for isComplete().
 */
function compileAcCoverage(): { met: any[]; unmet: any[] } {
  const { code, stdout, stderr } = spawnJournal([
    'compile', MOTIVE, '--no-ground-truth', '--stdout', '--json',
  ])
  if (code !== 0) {
    throw new Error(`journal compile failed (code ${code}):\nstderr: ${stderr}\nstdout: ${stdout}`)
  }
  const view = JSON.parse(stdout)
  return view.agent.ac_coverage as { met: any[]; unmet: any[] }
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'gw-ac-parity-'))
  mkdirSync(join(projectDir, '.groundwork', 'journal'), { recursive: true })
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// P-1: ROUND-TRIP JOIN
// ---------------------------------------------------------------------------

describe('P-1: round-trip join — declared + claimed → exactly one key, met', () => {
  test('AC-1 and AC-2 each produce exactly one key and are met; AC-3 is unmet', () => {
    writeCharter()
    const token = initLedger()

    const add = spawnLedger(['add', 'S1', '--wave', '1',
      '--desc', 'parity slice', '--covers-ac', 'AC-1, AC-2'])
    expect(add.code).toBe(0)

    const complete = spawnLedger(['complete', 'S1', '--token', token])
    expect(complete.code).toBe(0)

    const { met, unmet } = compileAcCoverage()

    expect(met.length).toBe(2)

    const metIds = met.map((e: any) => e.id).sort()
    expect(metIds).toEqual(['AC-1', 'AC-2'])

    for (const entry of met) {
      expect(entry.met).toBe(true)
      expect(entry.covering).toContain('S1')
      expect(entry.missing).toHaveLength(0)
    }

    const totalKeys = met.length + unmet.length
    expect(totalKeys).toBe(3)

    const ac3Unmet = unmet.find((e: any) => e.id === 'AC-3')
    expect(ac3Unmet).toBeDefined()
    expect(ac3Unmet.covering).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// P-2: DECLARED-BUT-UNCLAIMED appears in unmet with covering: []
// ---------------------------------------------------------------------------

describe('P-2: declared-but-unclaimed AC appears in unmet with covering: []', () => {
  test('AC-3 is declared but never claimed — must appear in unmet with empty covering', () => {
    writeCharter()
    const token = initLedger()

    spawnLedger(['add', 'S2', '--wave', '1',
      '--desc', 'slice claiming AC-1 only', '--covers-ac', 'AC-1'])
    spawnLedger(['complete', 'S2', '--token', token])

    const { met, unmet } = compileAcCoverage()

    const ac3 = unmet.find((e: any) => e.id === 'AC-3')
    expect(ac3).toBeDefined()
    expect(ac3!.covering).toEqual([])

    const ac3Met = met.find((e: any) => e.id === 'AC-3')
    expect(ac3Met).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// P-3: CLAIMED-BUT-UNDECLARED still appears (pinning union behavior)
// ---------------------------------------------------------------------------

describe('P-3: claimed-but-undeclared AC still appears (current union behavior)', () => {
  test('AC-99 is not in the charter but is claimed — must appear somewhere in ac_coverage', () => {
    writeCharter()  // charter has AC-1, AC-2, AC-3 only
    const token = initLedger()

    spawnLedger(['add', 'S3', '--wave', '1',
      '--desc', 'slice with undeclared AC', '--covers-ac', 'AC-1,AC-99'])
    spawnLedger(['complete', 'S3', '--token', token])

    const { met, unmet } = compileAcCoverage()

    const allIds = [...met, ...unmet].map((e: any) => e.id)
    expect(allIds).toContain('AC-99')

    const ac99 = met.find((e: any) => e.id === 'AC-99')
    expect(ac99).toBeDefined()
    expect(ac99!.met).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// P-4: THE PARITY PROPERTY — same id string through both paths
// WHAT A FAILURE LOOKS LIKE: if the charter produces "AC-1" and the ledger
// claim produces "ac-1" (wrong case) or " AC-1" (untrimmed), they join to
// two keys instead of one — and the test fails by seeing key count > 1 for
// that AC.
// ---------------------------------------------------------------------------

describe('P-4: parity property — charter id and covers-ac id agree on key string', () => {
  test('AC-1 declared in charter and claimed with leading/trailing whitespace → 1 key, met', () => {
    const singleAcCharter = `\
# parity-ac-test

## Objective

Single-AC parity fixture.

## Acceptance criteria

- AC-1: Only criterion
`
    writeCharter(singleAcCharter)
    const token = initLedger()

    spawnLedger(['add', 'S4', '--wave', '1',
      '--desc', 'whitespace trim parity', '--covers-ac', '  AC-1  '])
    spawnLedger(['complete', 'S4', '--token', token])

    const { met, unmet } = compileAcCoverage()

    const totalKeys = met.length + unmet.length
    expect(totalKeys).toBe(1)

    expect(met).toHaveLength(1)
    expect(met[0].id).toBe('AC-1')
    expect(met[0].met).toBe(true)
    expect(unmet).toHaveLength(0)
  })

  test('multi-AC claim with mixed whitespace: "AC-1,  AC-2 " → 2 met keys, not 3', () => {
    writeCharter()
    const token = initLedger()

    spawnLedger(['add', 'S5', '--wave', '1',
      '--desc', 'multi-AC whitespace', '--covers-ac', 'AC-1,  AC-2 '])
    spawnLedger(['complete', 'S5', '--token', token])

    const { met, unmet } = compileAcCoverage()

    expect(met.length).toBe(2)
    const metIds = met.map((e: any) => e.id).sort()
    expect(metIds).toEqual(['AC-1', 'AC-2'])

    expect(met.length + unmet.length).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// P-5: CASE MISMATCH — lowercase `ac-` prefix is rejected with a warning
//
// The AC_ITEM_RE regex is STRICT (no /i flag).  A charter line like
// `- ac-1: text` MUST NOT be silently parsed as id "ac-1" (which would split
// the key when the ledger claims "AC-1").
// ---------------------------------------------------------------------------

describe('P-5: case mismatch — lowercase AC prefix is rejected with a warning, not silently split', () => {
  /** Charter with only a lowercase ac-1 declaration — should be rejected. */
  const LOWERCASE_CHARTER = `\
# parity-ac-test

## Objective

Lowercase-AC fixture for case-mismatch contract test.

## Acceptance criteria

- ac-1: Lowercase criterion — strict parser must reject this
`

  test('lowercase declaration emits [motive-charter] warn: to stderr and does not parse the id', () => {
    writeCharter(LOWERCASE_CHARTER)
    const token = initLedger()

    // Add and complete a dummy slice (no --covers-ac) so journal compile has
    // events to process — compile exits 1 with "no events found" otherwise.
    spawnLedger(['add', 'S0', '--wave', '1', '--desc', 'dummy — no AC claim'])
    spawnLedger(['complete', 'S0', '--token', token])

    // `journal compile` is the surviving charter-consuming path: it calls
    // readCharter() to seed charter-declared ACs into the coverage join, so the
    // strict-parser warning fires on its stderr.  This is the seam under test —
    const compileR = spawnJournal([
      'compile', MOTIVE, '--no-ground-truth', '--stdout', '--json',
    ])
    expect(compileR.code).toBe(0)

    expect(compileR.stderr).toContain('[motive-charter] warn:')
    expect(compileR.stderr).toContain('ac-1')

    const { met, unmet } = JSON.parse(compileR.stdout).agent.ac_coverage as { met: any[]; unmet: any[] }
    const allIds = [...met, ...unmet].map((e: any) => e.id)
    expect(allIds).not.toContain('ac-1')
    expect(allIds).not.toContain('AC-1')
    expect(met.length + unmet.length).toBe(0)
  })

  test('claiming AC-1 against a lowercase charter does NOT silently split the key', () => {
    writeCharter(LOWERCASE_CHARTER)
    const token = initLedger()

    spawnLedger(['add', 'S6', '--wave', '1',
      '--desc', 'claims uppercase AC-1 against lowercase charter', '--covers-ac', 'AC-1'])
    spawnLedger(['complete', 'S6', '--token', token])

    const r = spawnJournal([
      'compile', MOTIVE, '--no-ground-truth', '--stdout', '--json',
    ])
    expect(r.code).toBe(0)

    const view = JSON.parse(r.stdout)
    const ac = view.agent.ac_coverage as { met: any[]; unmet: any[] }
    const totalKeys = ac.met.length + ac.unmet.length

    expect(totalKeys).toBe(1)

    expect(ac.met).toHaveLength(1)
    expect(ac.met[0].id).toBe('AC-1')
    expect(ac.met[0].met).toBe(true)

    const allIds = [...ac.met, ...ac.unmet].map((e: any) => e.id)
    expect(allIds).not.toContain('ac-1')
  })
})



