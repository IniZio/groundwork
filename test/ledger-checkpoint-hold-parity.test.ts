/**
 * T21: parity test for `gw ledger hold` and checkpoint-APPROVE release.
 *
 * Both CLI surfaces (hooks/ledger.mjs via node, src/gw/cli/main.ts via bun) MUST:
 *   1. SET checkpoint_hold at ledger top level via `hold --phase <p>`
 *   2. CLEAR it via `hold clear`
 *   3. CLEAR it automatically when `checkpoint --verdict APPROVE` matches the held phase
 *
 * Bite proof: a /tmp copy of hooks/ledger.mjs is perturbed so cmdHold does NOT
 * write checkpoint_hold. The hold-set assertion then fails on the perturbed copy,
 * proving the guard is not vacuous.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const LEDGER_MJS = join(ROOT, 'hooks/ledger.mjs')
const GW_MAIN = join(ROOT, 'src/gw/cli/main.ts')
const SESSION_ID = 'test-hold'
const MOTIVE = 'test-hold-parity'

function makeEnv(projectDir: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    CLAUDE_PROJECT_DIR: projectDir,
    CLAUDE_CODE_SESSION_ID: SESSION_ID,
  }
}

function initLedger(projectDir: string): string {
  const seed = JSON.stringify({ version: 1, active: true, slices: [], gate: {} })
  const r = spawnSync('node', [LEDGER_MJS, 'init', '-', '--motive', MOTIVE], {
    env: makeEnv(projectDir),
    encoding: 'utf8',
    input: seed,
  })
  if ((r.status ?? 1) !== 0)
    throw new Error(`ledger init failed (${r.status}): ${r.stderr}`)
  const m = r.stdout.match(/write_token:\s+(\S+)/)
  if (!m) throw new Error(`write_token missing: ${r.stdout}`)
  return m[1]
}

function readLedger(runPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(runPath, 'utf8')) as Record<string, unknown>
}

type RunResult = { status: number; stdout: string; stderr: string }

function nodeRun(ledgerMjs: string, projectDir: string, args: string[]): RunResult {
  const r = spawnSync('node', [ledgerMjs, ...args], { env: makeEnv(projectDir), encoding: 'utf8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function bunRun(projectDir: string, args: string[]): RunResult {
  const r = spawnSync('bun', ['run', GW_MAIN, 'ledger', ...args, '--motive', MOTIVE], {
    env: makeEnv(projectDir),
    encoding: 'utf8',
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

type Surface = { name: string; run: (args: string[]) => RunResult }

function hooksSurface(projectDir: string): Surface {
  return { name: 'hooks/ledger.mjs', run: (args) => nodeRun(LEDGER_MJS, projectDir, args) }
}

function tsSurface(projectDir: string): Surface {
  return { name: 'src/gw/cli/main.ts', run: (args) => bunRun(projectDir, args) }
}

function runSuiteOn(getSurface: (dir: string) => Surface) {
  let projectDir: string
  let runPath: string
  let token: string
  let surface: Surface

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'gw-hold-parity-'))
    mkdirSync(join(projectDir, '.groundwork', 'runs'), { recursive: true })
    runPath = join(projectDir, '.groundwork', 'runs', `${SESSION_ID}.json`)
    token = initLedger(projectDir)
    surface = getSurface(projectDir)
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  it('hold --phase sets checkpoint_hold at ledger top level', () => {
    const r = surface.run(['hold', '--phase', 'plan', '--token', token])
    expect(r.status, r.stderr).toBe(0)
    expect(readLedger(runPath).checkpoint_hold).toBe('plan')
  })

  it('hold clear removes checkpoint_hold', () => {
    surface.run(['hold', '--phase', 'plan', '--token', token])
    const r = surface.run(['hold', 'clear', '--token', token])
    expect(r.status, r.stderr).toBe(0)
    expect(readLedger(runPath).checkpoint_hold).toBeUndefined()
  })

  it('checkpoint APPROVE for the held phase releases checkpoint_hold', () => {
    surface.run(['hold', '--phase', 'plan', '--token', token])
    expect(readLedger(runPath).checkpoint_hold).toBe('plan')
    const r = surface.run(['checkpoint', '--phase', 'plan', '--verdict', 'APPROVE', '--verified-by', 'test', '--token', token])
    expect(r.status, r.stderr).toBe(0)
    expect(readLedger(runPath).checkpoint_hold).toBeUndefined()
  })

  it('checkpoint REJECT does not release checkpoint_hold', () => {
    surface.run(['hold', '--phase', 'plan', '--token', token])
    surface.run(['checkpoint', '--phase', 'plan', '--verdict', 'REJECT', '--verified-by', 'test', '--token', token])
    expect(readLedger(runPath).checkpoint_hold).toBe('plan')
  })

  it('checkpoint APPROVE for a different phase does not release the hold', () => {
    surface.run(['hold', '--phase', 'plan', '--token', token])
    surface.run(['checkpoint', '--phase', 'design', '--verdict', 'APPROVE', '--verified-by', 'test', '--token', token])
    expect(readLedger(runPath).checkpoint_hold).toBe('plan')
  })
}

describe('hooks/ledger.mjs surface', () => runSuiteOn(hooksSurface))
describe('src/gw/cli/main.ts surface', () => runSuiteOn(tsSurface))

describe('parity bite proof', () => {
  it('a perturbed hooks surface that omits the checkpoint_hold write fails the set assertion', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gw-hold-bite-'))
    const perturbedPath = join(tmpDir, 'ledger-perturbed.mjs')
    const src = readFileSync(LEDGER_MJS, 'utf8').replace(
      'l.checkpoint_hold = flags.phase',
      '/* perturbed */',
    )
    writeFileSync(perturbedPath, src)

    const projectDir = mkdtempSync(join(tmpdir(), 'gw-hold-bite-proj-'))
    mkdirSync(join(projectDir, '.groundwork', 'runs'), { recursive: true })
    const token = initLedger(projectDir)
    const runPath = join(projectDir, '.groundwork', 'runs', `${SESSION_ID}.json`)

    nodeRun(perturbedPath, projectDir, ['hold', '--phase', 'plan', '--token', token])
    const ledger = readLedger(runPath)

    expect(ledger.checkpoint_hold).not.toBe('plan')

    rmSync(tmpDir, { recursive: true, force: true })
    rmSync(projectDir, { recursive: true, force: true })
  })
})

describe('CLAUDE.md documents the shipped command verbatim-runnable', () => {
  it('documented hold command is executable against a real ledger', () => {
    const claudeMd = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
    expect(claudeMd).toContain('gw ledger hold --motive <slug> --phase <phase> --token <write_token>')

    const projectDir = mkdtempSync(join(tmpdir(), 'gw-hold-doc-'))
    mkdirSync(join(projectDir, '.groundwork', 'runs'), { recursive: true })
    const token = initLedger(projectDir)
    const runPath = join(projectDir, '.groundwork', 'runs', `${SESSION_ID}.json`)

    const r = nodeRun(LEDGER_MJS, projectDir, ['hold', '--phase', 'plan', '--token', token])
    expect(r.status, r.stderr).toBe(0)
    expect(readLedger(runPath).checkpoint_hold).toBe('plan')

    rmSync(projectDir, { recursive: true, force: true })
  })
})
