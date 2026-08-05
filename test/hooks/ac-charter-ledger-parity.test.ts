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
  mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, test, expect, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Paths — relative to this test file's repo root
// ---------------------------------------------------------------------------

const ROOT = new URL('../../', import.meta.url).pathname
const LEDGER_CLI = join(ROOT, 'hooks', 'ledger.mjs')
const JOURNAL_CLI = join(ROOT, 'hooks', 'journal.mjs')

// ---------------------------------------------------------------------------
// Per-test state
// ---------------------------------------------------------------------------

/** Unique motive id per test-run prefix; tests pick a suffix. */
const MOTIVE = 'parity-ac-test'

let projectDir: string

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

/** Build an env block that isolates the CLI to the temp project. */
function makeEnv(): Record<string, string> {
  // Construct a clean env: keep PATH and HOME (needed by node), set project dir,
  // and EXPLICITLY omit CLAUDE_CODE_SESSION_ID so the ledger uses run.json.
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    CLAUDE_PROJECT_DIR: projectDir,
  }
  // Never leak the ambient session id — doing so would target the wrong ledger path
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

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

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

  // Stdout contains two lines:
  //   ledger initialized: 0 slices → <path>
  //   write_token: <token>  (orchestrator: pass --token on gate/complete)
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

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'gw-ac-parity-'))
  mkdirSync(join(projectDir, '.groundwork', 'journal'), { recursive: true })
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// P-1: ROUND-TRIP JOIN
//
// An AC-id declared in the charter AND claimed via --covers-ac on a completed
// slice must resolve to exactly ONE key in ac_coverage, and that key must be met.
// Asserting the key COUNT is the critical part: a silent split into two keys
// (one met, one unmet) would not be caught by a test that only checks "met is
// non-empty".
// ---------------------------------------------------------------------------

