/**
 * milestone-signoff-authority.test.ts — S7 security tests for milestone sign-off.
 *
 * Verifies PACING-R-008: write_token is required to record a milestone sign-off.
 * A subagent that cannot present the write_token cannot record a sign-off,
 * preventing self-signing of its own work.
 *
 * RED→GREEN proof: the unauthorized-sign-off test runs WITHOUT --token and
 * must exit 1. Run:
 *   npx vitest run test/hooks/milestone-signoff-authority.test.ts
 * to see: without the guard, exit 0 (self-signing allowed); WITH the guard,
 * exit 1 (blocked).
 */

// @verifies PACING-R-008

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
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

/**
 * Run the ledger CLI with CLAUDE_PROJECT_DIR set.
 * No CLAUDE_CODE_SESSION_ID is set — resolves to legacy .groundwork/run.json path.
 */
function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir }
  delete env.CLAUDE_CODE_SESSION_ID
  const r = spawnSync('node', [CLI, ...args], { env, encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function runWithSession(args: string[], sessionId: string): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: sessionId }
  const r = spawnSync('node', [CLI, ...args], { env, encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** A minimal milestone ledger written to the legacy path (.groundwork/run.json). */
function milestoneLedger(extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    active: true,
    brief: 'milestone pacing test',
    write_token: 'tok-ms-secret',
    pacing: {
      policy: 'milestone',
      budget: 1,
      exempt_kinds: ['plan', 'diagnose', 'design', 'fog'],
      milestone_artifacts: [],
      ...extra,
    },
    slices: [
      { id: 'W0', wave: 0, kind: 'impl', status: 'complete', desc: 'wave 0 done' },
      { id: 'W1', wave: 1, kind: 'impl', status: 'pending', desc: 'wave 1 next' },
    ],
    gate: {},
  }
}

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), 'ms-signoff-test-'))
  const groundworkDir = path.join(projectDir, '.groundwork')
  mkdirSync(groundworkDir, { recursive: true })
  // Legacy path — no session ID means the CLI resolves to .groundwork/run.json
  ledgerFile = path.join(groundworkDir, 'run.json')
  writeLedger(milestoneLedger())
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// SECURITY RED→GREEN: unauthorized sign-off must exit 1
// ---------------------------------------------------------------------------

describe('PACING-R-008 — write_token authority required for milestone sign-off', () => {
  /**
   * RED→GREEN proof:
   *   WITHOUT the token authority guard in cmdMilestoneSignoff, invoking
   *   `ledger milestone-signoff` without --token would succeed (exit 0) and
   *   write the sign-off — any subagent could self-certify.
   *
   *   WITH the guard (assertWriteToken), invocation without --token exits 1
   *   with a message naming the missing authority.
   *
   * Run: npx vitest run test/hooks/milestone-signoff-authority.test.ts
   * Paste the output to prove this test is RED before the guard and GREEN after.
   */
  it('[RED→GREEN] unauthorized sign-off (no --token) exits 1', () => {
    const result = run([
      'milestone-signoff',
      '--verdict', 'APPROVE',
      '--verified-by', 'malicious-subagent',
      // NO --token supplied — simulates a subagent that does not have write_token
    ])
    // SECURITY: must not succeed
    expect(result.code, 'must exit 1 when write_token is absent').toBe(1)
    expect(result.stderr, 'error message must cite missing authority').toMatch(
      /orchestrator-only|write_token|gate\/complete\/abandon/i,
    )
  })

  it('wrong token exits 1', () => {
    const result = run([
      'milestone-signoff',
      '--verdict', 'APPROVE',
      '--verified-by', 'human',
      '--token', 'WRONG-TOKEN',
    ])
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/orchestrator-only|write_token/i)
  })

  it('valid token exits 0 and writes sign-off to ledger', () => {
    const result = run([
      'milestone-signoff',
      '--verdict', 'APPROVE',
      '--verified-by', 'human-operator',
      '--token', 'tok-ms-secret',
    ])
    expect(result.code, `expected exit 0 but got: ${result.stderr}`).toBe(0)
    expect(result.stdout).toMatch(/milestone-signoff: APPROVE by human-operator/)

    const ledger = readLedger()
    expect(ledger.pacing.milestone_signoff).toBeDefined()
    expect(ledger.pacing.milestone_signoff.verdict).toBe('APPROVE')
    expect(ledger.pacing.milestone_signoff.verified_by).toBe('human-operator')
    expect(ledger.pacing.milestone_signoff.verified_at).toBeTruthy()
  })

  it('valid token with REJECT exits 0 and records REJECT verdict', () => {
    const result = run([
      'milestone-signoff',
      '--verdict', 'REJECT',
      '--verified-by', 'human-operator',
      '--note', 'screenshot is stale',
      '--token', 'tok-ms-secret',
    ])
    expect(result.code, `expected exit 0 but got: ${result.stderr}`).toBe(0)

    const ledger = readLedger()
    expect(ledger.pacing.milestone_signoff.verdict).toBe('REJECT')
    expect(ledger.pacing.milestone_signoff.note).toBe('screenshot is stale')
  })
})

