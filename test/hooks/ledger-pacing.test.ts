/**
 * Ledger CLI — pacing integration tests (D-28 / slice pace-cli).
 *
 * Verifies that:
 *   - ledger init stamps pacing defaults on new runs
 *   - ledger claim and set --status in_progress enforce the budget
 *   - ledger complete is never blocked
 *   - ledger add is never blocked
 *   - absent pacing field means no enforcement
 *   - ledger autopilot writes a grant and emits a MILESTONE event
 */

// @verifies PACING-R-003
// @verifies PACING-R-004

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const CLI = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'ledger.mjs')

let projectDir: string
let ledgerFile: string

function readLedger(): any {
  return JSON.parse(readFileSync(ledgerFile, 'utf8'))
}

function writeLedger(obj: any) {
  writeFileSync(ledgerFile, JSON.stringify(obj, null, 2))
}

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir }
  delete env.CLAUDE_CODE_SESSION_ID
  const r = spawnSync('node', [CLI, ...args], { env, encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Ledger without pacing — represents a pre-D-28 (legacy) run. */
const legacyLedger = () => ({
  version: 1,
  active: true,
  session_id: 'sess-legacy',
  brief: 'legacy run (no pacing)',
  write_token: 'tok-legacy',
  slices: [
    { id: 'A', wave: 0, status: 'pending', desc: 'slice A' },
    { id: 'B', wave: 1, status: 'pending', desc: 'slice B' },
  ],
  gate: {},
})

/**
 * Paced ledger where budget=1 is already consumed (wave 0 resolved).
 * Wave 0 has one complete slice; wave 1 has pending slices → would open a new unit.
 */
const exhaustedLedger = () => ({
  version: 1,
  active: true,
  session_id: 'sess-paced',
  brief: 'paced run',
  write_token: 'tok-paced',
  pacing: { policy: 'wave', budget: 1, exempt_kinds: ['plan', 'diagnose', 'design', 'fog'] },
  slices: [
    { id: 'W0', wave: 0, status: 'complete', desc: 'wave 0 slice' },
    { id: 'W1a', wave: 1, status: 'pending', desc: 'wave 1 slice a' },
    { id: 'W1b', wave: 1, status: 'pending', desc: 'wave 1 slice b' },
    { id: 'PLAN', wave: 2, kind: 'plan', status: 'pending', desc: 'exempt plan slice' },
  ],
  gate: {},
})

/**
 * Paced ledger that still has budget remaining (nothing resolved yet).
 */
const freshPacedLedger = () => ({
  version: 1,
  active: true,
  session_id: 'sess-fresh',
  brief: 'fresh paced run',
  write_token: 'tok-fresh',
  pacing: { policy: 'wave', budget: 1, exempt_kinds: ['plan', 'diagnose', 'design', 'fog'] },
  slices: [
    { id: 'W0', wave: 0, status: 'pending', desc: 'wave 0 slice' },
  ],
  gate: {},
})

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), 'gw-pacing-'))
  mkdirSync(path.join(projectDir, '.groundwork'), { recursive: true })
  ledgerFile = path.join(projectDir, '.groundwork', 'run.json')
})

afterEach(() => rmSync(projectDir, { recursive: true, force: true }))

// ---------------------------------------------------------------------------
// ledger init — pacing defaults
// ---------------------------------------------------------------------------

