/**
 * T24: parity test for `ledger milestone-signoff`.
 *
 * Both CLI surfaces (hooks/ledger.mjs via node, src/gw/cli/main.ts via bun) MUST
 * write the same pacing.milestone_signoff shape for identical input:
 *   { verdict, verified_by, verified_at, artifacts_verified }
 *
 * That shape is what gate-seal.mjs folds (lines 95-103) and what the checkpoint
 * migration reads (ledger.ts ~1059) to populate gate.phases.completion.
 *
 * Bite proof: a /tmp copy of hooks/ledger.mjs is perturbed to omit the
 * milestone_signoff write. The shape assertion then fails on the perturbed copy.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = new URL('../', import.meta.url).pathname
const LEDGER_MJS = join(ROOT, 'hooks', 'ledger.mjs')
const GW_MAIN = join(ROOT, 'src', 'gw', 'cli', 'main.ts')
const MOTIVE = 'testmotive'
const SESSION_ID = 'test'

function makeEnv(projectDir: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    CLAUDE_PROJECT_DIR: projectDir,
    CLAUDE_CODE_SESSION_ID: SESSION_ID,
  }
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

function initLedger(projectDir: string): string {
  const seed = JSON.stringify({ version: 1, active: true, slices: [], gate: {} })
  const r = spawnSync('node', [LEDGER_MJS, 'init', '-', '--motive', MOTIVE], {
    env: makeEnv(projectDir),
    encoding: 'utf8',
    input: seed,
  })
  if ((r.status ?? 1) !== 0) throw new Error(`ledger init failed: ${r.stderr}`)
  const m = r.stdout.match(/write_token:\s+(\S+)/)
  if (!m) throw new Error(`write_token missing: ${r.stdout}`)
  return m[1]
}

function readLedger(runPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(runPath, 'utf8')) as Record<string, unknown>
}

function runSuiteOn(getSurface: (dir: string) => Surface) {
  let projectDir: string
  let runPath: string
  let token: string
  let surface: Surface

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'gw-ms-parity-'))
    mkdirSync(join(projectDir, '.groundwork', 'runs'), { recursive: true })
    runPath = join(projectDir, '.groundwork', 'runs', `${SESSION_ID}.json`)
    token = initLedger(projectDir)
    surface = getSurface(projectDir)
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  it('milestone-signoff writes pacing.milestone_signoff with required fields', () => {
    const r = surface.run(['milestone-signoff', '--verdict', 'APPROVE', '--verified-by', 'tester', '--token', token])
    expect(r.status, r.stderr).toBe(0)
    const ledger = readLedger(runPath)
    const pacing = ledger['pacing'] as Record<string, unknown> | undefined
    const ms = pacing?.['milestone_signoff'] as Record<string, unknown> | undefined
    expect(ms).toBeDefined()
    expect(ms!['verdict']).toBe('APPROVE')
    expect(ms!['verified_by']).toBe('tester')
    expect(typeof ms!['verified_at']).toBe('string')
    expect(Array.isArray(ms!['artifacts_verified'])).toBe(true)
  })

  it('milestone-signoff with REJECT writes REJECT verdict', () => {
    const r = surface.run(['milestone-signoff', '--verdict', 'REJECT', '--verified-by', 'tester', '--token', token])
    expect(r.status, r.stderr).toBe(0)
    const ms = (readLedger(runPath)['pacing'] as Record<string, unknown>)['milestone_signoff'] as Record<string, unknown>
    expect(ms['verdict']).toBe('REJECT')
  })

  it('milestone-signoff succeeds on a ledger with no pacing key', () => {
    expect(readLedger(runPath)['pacing']).toBeUndefined()
    const r = surface.run(['milestone-signoff', '--verdict', 'APPROVE', '--verified-by', 'tester', '--token', token])
    expect(r.status, r.stderr).toBe(0)
    const ms = ((readLedger(runPath)['pacing'] as Record<string, unknown>) ?? {})['milestone_signoff'] as Record<string, unknown>
    expect(ms['verdict']).toBe('APPROVE')
  })

  it('a gw-recorded signoff migrates into gate.phases.completion on checkpoint', () => {
    surface.run(['milestone-signoff', '--verdict', 'APPROVE', '--verified-by', 'tester', '--token', token])
    const r = surface.run(['checkpoint', '--phase', 'wave-1', '--verdict', 'APPROVE', '--verified-by', 'tester', '--token', token])
    expect(r.status, r.stderr).toBe(0)
    const ledger = readLedger(runPath)
    const phases = ((ledger['gate'] as Record<string, unknown>)['phases'] ?? {}) as Record<string, unknown>
    const completion = phases['completion'] as Record<string, unknown> | undefined
    expect(completion).toBeDefined()
    expect(completion!['verdict']).toBe('APPROVE')
    expect(completion!['verified_by']).toBe('tester')
  })
}

describe('hooks/ledger.mjs surface', () => runSuiteOn(hooksSurface))
describe('src/gw/cli/main.ts surface', () => runSuiteOn(tsSurface))

describe('cross-surface parity', () => {
  it('both surfaces produce the same pacing.milestone_signoff keys for identical input', () => {
    const shape = (getSurface: (dir: string) => Surface): Record<string, unknown> => {
      const pd = mkdtempSync(join(tmpdir(), 'gw-ms-xparity-'))
      try {
        mkdirSync(join(pd, '.groundwork', 'runs'), { recursive: true })
        const tok = initLedger(pd)
        const s = getSurface(pd)
        s.run(['milestone-signoff', '--verdict', 'APPROVE', '--verified-by', 'tester', '--token', tok])
        const rp = join(pd, '.groundwork', 'runs', `${SESSION_ID}.json`)
        const pacing = (readLedger(rp)['pacing'] ?? {}) as Record<string, unknown>
        return pacing['milestone_signoff'] as Record<string, unknown>
      } finally {
        rmSync(pd, { recursive: true, force: true })
      }
    }

    const mjs = shape(hooksSurface)
    const ts = shape(tsSurface)

    expect(Object.keys(mjs).sort()).toEqual(Object.keys(ts).sort())
    expect(mjs['verdict']).toBe(ts['verdict'])
    expect(mjs['verified_by']).toBe(ts['verified_by'])
    expect(Array.isArray(ts['artifacts_verified'])).toBe(true)
    expect(Array.isArray(mjs['artifacts_verified'])).toBe(true)
  })
})

function captureShape(run: (pd: string, tok: string) => void): Record<string, unknown> {
  const pd = mkdtempSync(join(tmpdir(), 'gw-ms-shape-'))
  mkdirSync(join(pd, '.groundwork', 'runs'), { recursive: true })
  const tok = initLedger(pd)
  run(pd, tok)
  const rp = join(pd, '.groundwork', 'runs', `${SESSION_ID}.json`)
  const pacing = (readLedger(rp)['pacing'] ?? {}) as Record<string, unknown>
  const ms = (pacing['milestone_signoff'] ?? {}) as Record<string, unknown>
  rmSync(pd, { recursive: true, force: true })
  return ms
}

describe('parity bite proof', () => {
  it('.mjs broken: cross-surface key comparison fails (proves the parity check is sensitive)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gw-ms-bite-'))
    const perturbedPath = join(tmpDir, 'ledger-perturbed.mjs')
    const src = readFileSync(LEDGER_MJS, 'utf8')
    const perturbed = src.replace(
      'l.pacing.milestone_signoff = {',
      '/* perturbed */ if (false) l.pacing.milestone_signoff = {',
    )
    expect(perturbed).not.toBe(src)
    writeFileSync(perturbedPath, perturbed, 'utf8')

    const brokenMjsShape = captureShape((pd, tok) =>
      nodeRun(perturbedPath, pd, ['milestone-signoff', '--verdict', 'APPROVE', '--verified-by', 'tester', '--token', tok])
    )
    const realTsShape = captureShape((pd, tok) =>
      bunRun(pd, ['milestone-signoff', '--verdict', 'APPROVE', '--verified-by', 'tester', '--token', tok])
    )

    expect(Object.keys(brokenMjsShape).sort()).not.toEqual(Object.keys(realTsShape).sort())

    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('.mjs broken: same comparison passes with real surfaces (proves green case is not vacuous)', () => {
    const realMjsShape = captureShape((pd, tok) =>
      nodeRun(LEDGER_MJS, pd, ['milestone-signoff', '--verdict', 'APPROVE', '--verified-by', 'tester', '--token', tok])
    )
    const realTsShape = captureShape((pd, tok) =>
      bunRun(pd, ['milestone-signoff', '--verdict', 'APPROVE', '--verified-by', 'tester', '--token', tok])
    )

    expect(Object.keys(realMjsShape).sort()).toEqual(Object.keys(realTsShape).sort())
  })
})
