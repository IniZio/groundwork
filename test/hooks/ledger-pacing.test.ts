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
// @verifies PACING-R-006

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Pacing } from '../../hooks/lib/pacing.d.mts'

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
  pacing: { policy: 'wave', budget: 1, exempt_kinds: ['plan', 'diagnose', 'design', 'fog'] } as Pacing,
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
    const w1a = l.slices.find((s: any) => s.id === 'W1a')
    if (w1a) w1a.status = 'in_progress'
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
    const r = run(['autopilot', '--range', '3', '--token', 'tok-paced', '--reason', 'operator authorized'])
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
    const r = run(['autopilot', '--range', '1', '--token', 'tok-legacy', '--reason', 'test'])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('no pacing field')
  })

  it('singular "unit" label for range=1', () => {
    writeLedger(exhaustedLedger())
    const r = run(['autopilot', '--range', '1', '--token', 'tok-paced', '--reason', 'operator authorized'])
    expect(r.stdout).toContain('+1 unit')
    expect(r.stdout).not.toContain('+1 units')
  })

  // PACING-R-006(a): --reason is required and must be non-empty
  it('exits 1 when --reason flag is missing', () => {
    writeLedger(exhaustedLedger())
    const r = run(['autopilot', '--range', '2', '--token', 'tok-paced'])
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/reason/i)
  })

  it('exits 1 when --reason is empty string', () => {
    writeLedger(exhaustedLedger())
    const r = run(['autopilot', '--range', '2', '--token', 'tok-paced', '--reason', ''])
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/reason/i)
  })

  it('exits 1 when --reason is whitespace only', () => {
    writeLedger(exhaustedLedger())
    const r = run(['autopilot', '--range', '2', '--token', 'tok-paced', '--reason', '   '])
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/reason/i)
  })

  // F15 regression — additive grant semantics
  // Sequence: grant +2, consume 2 units, grant +1 → one more unit must be available.
  // Prior bug: second autopilot REPLACED the grant, instantly re-exhausting the budget.
  it('F15: second autopilot adds to remaining allowance, not replaces it', () => {
    // Build a ledger: budget=1, wave 0 complete (1 unit consumed), grant.range=2 already set.
    // cap = 1 + 2 = 3. We then consume 2 more waves (1 and 2) to exhaust the grant.
    // resolvedUnits for policy=wave counts waves where ALL non-exempt slices are complete.
    const l = exhaustedLedger()
    // exhaustedLedger: W0(wave0,complete), W1a(wave1,pending), W1b(wave1,pending), PLAN(exempt)
    // Fully complete wave 1 by marking both W1a and W1b complete.
    const w1a = l.slices.find((s: any) => s.id === 'W1a')
    if (!w1a) throw new Error('fixture slice W1a not found')
    w1a.status = 'complete'
    const w1b = l.slices.find((s: any) => s.id === 'W1b')
    if (!w1b) throw new Error('fixture slice W1b not found')
    w1b.status = 'complete'
    // Add a fully-complete wave 2.
    l.slices.push({ id: 'W2a', wave: 2, status: 'complete', desc: 'wave 2' })
    // Set grant.range=2 (was granted earlier).
    l.pacing.grant = { range: 2, granted_at: new Date().toISOString(), granted_by: 'test', reason: 'initial grant' }
    // Now: resolvedUnits = 3 (waves 0,1,2 all fully complete), cap = 1+2 = 3 → exhausted.
    // Add a pending wave-3 slice as the next work item.
    l.slices.push({ id: 'W3a', wave: 3, status: 'pending', desc: 'wave 3 slice' })
    writeLedger(l)

    // Confirm exhausted before grant
    const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: 'sess-paced' }
    const blockedR = spawnSync('node', [CLI, 'claim', 'W3a'], { env, encoding: 'utf8' })
    expect(blockedR.status).toBe(1)

    // Grant +1 more via autopilot (additive → grant.range becomes 3, cap becomes 4)
    const grantR = run(['autopilot', '--range', '1', '--token', 'tok-paced', '--reason', 'extend by 1'])
    expect(grantR.code).toBe(0)

    // Verify grant.range accumulated (was 2, +1 → should be 3)
    const afterGrant = readLedger()
    expect(afterGrant.pacing.grant.range).toBe(3)

    // Wave 3 should now be claimable (cap=4, consumed=3 → 1 unit remains)
    const claimR = spawnSync('node', [CLI, 'claim', 'W3a'], { env, encoding: 'utf8' })
    expect(claimR.status).toBe(0)
  })

  it('F15: stdout message reflects the incremental range granted, not accumulated total', () => {
    // Grant +2 first
    writeLedger(exhaustedLedger())
    run(['autopilot', '--range', '2', '--token', 'tok-paced', '--reason', 'first grant'])
    // Grant +1 more — message should say +1, not +3
    const r = run(['autopilot', '--range', '1', '--token', 'tok-paced', '--reason', 'second grant'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('+1 unit')
  })
})