describe('ledger init — pacing defaults', () => {
  it('stamps pacing defaults when input has no pacing field', () => {
    const input = {
      version: 1,
      active: true,
      session_id: 'sess-new',
      brief: 'new run',
      slices: [],
      gate: {},
    }
    const inputFile = path.join(projectDir, 'input.json')
    writeFileSync(inputFile, JSON.stringify(input))
    const r = run(['init', inputFile])
    expect(r.code).toBe(0)
    const ledger = readLedger()
    expect(ledger.pacing).toMatchObject({
      policy: 'wave',
      budget: 1,
      exempt_kinds: expect.arrayContaining(['plan', 'diagnose', 'design', 'fog']),
    })
  })

  it('preserves existing pacing field when input already has one', () => {
    const input = {
      version: 1,
      active: true,
      session_id: 'sess-custom',
      brief: 'custom pacing',
      pacing: { policy: 'slice', budget: 5, exempt_kinds: [] },
      slices: [],
      gate: {},
    }
    const inputFile = path.join(projectDir, 'input.json')
    writeFileSync(inputFile, JSON.stringify(input))
    const r = run(['init', inputFile])
    expect(r.code).toBe(0)
    const ledger = readLedger()
    expect(ledger.pacing.policy).toBe('slice')
    expect(ledger.pacing.budget).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// ledger claim — pacing enforcement
// ---------------------------------------------------------------------------

describe('ledger claim — pacing enforcement', () => {
  it('allows claim when budget is not exhausted', () => {
    writeLedger(freshPacedLedger())
    const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: 'sess-fresh' }
    const r = spawnSync('node', [CLI, 'claim', 'W0'], { env, encoding: 'utf8' })
    expect(r.status).toBe(0)
  })

  it('blocks claim when budget is exhausted (exit 1)', () => {
    writeLedger(exhaustedLedger())
    const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: 'sess-paced' }
    const r = spawnSync('node', [CLI, 'claim', 'W1a'], { env, encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/Pacing budget exhausted/i)
    expect(r.stderr).toMatch(/autopilot/i)
  })

  it('prints remedy text on pacing block', () => {
    writeLedger(exhaustedLedger())
    const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: 'sess-paced' }
    const r = spawnSync('node', [CLI, 'claim', 'W1a'], { env, encoding: 'utf8' })
    expect(r.stderr).toContain('ledger autopilot --range N')
  })

  it('does not modify ledger when pacing blocks the claim', () => {
    const original = exhaustedLedger()
    writeLedger(original)
    const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: 'sess-paced' }
    spawnSync('node', [CLI, 'claim', 'W1a'], { env, encoding: 'utf8' })
    const after = readLedger()
    const w1a = after.slices.find((s: any) => s.id === 'W1a')
    expect(w1a.claimed_by).toBeUndefined()
  })

  it('allows claim of exempt (plan) slices even when budget is exhausted', () => {
    writeLedger(exhaustedLedger())
    const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: 'sess-paced' }
    const r = spawnSync('node', [CLI, 'claim', 'PLAN'], { env, encoding: 'utf8' })
    expect(r.status).toBe(0)
  })

  it('no enforcement when pacing field is absent (legacy ledger)', () => {
    writeLedger(legacyLedger())
    const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: 'sess-legacy' }
    const r = spawnSync('node', [CLI, 'claim', 'B'], { env, encoding: 'utf8' })
    expect(r.status).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// ledger set --status in_progress — pacing enforcement
// ---------------------------------------------------------------------------

describe('ledger set --status in_progress — pacing enforcement', () => {
  it('blocks in_progress transition when budget is exhausted (exit 1)', () => {
    writeLedger(exhaustedLedger())
    const r = run(['set', 'W1a', '--status', 'in_progress'])
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/Pacing budget exhausted/i)
    expect(r.stderr).toMatch(/autopilot/i)
  })

  it('prints remedy text on pacing block', () => {
    writeLedger(exhaustedLedger())
    const r = run(['set', 'W1a', '--status', 'in_progress'])
    expect(r.stderr).toContain('ledger autopilot --range N')
  })

  it('does not modify ledger when pacing blocks set', () => {
    writeLedger(exhaustedLedger())
    run(['set', 'W1a', '--status', 'in_progress'])
    const after = readLedger()
    const w1a = after.slices.find((s: any) => s.id === 'W1a')
    expect(w1a.status).toBe('pending')
  })

  it('allows in_progress when budget is not exhausted', () => {
    writeLedger(freshPacedLedger())
    const r = run(['set', 'W0', '--status', 'in_progress'])
    expect(r.code).toBe(0)
    expect(readLedger().slices.find((s: any) => s.id === 'W0').status).toBe('in_progress')
  })

  it('no enforcement when pacing field is absent (legacy ledger)', () => {
    writeLedger(legacyLedger())
    const r = run(['set', 'B', '--status', 'in_progress'])
    expect(r.code).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// ledger complete — never blocked
// ---------------------------------------------------------------------------

describe('ledger complete — never blocked by pacing', () => {
  it('completes a slice even when budget is exhausted', () => {
    const l = exhaustedLedger()
    // Manually put W1a in_progress so complete is meaningful
    l.slices.find((s: any) => s.id === 'W1a').status = 'in_progress'
    writeLedger(l)
    const r = run(['complete', 'W1a', '--token', 'tok-paced'])
    expect(r.code).toBe(0)
    expect(readLedger().slices.find((s: any) => s.id === 'W1a').status).toBe('complete')
  })
})

// ---------------------------------------------------------------------------
// ledger add — never blocked
// ---------------------------------------------------------------------------

describe('ledger add — never blocked by pacing', () => {
  it('adds a new slice even when budget is exhausted', () => {
    writeLedger(exhaustedLedger())
    const r = run(['add', 'NEW', '--wave', '3', '--desc', 'new slice'])
    expect(r.code).toBe(0)
    expect(readLedger().slices.find((s: any) => s.id === 'NEW')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// ledger autopilot
// ---------------------------------------------------------------------------

describe('ledger autopilot', () => {
  it('writes pacing.grant with correct fields', () => {
    writeLedger(exhaustedLedger())
    const r = run(['autopilot', '--range', '2', '--token', 'tok-paced', '--reason', 'need more waves'])
    expect(r.code).toBe(0)
    const ledger = readLedger()
    expect(ledger.pacing.grant).toMatchObject({
      range: 2,
      reason: 'need more waves',
    })
    expect(typeof ledger.pacing.grant.granted_at).toBe('string')
    expect(typeof ledger.pacing.grant.granted_by).toBe('string')
  })

  it('prints confirmation message', () => {
    writeLedger(exhaustedLedger())
    const r = run(['autopilot', '--range', '3', '--token', 'tok-paced'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('autopilot granted: +3 units')
  })

  it('allows claims after autopilot extends the budget', () => {
    writeLedger(exhaustedLedger())
    // Grant +1 unit extension
    run(['autopilot', '--range', '1', '--token', 'tok-paced', '--reason', 'extend'])
    // Now claim a wave-1 slice — should be allowed
    const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: 'sess-paced' }
    const r = spawnSync('node', [CLI, 'claim', 'W1a'], { env, encoding: 'utf8' })
    expect(r.status).toBe(0)
  })

  it('requires --range flag (exit 2 on missing)', () => {
    writeLedger(exhaustedLedger())
    const r = run(['autopilot', '--token', 'tok-paced'])
    expect(r.code).toBe(2)
  })

  it('requires write-token authority', () => {
    writeLedger(exhaustedLedger())
    const r = run(['autopilot', '--range', '1', '--token', 'wrong-token'])
    expect(r.code).toBe(1)
  })

  it('exits 1 when ledger has no pacing field', () => {
    writeLedger(legacyLedger())
    const r = run(['autopilot', '--range', '1', '--token', 'tok-legacy'])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('no pacing field')
  })

  it('singular "unit" label for range=1', () => {
    writeLedger(exhaustedLedger())
    const r = run(['autopilot', '--range', '1', '--token', 'tok-paced'])
    expect(r.stdout).toContain('+1 unit')
    expect(r.stdout).not.toContain('+1 units')
  })
})
