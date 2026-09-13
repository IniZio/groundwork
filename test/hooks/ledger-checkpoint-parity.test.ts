/**
 * test/hooks/ledger-checkpoint-parity.test.ts
 *
 * Parity tests for `checkpoint` and `autopilot` retirement across both CLI
 * surfaces. describe.each ensures a change to only one surface fails only
 * that surface's block.
 *
 * Set LEDGER_MJS_OVERRIDE=/path/to/perturbed.mjs to redirect the MJS surface
 * to a modified copy for bite-proof verification.
 */

// @verifies AC-5
// @verifies AC-6
// @verifies AC-13
// @verifies AC-14

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run as runTs } from '../../src/gw/cli/commands/ledger.js'

const MJS_CLI = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'ledger.mjs')
const SESSION_ID = 'test-sess-001'
const MOTIVE = 'test-motive'
const WRITE_TOKEN = 'tok-test'

type RunResult = { code: number; out: string }

type SurfaceDef = {
  name: string
  invoke: (args: string[], projectDir: string) => Promise<RunResult>
}

const mjsSurface: SurfaceDef = {
  name: 'MJS (hooks/ledger.mjs)',
  invoke: async (args, projectDir) => {
    const cli = process.env['LEDGER_MJS_OVERRIDE'] ?? MJS_CLI
    const r = spawnSync('node', [cli, ...args], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: SESSION_ID },
      encoding: 'utf8',
    })
    return { code: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') }
  },
}

const tsSurface: SurfaceDef = {
  name: 'TS (src/gw/cli/commands/ledger.ts)',
  invoke: async (args, projectDir) => {
    const savedProject = process.env['CLAUDE_PROJECT_DIR']
    const savedSession = process.env['CLAUDE_CODE_SESSION_ID']
    process.env['CLAUDE_PROJECT_DIR'] = projectDir
    process.env['CLAUDE_CODE_SESSION_ID'] = SESSION_ID
    try {
      const env = await runTs(args, projectDir)
      const code = env.exit
      const out = env.ok
        ? String((env.data as Record<string, unknown>)?.['content'] ?? '')
        : env.error.message
      return { code, out }
    } finally {
      if (savedProject === undefined) delete process.env['CLAUDE_PROJECT_DIR']
      else process.env['CLAUDE_PROJECT_DIR'] = savedProject
      if (savedSession === undefined) delete process.env['CLAUDE_CODE_SESSION_ID']
      else process.env['CLAUDE_CODE_SESSION_ID'] = savedSession
    }
  },
}

function mkProjectDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gw-checkpoint-parity-'))
  mkdirSync(path.join(dir, '.groundwork', 'runs'), { recursive: true })
  return dir
}

function ledgerPath(projectDir: string): string {
  return path.join(projectDir, '.groundwork', 'runs', `${SESSION_ID}.json`)
}

function writeLedger(projectDir: string, data: object): void {
  writeFileSync(ledgerPath(projectDir), JSON.stringify(data, null, 2))
}

function readLedger(projectDir: string): any {
  return JSON.parse(readFileSync(ledgerPath(projectDir), 'utf8'))
}

const baseLedger = () => ({
  version: 1,
  active: true,
  session_id: SESSION_ID,
  motive: MOTIVE,
  write_token: WRITE_TOKEN,
  slices: [],
  gate: {},
})

const ledgerWithMilestoneSignoff = () => ({
  version: 1,
  active: true,
  session_id: SESSION_ID,
  motive: MOTIVE,
  write_token: WRITE_TOKEN,
  slices: [],
  pacing: {
    milestone_signoff: {
      verdict: 'APPROVE',
      verified_by: 'Carol',
      verified_at: '2026-01-01T00:00:00.000Z',
    },
  },
  gate: {},
})

// ---------------------------------------------------------------------------