// ---------------------------------------------------------------------------
// PACING-R-006(b): block message routes through operator, not self-grant
// ---------------------------------------------------------------------------

describe('ledger claim — block message routes through operator (PACING-R-006b)', () => {
  it('block message instructs agent to ask the operator, not self-grant', () => {
    writeLedger(exhaustedLedger())
    const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: 'sess-paced' }
    const r = spawnSync('node', [CLI, 'claim', 'W1a'], { env, encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/ask the operator/i)
  })

  it('block message does not instruct agent to run autopilot directly', () => {
    writeLedger(exhaustedLedger())
    const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: 'sess-paced' }
    const r = spawnSync('node', [CLI, 'claim', 'W1a'], { env, encoding: 'utf8' })
    // The message should reference autopilot as something the operator runs, not the agent
    // It must NOT say "run `ledger autopilot`" as a direct agent instruction in Option A
    expect(r.stderr).not.toMatch(/Option A.*run `ledger autopilot/i)
  })

  it('set --status in_progress block message also routes through operator', () => {
    writeLedger(exhaustedLedger())
    const r = run(['set', 'W1a', '--status', 'in_progress'])
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/ask the operator/i)
  })
})

// ---------------------------------------------------------------------------
// F14 regression — ledger init from a prior-session seed
// ---------------------------------------------------------------------------

describe('ledger init — F14: prior-session seed does not consume this session budget', () => {
  /** Simulate what `cat old-session.json | ledger init -` produces when seeding from a
   *  prior session that had already completed wave 0. */
  const priorSessionSeed = () => ({
    version: 1,
    active: true,
    session_id: 'old-session-id',
    brief: 'prior session work',
    pacing: { policy: 'wave', budget: 1, exempt_kinds: ['plan', 'diagnose', 'design', 'fog'] },
    slices: [
      { id: 'W0', wave: 0, status: 'complete', desc: 'wave 0 done in prior session' },
      { id: 'W1a', wave: 1, status: 'pending', desc: 'wave 1 slice a' },
      { id: 'W1b', wave: 1, status: 'pending', desc: 'wave 1 slice b' },
    ],
    gate: {},
  })

  function runWithSession(sessionId: string, args: string[]) {
    const r = spawnSync('node', [CLI, ...args], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: sessionId },
      encoding: 'utf8',
    })
    return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }

  it('restamps session_id in the body to the current session, not the seed session', () => {
    const seed = priorSessionSeed()
    const seedFile = path.join(projectDir, 'seed.json')
    writeFileSync(seedFile, JSON.stringify(seed))

    const r = runWithSession('new-session-id', ['init', seedFile])
    expect(r.code).toBe(0)

    const ledgerPath = path.join(projectDir, '.groundwork', 'runs', 'new-session-id.json')
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
    expect(ledger.session_id).toBe('new-session-id')
    expect(ledger.session_id).not.toBe('old-session-id')
  })

  it('stores pacing.offset equal to the number of resolved units in the seed', () => {
    const seed = priorSessionSeed()
    const seedFile = path.join(projectDir, 'seed.json')
    writeFileSync(seedFile, JSON.stringify(seed))

    runWithSession('new-session-id', ['init', seedFile])

    const ledgerPath = path.join(projectDir, '.groundwork', 'runs', 'new-session-id.json')
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
    // wave 0 was fully complete in the seed → offset should be 1
    expect(ledger.pacing.offset).toBe(1)
  })

  it('claiming a wave-1 slice does NOT trip pacing after init from a seed with completed wave 0', () => {
    const seed = priorSessionSeed()
    const seedFile = path.join(projectDir, 'seed.json')
    writeFileSync(seedFile, JSON.stringify(seed))

    const initR = runWithSession('new-session-id', ['init', seedFile])
    expect(initR.code).toBe(0)

    // claim W1a in the new session — this would open wave 1, but since wave 0
    // was completed by the OLD session, it must not count against the new budget
    const claimR = runWithSession('new-session-id', ['claim', 'W1a'])
    expect(claimR.code).toBe(0)
    expect(claimR.stderr).not.toMatch(/Pacing budget exhausted/i)
  })

  it('pacing still blocks a second new wave after the first is opened in the new session', () => {
    // Seed with wave 0 complete (prior session), wave 1 pending (to be worked now),
    // wave 2 pending (should be blocked after wave 1 is opened).
    const seed = {
      ...priorSessionSeed(),
      slices: [
        { id: 'W0', wave: 0, status: 'complete', desc: 'prior complete' },
        { id: 'W1a', wave: 1, status: 'pending', desc: 'new wave a' },
        { id: 'W2a', wave: 2, status: 'pending', desc: 'would be too far' },
      ],
    }
    const seedFile = path.join(projectDir, 'seed.json')
    writeFileSync(seedFile, JSON.stringify(seed))

    runWithSession('new-session-id', ['init', seedFile])

    // Claim W1a — opens wave 1 (the only new unit this session is allowed)
    const claimW1 = runWithSession('new-session-id', ['claim', 'W1a'])
    expect(claimW1.code).toBe(0)

    // Complete W1a so wave 1 is resolved (now 1 unit consumed this session)
    const ledgerPath = path.join(projectDir, '.groundwork', 'runs', 'new-session-id.json')
    const tok = JSON.parse(readFileSync(ledgerPath, 'utf8')).write_token
    runWithSession('new-session-id', ['complete', 'W1a', '--token', tok])

    // Claiming W2a would open wave 2 — budget exhausted, must be blocked
    const claimW2 = runWithSession('new-session-id', ['claim', 'W2a'])
    expect(claimW2.code).toBe(1)
    expect(claimW2.stderr).toMatch(/Pacing budget exhausted/i)
  })
})

// ---------------------------------------------------------------------------
// ledger help abandon — documents --session flag
// ---------------------------------------------------------------------------

describe('ledger help abandon', () => {
  it('documents --session <id> in the help output', () => {
    const r = run(['help', 'abandon'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('--session')
  })
})

// ---------------------------------------------------------------------------
// ledger abandon --session <id> — behavior pin
// Pins existing behavior: main() resolves _ledgerPath from --session before
// dispatch, so abandon already targets the right per-session file.
// ---------------------------------------------------------------------------

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

    // Run without CLAUDE_CODE_SESSION_ID — relies on --session flag via main() dispatch path
    const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir }
    delete env.CLAUDE_CODE_SESSION_ID
    const r = spawnSync('node', [CLI, 'abandon', '--session', sessionId], { env, encoding: 'utf8' })
    expect(r.status).toBe(0)
    const updated = JSON.parse(readFileSync(runFile, 'utf8'))
    expect(updated.active).toBe(false)
  })
})
