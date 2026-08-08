/**
 * Ledger CLI — fold-reference validation tests (MOTIVE-DAG-R-008).
 *
 * CLI-level proof that `ledger set` and `ledger add` validate covers_ac and
 * decisions against the canonical event-sourced fold and exit nonzero for
 * dangling references, naming the field and the unknown id in stderr.
 *
 * Distinct from test/motive-dag.test.mjs which tests the validateFoldRefs()
 * helper in isolation; this file tests the CLI contract end-to-end.
 *
 * @verifies MOTIVE-DAG-R-008
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const CLI = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'ledger.mjs')

const MOTIVE_ID = 'test-motive-fold'
const WRITE_TOKEN = 'tok-fold-refs'

let projectDir: string
let ledgerFile: string

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir }
  delete env.CLAUDE_CODE_SESSION_ID
  const r = spawnSync('node', [CLI, ...args], { env, encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** Write a ledger with a motive field pointing to our test motive. */
function writeMotiveLedger(): void {
  writeFileSync(
    ledgerFile,
    JSON.stringify(
      {
        version: 1,
        active: true,
        session_id: 'sess-fold-refs',
        brief: 'fold-refs test run',
        write_token: WRITE_TOKEN,
        motive: MOTIVE_ID,
        slices: [],
        gate: {},
      },
      null,
      2,
    ),
  )
}

/**
 * Write journal events that populate the fold with:
 *   decision:D-1  (DECISION event)
 *   ac:AC-1       (AC_COVERAGE declaration-form event)
 */
function writeMotiveJournal(): void {
  const journalDir = path.join(projectDir, '.groundwork', 'journal')
  mkdirSync(journalDir, { recursive: true })
  const events = [
    // DECISION → fold node id: decision:D-1
    {
      type: 'DECISION',
      ts: '2026-01-01T00:00:00.000Z',
      motive: MOTIVE_ID,
      data: { id: 'D-1', status: 'accepted', decision: 'Use fold-based validation' },
    },
    // AC_COVERAGE (declaration form) → fold node id: ac:AC-1
    {
      type: 'AC_COVERAGE',
      ts: '2026-01-01T00:01:00.000Z',
      motive: MOTIVE_ID,
      data: { ac: 'AC-1', covering: [] },
    },
  ]
  const shardPath = path.join(journalDir, '2026-01-01-sess-fold-refs.jsonl')
  writeFileSync(shardPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), 'gw-fold-refs-'))
  mkdirSync(path.join(projectDir, '.groundwork'), { recursive: true })
  ledgerFile = path.join(projectDir, '.groundwork', 'run.json')
  writeMotiveLedger()
  writeMotiveJournal()
  // Seed slice S1 for cmdSet tests
  run(['add', 'S1', '--token', WRITE_TOKEN])
})

afterEach(() => rmSync(projectDir, { recursive: true, force: true }))

// ── R-008 fit criterion: ledger set ───────────────────────────────────────────

describe('R-008: fold-reference validation via ledger set', () => {
  it('dangling covers_ac → exit nonzero + stderr names field and id', () => {
    const r = run(['set', 'S1', '--covers-ac', 'AC-999', '--token', WRITE_TOKEN])
    expect(r.code, `stderr: ${r.stderr}`).not.toBe(0)
    expect(r.stderr).toMatch(/covers_ac/)
    expect(r.stderr).toMatch(/AC-999/)
  })

  it('dangling decisions → exit nonzero + stderr names field and id', () => {
    const r = run(['set', 'S1', '--decisions', 'D-999', '--token', WRITE_TOKEN])
    expect(r.code, `stderr: ${r.stderr}`).not.toBe(0)
    expect(r.stderr).toMatch(/decisions/)
    expect(r.stderr).toMatch(/D-999/)
  })

  it('valid AC-1 and D-1 → exit 0 and fields written', () => {
    const r = run(['set', 'S1', '--covers-ac', 'AC-1', '--decisions', 'D-1', '--token', WRITE_TOKEN])
    expect(r.code, `stderr: ${r.stderr}`).toBe(0)
    expect(r.stdout).toMatch(/covers_ac=\[AC-1\]/)
    expect(r.stdout).toMatch(/decisions=\[D-1\]/)
  })
})

// ── R-008 fit criterion: ledger add ───────────────────────────────────────────

describe('R-008: fold-reference validation via ledger add', () => {
  it('dangling covers_ac on add → exit nonzero + stderr names field and id', () => {
    const r = run(['add', 'S2', '--covers-ac', 'AC-999', '--token', WRITE_TOKEN])
    expect(r.code, `stderr: ${r.stderr}`).not.toBe(0)
    expect(r.stderr).toMatch(/covers_ac/)
    expect(r.stderr).toMatch(/AC-999/)
  })

  it('dangling decisions on add → exit nonzero + stderr names field and id', () => {
    const r = run(['add', 'S2', '--decisions', 'D-999', '--token', WRITE_TOKEN])
    expect(r.code, `stderr: ${r.stderr}`).not.toBe(0)
    expect(r.stderr).toMatch(/decisions/)
    expect(r.stderr).toMatch(/D-999/)
  })

  it('valid AC-1 on add → exit 0', () => {
    const r = run(['add', 'S2', '--covers-ac', 'AC-1', '--token', WRITE_TOKEN])
    expect(r.code, `stderr: ${r.stderr}`).toBe(0)
  })
})

// ── R-008: graceful degradation ───────────────────────────────────────────────

describe('R-008: graceful degradation — motive-less ledger skips fold validation', () => {
  it('ledger without motive: dangling AC ref → exit 0 (no fold to validate against)', () => {
    // Overwrite with a ledger that has no motive field
    writeFileSync(
      ledgerFile,
      JSON.stringify(
        {
          version: 1,
          active: true,
          session_id: 'sess-no-motive',
          brief: 'no-motive test',
          write_token: WRITE_TOKEN,
          slices: [{ id: 'S3', status: 'pending', wave: 0, desc: '' }],
          gate: {},
        },
        null,
        2,
      ),
    )
    const r = run(['set', 'S3', '--covers-ac', 'AC-999', '--token', WRITE_TOKEN])
    expect(r.code, `stderr: ${r.stderr}`).toBe(0)
  })
})
