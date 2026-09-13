/**
 * T29: the auth error names the verb actually invoked, not the stale
 * "gate/complete/abandon" list. Asserts on printed output, not source text.
 *
 * Both CLI surfaces MUST print an error message that names the invoked verb
 * when a write-token-gated subcommand is called without --token.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const LEDGER_MJS = join(ROOT, 'hooks/ledger.mjs')
const GW_MAIN = join(ROOT, 'src/gw/cli/main.ts')
const SESSION_ID = 'test-auth-verb'
const MOTIVE = 'test-auth-verb'

function makeEnv(projectDir: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    CLAUDE_PROJECT_DIR: projectDir,
    CLAUDE_CODE_SESSION_ID: SESSION_ID,
  }
}

function initLedger(projectDir: string): void {
  const seed = JSON.stringify({ version: 1, active: true, slices: [], gate: {} })
  const r = spawnSync('node', [LEDGER_MJS, 'init', '-', '--motive', MOTIVE], {
    env: makeEnv(projectDir),
    encoding: 'utf8',
    input: seed,
  })
  if ((r.status ?? 1) !== 0)
    throw new Error(`ledger init failed (${r.status}): ${r.stderr}`)
}

type RunResult = { status: number; stdout: string; stderr: string }

function nodeRun(projectDir: string, args: string[]): RunResult {
  const r = spawnSync('node', [LEDGER_MJS, ...args], {
    env: makeEnv(projectDir),
    encoding: 'utf8',
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function bunRun(projectDir: string, args: string[]): RunResult {
  const r = spawnSync('bun', ['run', GW_MAIN, 'ledger', '--motive', MOTIVE, ...args], {
    env: makeEnv(projectDir),
    encoding: 'utf8',
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

type Surface = { name: string; run: (args: string[]) => RunResult }

function runSuiteOn(getSurface: (dir: string) => Surface) {
  let projectDir: string

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'gw-auth-verb-'))
    mkdirSync(join(projectDir, '.groundwork', 'runs'), { recursive: true })
    initLedger(projectDir)
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  it('names "hold" when hold is invoked without --token', () => {
    const { run } = getSurface(projectDir)
    const r = run(['hold', '--phase', 'plan'])
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).not.toBe(0)
    const output = r.stdout + r.stderr
    expect(output).toMatch(/\bhold\b/)
    expect(output).not.toContain('gate/complete/abandon')
  })

  it('names "checkpoint" when checkpoint is invoked without --token', () => {
    const { run } = getSurface(projectDir)
    const r = run(['checkpoint', '--phase', 'plan', '--verdict', 'APPROVE', '--verified-by', 'human'])
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).not.toBe(0)
    const output = r.stdout + r.stderr
    expect(output).toMatch(/\bcheckpoint\b/)
    expect(output).not.toContain('gate/complete/abandon')
  })
}

describe('hooks/ledger.mjs surface', () => runSuiteOn((d) => ({ name: 'hooks/ledger.mjs', run: (a) => nodeRun(d, a) })))
describe('src/gw/cli/main.ts surface', () => runSuiteOn((d) => ({ name: 'src/gw/cli/main.ts', run: (a) => bunRun(d, a) })))
