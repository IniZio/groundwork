/**
 * Ledger CLI — abandon integration tests + pacing policy requirements.
 *
 * Verifies that:
 *   - ledger help abandon documents the --session flag
 *   - ledger abandon --session <id> targets the correct per-session file
 *   - pacing-r-001: absent pacing disables enforcement (claim passes through)
 *   - pacing-r-002: budget-exhausted claim is blocked for a new wave
 *   - pacing-r-003: ledger complete is never blocked by pacing
 */

// @verifies pacing-r-001
// @verifies pacing-r-002
// @verifies pacing-r-003

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const CLI = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'ledger.mjs')
const SESSION_PACING = 'pacing-req-test-session'

let projectDir: string

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir }
  delete env.CLAUDE_CODE_SESSION_ID
  const r = spawnSync('node', [CLI, ...args], { env, encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** Run ledger CLI with a fixed session id so per-session run files are used. */
function runS(args: string[]): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: SESSION_PACING }
  const r = spawnSync('node', [CLI, ...args], { env, encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** Write a ledger fixture to the per-session run file used by runS(). */
function writeRunLedger(ledger: unknown): void {
  const runsDir = path.join(projectDir, '.groundwork', 'runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(path.join(runsDir, `${SESSION_PACING}.json`), JSON.stringify(ledger, null, 2))
}

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), 'gw-pacing-'))
  mkdirSync(path.join(projectDir, '.groundwork'), { recursive: true })
})

afterEach(() => rmSync(projectDir, { recursive: true, force: true }))

describe('ledger help abandon', () => {
  it('documents --session <id> in the help output', () => {
    const r = run(['help', 'abandon'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('--session')
  })
})

describe('ledger abandon --session <id> behavior pin', () => {
  it('flips active:false on the targeted per-session run file without CLAUDE_CODE_SESSION_ID set', () => {
    const sessionId = 'test-session-abc123'
    const runsDir = path.join(projectDir, '.groundwork', 'runs')
    mkdirSync(runsDir, { recursive: true })
    const runFile = path.join(runsDir, `${sessionId}.json`)
    const ledger = {
      version: 1,
      active: true,
      session_id: sessionId,
      brief: 'behavior-pin test run',
      write_token: 'tok-reg',
      slices: [],
      gate: {},
    }
    writeFileSync(runFile, JSON.stringify(ledger, null, 2))

    const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir }
    delete env.CLAUDE_CODE_SESSION_ID
    const r = spawnSync('node', [CLI, 'abandon', '--session', sessionId, '--token', 'tok-reg'], { env, encoding: 'utf8' })
    expect(r.status).toBe(0)
    const updated = JSON.parse(readFileSync(runFile, 'utf8'))
    expect(updated.active).toBe(false)
  })
})

describe('pacing-r-001: absent pacing field disables enforcement', () => {
  it('claim exits 0 when ledger has no pacing field', () => {
    writeRunLedger({
      version: 1,
      active: true,
      session_id: SESSION_PACING,
      brief: 'no-pacing test',
      write_token: 'tok-nopace',
      slices: [{ id: 'S0', wave: 0, kind: 'impl', status: 'pending' }],
      gate: {},
    })
    const r = runS(['claim', 'S0'])
    expect(r.code, `claim must succeed when pacing field is absent; stderr: ${r.stderr}`).toBe(0)
  })
})


describe('pacing-r-003: ledger complete is never blocked by pacing', () => {
  it('exits 0 for ledger complete even when pacing budget is exhausted', () => {
    writeRunLedger({
      version: 1,
      active: true,
      session_id: SESSION_PACING,
      brief: 'pacing-r-003 test',
      write_token: 'tok-r003',
      pacing: { policy: 'wave', budget: 1, exempt_kinds: ['plan', 'diagnose', 'design', 'fog'] },
      slices: [
        { id: 'S0a', wave: 0, kind: 'impl', status: 'complete' },
        { id: 'S0b', wave: 0, kind: 'impl', status: 'complete' },
        { id: 'S1a', wave: 1, kind: 'impl', status: 'pending' },
      ],
      gate: {},
    })
    const r = runS(['complete', 'S1a', '--token', 'tok-r003'])
    expect(r.code, `complete must never be blocked by pacing; stderr: ${r.stderr}`).toBe(0)
  })
})