// ---------------------------------------------------------------------------
// Gate behavior: claim blocked before sign-off, released after APPROVE
// ---------------------------------------------------------------------------

describe('claim blocked before sign-off, released after APPROVE', () => {
  it('ledger claim into new wave is blocked before sign-off', () => {
    // W0 complete, budget=1 consumed. W1 claim must be blocked.
    // claim requires a session ID — use runWithSession.
    const result = runWithSession(['claim', 'W1'], 'test-session-1')
    expect(result.code, 'claim into wave 1 must be blocked without sign-off').toBe(1)
    expect(result.stderr + result.stdout).toMatch(/Milestone gate/i)
  })

  it('ledger claim into new wave is allowed after APPROVE sign-off', () => {
    // First record the sign-off (no session ID needed for signoff).
    const signResult = run([
      'milestone-signoff',
      '--verdict', 'APPROVE',
      '--verified-by', 'human-operator',
      '--token', 'tok-ms-secret',
    ])
    expect(signResult.code, `sign-off failed: ${signResult.stderr}`).toBe(0)

    // Now claim W1 — should succeed.
    const claimResult = runWithSession(['claim', 'W1'], 'test-session-1')
    expect(claimResult.code, `claim after APPROVE should succeed: ${claimResult.stderr}`).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Policy guard: must be milestone policy
// ---------------------------------------------------------------------------

describe('milestone-signoff requires policy=milestone', () => {
  it('exits 1 when pacing.policy is not milestone', () => {
    writeLedger({
      version: 1,
      active: true,
      brief: 'wave pacing test',
      write_token: 'tok-ms-secret',
      pacing: { policy: 'wave', budget: 1, exempt_kinds: [] },
      slices: [{ id: 'S1', wave: 0, kind: 'impl', status: 'pending' }],
      gate: {},
    })
    const result = run([
      'milestone-signoff',
      '--verdict', 'APPROVE',
      '--verified-by', 'human',
      '--token', 'tok-ms-secret',
    ])
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/policy.*milestone/i)
  })
})

// ---------------------------------------------------------------------------
// Stale artifact rejection at CLI level (PACING-R-009)
// ---------------------------------------------------------------------------

describe('PACING-R-009 — stale artifacts rejected by milestone-signoff CLI', () => {
  it('APPROVE with stale artifact (hash mismatch) exits 1', () => {
    writeLedger(milestoneLedger({
      milestone_artifacts: [
        {
          path: '/tmp/evidence.png',
          kind: 'live_url',  // live_url — companion required; no disk existence check for the URL itself
          captured_build_hash: 'old-hash',
        },
        {
          path: ledgerFile,  // companion: exists on disk (written by writeLedger above)
          kind: 'file',
        },
      ],
    }))

    // Supply current build hash 'new-hash' — mismatch → stale → rejected.
    const result = run([
      'milestone-signoff',
      '--verdict', 'APPROVE',
      '--verified-by', 'human',
      '--build-hash', 'new-hash',
      '--token', 'tok-ms-secret',
    ])
    expect(result.code, 'stale artifact must cause exit 1').toBe(1)
    expect(result.stderr).toMatch(/stale|hash mismatch/i)
  })

  it('APPROVE with matching hash exits 0 (artifact is fresh)', () => {
    writeLedger(milestoneLedger({
      milestone_artifacts: [
        {
          path: '/tmp/evidence.png',
          kind: 'live_url',  // live_url — companion required; no disk existence check for the URL itself
          captured_build_hash: 'current-hash',
        },
        {
          path: ledgerFile,  // companion: exists on disk (written by writeLedger above)
          kind: 'file',
        },
      ],
    }))

    const result = run([
      'milestone-signoff',
      '--verdict', 'APPROVE',
      '--verified-by', 'human',
      '--build-hash', 'current-hash',
      '--token', 'tok-ms-secret',
    ])
    expect(result.code, `expected exit 0 but got: ${result.stderr}`).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Required flags
// ---------------------------------------------------------------------------

describe('required flags', () => {
  it('missing --verdict exits 2', () => {
    const result = run(['milestone-signoff', '--verified-by', 'human', '--token', 'tok-ms-secret'])
    expect(result.code).toBe(2)
  })

  it('invalid --verdict exits 2', () => {
    const result = run(['milestone-signoff', '--verdict', 'MAYBE', '--verified-by', 'human', '--token', 'tok-ms-secret'])
    expect(result.code).toBe(2)
  })

  it('missing --verified-by exits 2', () => {
    const result = run(['milestone-signoff', '--verdict', 'APPROVE', '--token', 'tok-ms-secret'])
    expect(result.code).toBe(2)
  })
})