describe.each([mjsSurface, tsSurface])('$name', (surface) => {
  let projectDir: string

  beforeEach(() => { projectDir = mkProjectDir() })
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }) })

  it('checkpoint happy path: exit 0, prints confirmation, writes gate.phases.plan', async () => {
    writeLedger(projectDir, baseLedger())
    const r = await surface.invoke(
      ['checkpoint', '--motive', MOTIVE, '--phase', 'plan', '--verdict', 'APPROVE', '--verified-by', 'Alice', '--token', WRITE_TOKEN],
      projectDir,
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain('checkpoint: plan APPROVE by Alice')
    const l = readLedger(projectDir)
    expect(l.gate?.phases?.plan?.verdict).toBe('APPROVE')
    expect(l.gate?.phases?.plan?.verified_by).toBe('Alice')
  })

  it('checkpoint plan phase: tier derives to BLOCKS', async () => {
    writeLedger(projectDir, baseLedger())
    const r = await surface.invoke(
      ['checkpoint', '--motive', MOTIVE, '--phase', 'plan', '--verdict', 'APPROVE', '--verified-by', 'Alice', '--token', WRITE_TOKEN],
      projectDir,
    )
    expect(r.code).toBe(0)
    expect(readLedger(projectDir).gate?.phases?.plan?.tier).toBe('BLOCKS')
  })

  it('checkpoint wave-1 phase: tier derives to AUTO_ADVANCES', async () => {
    writeLedger(projectDir, baseLedger())
    const r = await surface.invoke(
      ['checkpoint', '--motive', MOTIVE, '--phase', 'wave-1', '--verdict', 'APPROVE', '--verified-by', 'Bob', '--token', WRITE_TOKEN],
      projectDir,
    )
    expect(r.code).toBe(0)
    const l = readLedger(projectDir)
    expect(l.gate?.phases?.['wave-1']?.tier).toBe('AUTO_ADVANCES')
    expect(l.gate?.phases?.['wave-1']?.verified_by).toBe('Bob')
  })

  it('checkpoint without --token: non-zero exit, no gate.phases written', async () => {
    writeLedger(projectDir, baseLedger())
    const r = await surface.invoke(
      ['checkpoint', '--motive', MOTIVE, '--phase', 'plan', '--verdict', 'APPROVE', '--verified-by', 'Alice'],
      projectDir,
    )
    expect(r.code).not.toBe(0)
    expect(readLedger(projectDir).gate?.phases?.plan).toBeUndefined()
  })

  it('checkpoint without --phase: exit 2', async () => {
    writeLedger(projectDir, baseLedger())
    const r = await surface.invoke(
      ['checkpoint', '--motive', MOTIVE, '--verdict', 'APPROVE', '--verified-by', 'Alice', '--token', WRITE_TOKEN],
      projectDir,
    )
    expect(r.code).toBe(2)
  })

  it('AC-13: pacing.milestone_signoff migrates to gate.phases.completion on first checkpoint', async () => {
    writeLedger(projectDir, ledgerWithMilestoneSignoff())
    const r = await surface.invoke(
      ['checkpoint', '--motive', MOTIVE, '--phase', 'plan', '--verdict', 'APPROVE', '--verified-by', 'Alice', '--token', WRITE_TOKEN],
      projectDir,
    )
    expect(r.code).toBe(0)
    const l = readLedger(projectDir)
    expect(l.gate?.phases?.completion?.verdict).toBe('APPROVE')
    expect(l.gate?.phases?.completion?.verified_by).toBe('Carol')
    expect(l.gate?.phases?.plan?.verdict).toBe('APPROVE')
  })

  it('autopilot retired: exit 2, output names "checkpoint" as replacement', async () => {
    writeLedger(projectDir, baseLedger())
    const r = await surface.invoke(
      ['autopilot', '--motive', MOTIVE, '--range', '2', '--reason', 'test', '--token', WRITE_TOKEN],
      projectDir,
    )
    expect(r.code).toBe(2)
    expect(r.out).toContain('ledger checkpoint')
  })
})