describe('P-1: round-trip join — declared + claimed → exactly one key, met', () => {
  test('AC-1 and AC-2 each produce exactly one key and are met; AC-3 is unmet', () => {
    writeCharter()
    const token = initLedger()

    // --covers-ac argument with surrounding whitespace around the comma; trim
    // must strip it on the CLAIM side to produce ["AC-1","AC-2"].
    const add = spawnLedger(['add', 'S1', '--wave', '1',
      '--desc', 'parity slice', '--covers-ac', 'AC-1, AC-2'])
    expect(add.code).toBe(0)

    const complete = spawnLedger(['complete', 'S1', '--token', token])
    expect(complete.code).toBe(0)

    const { met, unmet } = compileAcCoverage()

    // Exactly 2 met entries — one for AC-1, one for AC-2.
    // If there were a split, "AC-1" and " AC-1" would appear as two unmet keys.
    expect(met.length).toBe(2)

    const metIds = met.map((e: any) => e.id).sort()
    expect(metIds).toEqual(['AC-1', 'AC-2'])

    // AC-1 and AC-2 must be marked met
    for (const entry of met) {
      expect(entry.met).toBe(true)
      expect(entry.covering).toContain('S1')
      expect(entry.missing).toHaveLength(0)
    }

    // Total key count: 3 (exactly the charter-declared ACs)
    // A split on AC-1 would produce 4.
    const totalKeys = met.length + unmet.length
    expect(totalKeys).toBe(3)

    // AC-3: declared but no slice covers it → appears in unmet with covering: []
    const ac3Unmet = unmet.find((e: any) => e.id === 'AC-3')
    expect(ac3Unmet).toBeDefined()
    expect(ac3Unmet.covering).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// P-2: DECLARED-BUT-UNCLAIMED appears in unmet with covering: []
//
// A charter AC that no slice claims must NOT vanish from the compiled output.
// It must appear in unmet.covering === [].
// ---------------------------------------------------------------------------

describe('P-2: declared-but-unclaimed AC appears in unmet with covering: []', () => {
  test('AC-3 is declared but never claimed — must appear in unmet with empty covering', () => {
    writeCharter()
    const token = initLedger()

    // Only claim AC-1 and AC-2; AC-3 is never claimed.
    spawnLedger(['add', 'S2', '--wave', '1',
      '--desc', 'slice claiming AC-1 only', '--covers-ac', 'AC-1'])
    spawnLedger(['complete', 'S2', '--token', token])

    const { met, unmet } = compileAcCoverage()

    // AC-3 must be in unmet (it was seeded from the charter)
    const ac3 = unmet.find((e: any) => e.id === 'AC-3')
    expect(ac3).toBeDefined()
    expect(ac3!.covering).toEqual([])

    // AC-3 must NOT appear in met
    const ac3Met = met.find((e: any) => e.id === 'AC-3')
    expect(ac3Met).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// P-3: CLAIMED-BUT-UNDECLARED still appears (pinning union behavior)
//
// A slice that claims an AC id absent from the charter should still appear in
// the compiled output — the current behavior is a union, not an intersection.
// Pinning this so a future change to the union logic is a visible decision.
// ---------------------------------------------------------------------------

describe('P-3: claimed-but-undeclared AC still appears (current union behavior)', () => {
  test('AC-99 is not in the charter but is claimed — must appear somewhere in ac_coverage', () => {
    writeCharter()  // charter has AC-1, AC-2, AC-3 only
    const token = initLedger()

    spawnLedger(['add', 'S3', '--wave', '1',
      '--desc', 'slice with undeclared AC', '--covers-ac', 'AC-1,AC-99'])
    spawnLedger(['complete', 'S3', '--token', token])

    const { met, unmet } = compileAcCoverage()

    // AC-99 must be present somewhere
    const allIds = [...met, ...unmet].map((e: any) => e.id)
    expect(allIds).toContain('AC-99')

    // And since S3 is complete, AC-99 should be met
    const ac99 = met.find((e: any) => e.id === 'AC-99')
    expect(ac99).toBeDefined()
    expect(ac99!.met).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// P-4: THE PARITY PROPERTY — same id string through both paths
//
// Drive the SAME id ("AC-1") through both the charter path (parsed by
// parseAcceptanceCriteria) and the ledger path (parsed from --covers-ac)
// and assert the resulting key count is exactly 1.
//
// The whitespace variant: "--covers-ac '  AC-1  '" (leading + trailing spaces)
// must trim to "AC-1" and not produce a separate key.
//
// WHAT A FAILURE LOOKS LIKE: if the charter produces "AC-1" and the ledger
// claim produces "ac-1" (wrong case) or " AC-1" (untrimmed), they join to
// two keys instead of one — and the test fails by seeing key count > 1 for
// that AC.
// ---------------------------------------------------------------------------

describe('P-4: parity property — charter id and covers-ac id agree on key string', () => {
  test('AC-1 declared in charter and claimed with leading/trailing whitespace → 1 key, met', () => {
    // Single-AC charter so we can count with precision
    const singleAcCharter = `\
# parity-ac-test

## Objective

Single-AC parity fixture.

## Acceptance criteria

- AC-1: Only criterion
`
    writeCharter(singleAcCharter)
    const token = initLedger()

    // Leading and trailing spaces around "AC-1" in the --covers-ac argument.
    // ledger add trims each token after splitting on comma; the charter parser
    // trims the whole line before regex-matching.  Both must land on "AC-1".
    spawnLedger(['add', 'S4', '--wave', '1',
      '--desc', 'whitespace trim parity', '--covers-ac', '  AC-1  '])
    spawnLedger(['complete', 'S4', '--token', token])

    const { met, unmet } = compileAcCoverage()

    // Total key count MUST be exactly 1 — "AC-1" from charter and "AC-1" from claim
    // join to the same key.  A whitespace mismatch would produce 2 keys.
    const totalKeys = met.length + unmet.length
    expect(totalKeys).toBe(1)

    // The single key must be met
    expect(met).toHaveLength(1)
    expect(met[0].id).toBe('AC-1')
    expect(met[0].met).toBe(true)
    expect(unmet).toHaveLength(0)
  })

  test('multi-AC claim with mixed whitespace: "AC-1,  AC-2 " → 2 met keys, not 3', () => {
    writeCharter()
    const token = initLedger()

    // Irregular whitespace: no space before AC-1, two spaces before AC-2, trailing space on AC-2
    spawnLedger(['add', 'S5', '--wave', '1',
      '--desc', 'multi-AC whitespace', '--covers-ac', 'AC-1,  AC-2 '])
    spawnLedger(['complete', 'S5', '--token', token])

    const { met, unmet } = compileAcCoverage()

    // Only 2 met keys despite the irregular whitespace — no ghost keys
    expect(met.length).toBe(2)
    const metIds = met.map((e: any) => e.id).sort()
    expect(metIds).toEqual(['AC-1', 'AC-2'])

    // Total = 3 (charter declares exactly 3 ACs)
    expect(met.length + unmet.length).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// P-5: CASE MISMATCH — lowercase `ac-` prefix is rejected with a warning
//
// The AC_ITEM_RE regex is STRICT (no /i flag).  A charter line like
// `- ac-1: text` MUST NOT be silently parsed as id "ac-1" (which would split
// the key when the ledger claims "AC-1").  Instead it must:
//   a) be rejected by the strict parser (not appear in compiled ac_coverage)
//   b) emit a visible [motive-charter] warn: message to stderr naming the line
//   c) NOT silently split: if a slice claims "AC-1" it appears as
//      claimed-but-undeclared (union behavior, like P-3), not as a phantom match
//      against the rejected lowercase declaration.
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

    // Init ledger directly (not via initLedger helper) so we can inspect stderr.
    // ledger init reads the charter to seed journal events, so the strict-parser
    // warning fires here — this is the most direct observable evidence.
    const seed = JSON.stringify({ version: 1, active: true, brief: 'parity test run', slices: [], gate: {} })
    const initR = spawnLedger(['init', '-', '--motive', MOTIVE], { input: seed })
    expect(initR.code).toBe(0)

    // (a) The warning must name the offending line and appear on stderr
    expect(initR.stderr).toContain('[motive-charter] warn:')
    expect(initR.stderr).toContain('ac-1')

    // Extract the write-token so we can add/complete a slice.
    const tokenM = initR.stdout.match(/write_token:\s+(\S+)/)
    if (!tokenM) throw new Error(`write_token not found in:\n${initR.stdout}`)
    const token = tokenM[1]

    // Add and complete a dummy slice (no --covers-ac) so journal compile has
    // events to process — compile exits 1 with "no events found" otherwise.
    spawnLedger(['add', 'S0', '--wave', '1', '--desc', 'dummy — no AC claim'])
    spawnLedger(['complete', 'S0', '--token', token])

    // (b) The lowercase id must NOT appear in ac_coverage at all —
    //     neither as a met nor as an unmet entry.  The item was rejected;
    //     there are zero charter-seeded keys and no slice claimed any AC.
    const { met, unmet } = compileAcCoverage()
    const allIds = [...met, ...unmet].map((e: any) => e.id)
    expect(allIds).not.toContain('ac-1')
    expect(allIds).not.toContain('AC-1')
    expect(met.length + unmet.length).toBe(0)
  })

  test('claiming AC-1 against a lowercase charter does NOT silently split the key', () => {
    // Before the fix: the charter would parse id "ac-1" and the ledger would
    // register "AC-1".  The compile join would produce TWO distinct keys —
    // "ac-1" (unmet, charter-seeded) and "AC-1" (met, claim-only) — a silent
    // split with no error.
    //
    // After the fix: the strict parser rejects "ac-1" with a warning.  The
    // charter seeds ZERO keys.  The ledger claim for "AC-1" appears as
    // claimed-but-undeclared (union behavior), so there is exactly 1 key total,
    // not 2.
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

    // There must be exactly 1 key, not 2.
    // Pre-fix: "ac-1" (unmet, charter-seeded) + "AC-1" (met, claim) = 2 keys.
    // Post-fix: only "AC-1" (met, claim; no charter seed) = 1 key.
    expect(totalKeys).toBe(1)

    // That single key is "AC-1" (the claimed, uppercase form) and is met.
    expect(ac.met).toHaveLength(1)
    expect(ac.met[0].id).toBe('AC-1')
    expect(ac.met[0].met).toBe(true)

    // "ac-1" (lowercase form) must not appear anywhere
    const allIds = [...ac.met, ...ac.unmet].map((e: any) => e.id)
    expect(allIds).not.toContain('ac-1')
  })
})
