/**
 * test/ledger-motive-guard.test.ts
 *
 * Asserts that every gw ledger subcommand rejects with a non-zero exit and a
 * diagnostic naming both the --motive flag value and the ledger's recorded
 * motive when they disagree.  Tests spawn the CLI directly so they observe the
 * real observable behaviour (exit code + output text) rather than an internal
 * predicate.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const ROOT = new URL('../', import.meta.url).pathname
const GW_MAIN = join(ROOT, 'src', 'gw', 'cli', 'main.ts')
const SESSION_ID = 'motive-guard-test-session'
const REAL_MOTIVE = 'real-motive'
const WRONG_MOTIVE = 'wrong-motive'

let projectDir: string
let runPath: string

function makeEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    CLAUDE_PROJECT_DIR: projectDir,
    CLAUDE_CODE_SESSION_ID: SESSION_ID,
    GROUNDWORK_COMMENT_DENSITY: '0',
    GROUNDWORK_COMMIT_LINT: '0',
  }
}

function gw(subcmdArgs: string[]): ReturnType<typeof spawnSync> {
  return spawnSync('bun', ['run', GW_MAIN, 'ledger', ...subcmdArgs, '--json'], {
    env: makeEnv(),
    encoding: 'utf8',
  })
}

function writeFixtureLedger(motive: string): void {
  const data = JSON.stringify({
    active: true,
    motive,
    session_id: SESSION_ID,
    write_token: 'test-token',
    slices: [{ id: 'S1', wave: 0, status: 'pending' }],
    gate: {},
  }, null, 2)
  writeFileSync(runPath, data, 'utf8')
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'gw-motive-guard-'))
  mkdirSync(join(projectDir, '.groundwork', 'runs'), { recursive: true })
  runPath = join(projectDir, '.groundwork', 'runs', `${SESSION_ID}.json`)
  writeFixtureLedger(REAL_MOTIVE)
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Core invariant: mismatch → non-zero exit + diagnostic naming both motives
// ---------------------------------------------------------------------------

describe('motive mismatch guard', () => {
  const READ_ONLY_CMDS: Array<[string, string[]]> = [
    ['status', ['status', '--motive', WRONG_MOTIVE]],
    ['view',   ['view',   '--motive', WRONG_MOTIVE]],
    ['show',   ['show',   'S1', '--motive', WRONG_MOTIVE]],
    ['frontier', ['frontier', '--motive', WRONG_MOTIVE]],
  ]

  const MUTATION_CMDS: Array<[string, string[]]> = [
    ['add',    ['add',    'S99', '--motive', WRONG_MOTIVE]],
    ['set',    ['set',    'S1',  '--motive', WRONG_MOTIVE, '--status', 'in_progress']],
    ['complete', ['complete', 'S1', '--motive', WRONG_MOTIVE, '--token', 'test-token']],
    ['rm',     ['rm',     'S1',  '--motive', WRONG_MOTIVE]],
    ['claim',  ['claim',  'S1',  '--motive', WRONG_MOTIVE]],
  ]

  for (const [name, subcmdArgs] of [...READ_ONLY_CMDS, ...MUTATION_CMDS]) {
    it(`${name}: exits non-zero and names both motives`, () => {
      const r = gw(subcmdArgs)
      expect(r.status, `exit code for ${name}`).not.toBe(0)
      const envelope = JSON.parse(r.stdout as string) as { ok: boolean; error: { code: string; message: string } }
      expect(envelope.ok, 'envelope.ok').toBe(false)
      expect(envelope.error.code).toBe('MOTIVE_MISMATCH')
      expect(envelope.error.message).toContain(WRONG_MOTIVE)
      expect(envelope.error.message).toContain(REAL_MOTIVE)
      expect(envelope.error.message).toContain(runPath)
    })
  }
})

// ---------------------------------------------------------------------------
// Matching motive must not be rejected
// ---------------------------------------------------------------------------

describe('matching motive is accepted', () => {
  it('status: exits 0 when motive matches', () => {
    const r = gw(['status', '--motive', REAL_MOTIVE])
    expect(r.status).toBe(0)
    const envelope = JSON.parse(r.stdout as string) as { ok: boolean }
    expect(envelope.ok).toBe(true)
  })

  it('view: exits 0 when motive matches', () => {
    const r = gw(['view', '--motive', REAL_MOTIVE])
    expect(r.status).toBe(0)
    const envelope = JSON.parse(r.stdout as string) as { ok: boolean }
    expect(envelope.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Ledger without a recorded motive field must not be rejected (back-compat)
// ---------------------------------------------------------------------------

describe('ledger without motive field', () => {
  it('status: exits 0 when ledger has no motive field', () => {
    const data = JSON.stringify({
      active: true,
      session_id: SESSION_ID,
      slices: [],
      gate: {},
    })
    writeFileSync(runPath, data, 'utf8')
    const r = gw(['status', '--motive', REAL_MOTIVE])
    expect(r.status).toBe(0)
  })
})
