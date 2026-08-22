/**
 * ledger-claim-milestone-deployed.test.ts — Deployed-path coverage for V9.
 *
 * Proves the freshness enforcement works via the REAL deployed invocation path:
 * spawning `bin/ledger claim <id>` as a subprocess with NO --build-hash flag.
 *
 * This is the gap the advisor identified: existing pacing-milestone.test.ts called
 * checkPace() directly (bypassing the CLI layer), so a silent null default at either
 * call site in ledger.mjs would have gone undetected by those tests.
 *
 * AC-8 (spine-beads-hitl-portability): policy:milestone must enforce artifact
 * freshness AND human sign-off — both must be checked on the deployed path.
 */

// @verifies PACING-R-009

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const CLI = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'ledger.mjs')
const SESSION = 'sess-milestone-deployed-test'

let projectDir: string

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), 'ledger-milestone-deployed-'))
  mkdirSync(path.join(projectDir, '.groundwork', 'runs'), { recursive: true })
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

/** Write a ledger fixture to the per-session run file. */
function writeLedger(obj: object): void {
  writeFileSync(
    path.join(projectDir, '.groundwork', 'runs', `${SESSION}.json`),
    JSON.stringify(obj, null, 2),
  )
}

/** Invoke ledger CLI with CLAUDE_PROJECT_DIR and CLAUDE_CODE_SESSION_ID set. */
function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const env = {
    ...process.env,
    CLAUDE_PROJECT_DIR: projectDir,
    CLAUDE_CODE_SESSION_ID: SESSION,
  }
  const r = spawnSync('node', [CLI, ...args], { env, encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/**
 * Milestone ledger where:
 *  - budget=1, wave 0 complete (budget consumed)
 *  - APPROVE sign-off present
 *  - artifact has captured_build_hash='hash-abc' (stale unless current hash matches)
 *  - wave 1 slice W1a is pending
 */
function milestoneLedger(): object {
  return {
    version: 1,
    active: true,
    session_id: SESSION,
    brief: 'deployed-path enforcement test',
    write_token: 'tok-dp-test',
    pacing: {
      policy: 'milestone',
      budget: 1,
      exempt_kinds: ['plan', 'diagnose', 'design', 'fog'],
      milestone_artifacts: [
        {
          path: '/tmp/screenshot.png',
          kind: 'screenshot',
          label: 'UI screenshot',
          captured_build_hash: 'hash-abc',
        },
      ],
      milestone_signoff: {
        verdict: 'APPROVE',
        verified_by: 'human-reviewer',
        verified_at: '2026-08-22T00:00:00.000Z',
        artifacts_verified: ['/tmp/screenshot.png'],
      },
    },
    slices: [
      {
        id: 'W0',
        wave: 0,
        kind: 'impl',
        status: 'complete',
        completed_at: '2026-08-22T00:00:00.000Z',
      },
      {
        id: 'W1a',
        wave: 1,
        kind: 'impl',
        status: 'pending',
        desc: 'wave 1 slice a',
      },
    ],
    gate: {},
  }
}

// ---------------------------------------------------------------------------
// Deployed-path: claim with NO --build-hash → must BLOCK
// ---------------------------------------------------------------------------

describe('DEPLOYED PATH — ledger claim with NO --build-hash (stale artifact)', () => {
  it('exits 1 and blocks claim when artifact has captured_build_hash and no --build-hash supplied', () => {
    writeLedger(milestoneLedger())
    // Deployed path: no --build-hash flag → claimBuildHash = null → fail-closed
    const r = run(['claim', 'W1a'])
    expect(r.code, `exit code must be 1 (blocked); stderr: ${r.stderr}`).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/no current build hash supplied/i)
  })

  it('exit code is read directly (not through pipe) — DEPLOYED PATH proof', () => {
    // Regression guard: exit code must come from spawnSync status, not a pipe.
    // A pipe would report the last pipe's status, not the CLI's.
    writeLedger(milestoneLedger())
    const r = run(['claim', 'W1a'])
    // r.code is spawnSync.status — never piped. Confirm it is 1.
    expect(typeof r.code).toBe('number')
    expect(r.code).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Deployed-path: claim WITH correct --build-hash → must RELEASE
// ---------------------------------------------------------------------------

describe('DEPLOYED PATH — ledger claim WITH matching --build-hash (fresh artifact)', () => {
  it('exits 0 and releases claim when --build-hash matches captured_build_hash', () => {
    writeLedger(milestoneLedger())
    // Provide the hash that matches the artifact's captured_build_hash.
    const r = run(['claim', 'W1a', '--build-hash', 'hash-abc'])
    expect(r.code, `exit code must be 0 (released); stderr: ${r.stderr}`).toBe(0)
    expect(r.stdout).toMatch(/claimed/)
  })
})

// ---------------------------------------------------------------------------
// Deployed-path: claim WITH mismatched --build-hash → must BLOCK
// ---------------------------------------------------------------------------

describe('DEPLOYED PATH — ledger claim WITH mismatched --build-hash (stale artifact)', () => {
  it('exits 1 and blocks when --build-hash does not match captured_build_hash', () => {
    writeLedger(milestoneLedger())
    const r = run(['claim', 'W1a', '--build-hash', 'hash-xyz'])
    expect(r.code, `exit code must be 1 (blocked); stderr: ${r.stderr}`).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/stale/i)
  })
})
