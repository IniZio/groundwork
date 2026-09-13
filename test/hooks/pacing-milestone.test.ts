/**
 * pacing-milestone.test.ts — S7 milestone pacing unit tests.
 *
 * Verifies:
 *   - PACING-R-009: stale artifact (hash mismatch) does not satisfy the evidence requirement.
 *
 * Pure-function tests operate on `hooks/lib/checkpoint.mjs`; deployed-path tests call the ledger CLI.
 */

// @verifies PACING-R-009

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { checkMilestoneArtifacts } from '../../hooks/lib/checkpoint.mjs'

// ---------------------------------------------------------------------------

/** Minimal milestone ledger: budget=1, wave 0 complete, wave 1 pending. Gate should hold. */
function milestoneDoc(overrides: Record<string, unknown> = {}) {
  return {
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
      ...overrides,
    },
    slices: [
      { id: 'W0', wave: 0, kind: 'impl', status: 'complete' },
      { id: 'W1a', wave: 1, kind: 'impl', status: 'pending' },
      { id: 'W1b', wave: 1, kind: 'impl', status: 'pending' },
    ],
  }
}

// ---------------------------------------------------------------------------

describe('PACING-R-009 — stale artifact does not satisfy evidence requirement', () => {
  it('hash mismatch marks artifact stale → satisfied=false', () => {
    const doc = milestoneDoc()
    const result = checkMilestoneArtifacts(doc, 'hash-xyz')
    expect(result.satisfied, 'stale artifact must not satisfy evidence requirement').toBe(false)
    expect(result.staleArtifacts).toContain('/tmp/screenshot.png')
    expect(result.reason).toMatch(/build hash mismatch/i)
  })

  it('hash match → artifact is fresh → satisfied=true', () => {
    const doc = milestoneDoc()
    const result = checkMilestoneArtifacts(doc, 'hash-abc')
    expect(result.satisfied, 'fresh artifact must satisfy evidence requirement').toBe(true)
    expect(result.staleArtifacts).toHaveLength(0)
  })

  it('no currentBuildHash + artifact has captured_build_hash → fail-closed → satisfied=false', () => {
    const doc = milestoneDoc()
    const result = checkMilestoneArtifacts(doc, null)
    expect(result.satisfied, 'artifact with captured_build_hash + no current hash → must be stale').toBe(false)
    expect(result.staleArtifacts).toContain('/tmp/screenshot.png')
    expect(result.reason).toMatch(/cannot verify freshness/i)
  })

  it('run_output WITH captured_build_hash (matching) + no currentBuildHash → stale (fail-closed)', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        exempt_kinds: [] as string[],
        milestone_artifacts: [
          { path: '/tmp/run.log', kind: 'run_output', captured_build_hash: 'hash-run' },
        ],
      },
      slices: [],
    }
    const result = checkMilestoneArtifacts(doc, null)
    expect(result.satisfied, 'run_output with hash + no current hash → stale (fail-closed)').toBe(false)
    expect(result.staleArtifacts).toContain('/tmp/run.log')
    expect(result.reason).toMatch(/cannot verify freshness/i)
  })

  it('run_output WITH matching captured_build_hash → fresh', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        exempt_kinds: [] as string[],
        milestone_artifacts: [
          { path: '/tmp/run.log', kind: 'run_output', captured_build_hash: 'hash-run' },
        ],
      },
      slices: [],
    }
    const result = checkMilestoneArtifacts(doc, 'hash-run')
    expect(result.satisfied, 'run_output with matching hash is fresh').toBe(true)
    expect(result.staleArtifacts).toHaveLength(0)
  })

  it('no milestone_artifacts → satisfied=true', () => {
    const doc = {
      pacing: { policy: 'milestone', budget: 1, exempt_kinds: [] as string[] },
      slices: [],
    }
    const result = checkMilestoneArtifacts(doc)
    expect(result.satisfied).toBe(true)
    expect(result.staleArtifacts).toHaveLength(0)
  })

  it('no pacing config → satisfied=true', () => {
    const result = checkMilestoneArtifacts({}, 'any-hash')
    expect(result.satisfied).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('PACING-R-009 — stale-able artifact without captured_build_hash is rejected (fail-closed)', () => {
  it('screenshot without captured_build_hash → rejected (satisfied=false)', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        exempt_kinds: [] as string[],
        milestone_artifacts: [
          { path: '/tmp/screen.png', kind: 'screenshot' },
        ],
      },
      slices: [],
    }
    const result = checkMilestoneArtifacts(doc, 'any-hash')
    expect(result.satisfied).toBe(false)
    expect(result.staleArtifacts).toContain('/tmp/screen.png')
    expect(result.reason).toMatch(/captured_build_hash/)
  })

  it('run_output without captured_build_hash → rejected (satisfied=false)', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        exempt_kinds: [] as string[],
        milestone_artifacts: [
          { path: '/tmp/run.log', kind: 'run_output' },
        ],
      },
      slices: [],
    }
    const result = checkMilestoneArtifacts(doc, 'any-hash')
    expect(result.satisfied).toBe(false)
    expect(result.staleArtifacts).toContain('/tmp/run.log')
    expect(result.reason).toMatch(/captured_build_hash/)
  })

  it('file without captured_build_hash → accepted (not stale-able)', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        exempt_kinds: [] as string[],
        milestone_artifacts: [
          { path: '/tmp/report.html', kind: 'file' },
        ],
      },
      slices: [],
    }
    const result = checkMilestoneArtifacts(doc, 'any-hash')
    expect(result.satisfied).toBe(true)
    expect(result.staleArtifacts).toHaveLength(0)
  })

  it('lone live_url without captured companion → rejected (companion required)', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        exempt_kinds: [] as string[],
        milestone_artifacts: [
          { path: 'https://example.com/app', kind: 'live_url' },
        ],
      },
      slices: [],
    }
    const result = checkMilestoneArtifacts(doc, 'any-hash')
    expect(result.satisfied).toBe(false)
    expect(result.reason).toMatch(/captured companion/)
  })

  it('live_url + file companion → satisfied=true', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        exempt_kinds: [] as string[],
        milestone_artifacts: [
          { path: 'https://example.com/app', kind: 'live_url' },
          { path: '/tmp/output.txt', kind: 'file' },
        ],
      },
      slices: [],
    }
    const result = checkMilestoneArtifacts(doc, 'any-hash')
    expect(result.satisfied).toBe(true)
  })

  it('live_url + run_output companion → satisfied=true', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        exempt_kinds: [] as string[],
        milestone_artifacts: [
          { path: 'https://example.com/app', kind: 'live_url' },
          { path: '/tmp/run.log', kind: 'run_output', captured_build_hash: 'build-abc' },
        ],
      },
      slices: [],
    }
    const result = checkMilestoneArtifacts(doc, 'build-abc')
    expect(result.satisfied).toBe(true)
  })

  it('live_url + screenshot companion → satisfied=true', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        exempt_kinds: [] as string[],
        milestone_artifacts: [
          { path: 'https://example.com/app', kind: 'live_url' },
          { path: '/tmp/screen.png', kind: 'screenshot', captured_build_hash: 'build-xyz' },
        ],
      },
      slices: [],
    }
    const result = checkMilestoneArtifacts(doc, 'build-xyz')
    expect(result.satisfied).toBe(true)
  })

  it('unknown kind → rejected (fail-closed) regardless of hash', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        exempt_kinds: [] as string[],
        milestone_artifacts: [
          { path: '/tmp/recording.mp4', kind: 'video', captured_build_hash: 'hash-abc' },
        ],
      },
      slices: [],
    }
    const result = checkMilestoneArtifacts(doc, 'hash-abc')
    expect(result.satisfied).toBe(false)
    expect(result.staleArtifacts).toContain('/tmp/recording.mp4')
  })

  it('absent kind → rejected (fail-closed)', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        exempt_kinds: [] as string[],
        milestone_artifacts: [
          { path: '/tmp/thing', captured_build_hash: 'hash-abc' },
        ],
      },
      slices: [],
    }
    const result = checkMilestoneArtifacts(doc, 'hash-abc')
    expect(result.satisfied).toBe(false)
    expect(result.staleArtifacts).toContain('/tmp/thing')
  })
})

// ---------------------------------------------------------------------------

const CLI = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'ledger.mjs')
const SESSION_DPH = 'sess-pacing-declaration-hash-test'

let deployedProjectDir: string

beforeEach(() => {
  deployedProjectDir = mkdtempSync(path.join(tmpdir(), 'pacing-declaration-hash-'))
  mkdirSync(path.join(deployedProjectDir, '.groundwork', 'runs'), { recursive: true })
})

afterEach(() => {
  rmSync(deployedProjectDir, { recursive: true, force: true })
})

function writeDeclarationLedger(artifactOverride: object): void {
  const ledger = {
    version: 1,
    active: true,
    session_id: SESSION_DPH,
    brief: 'declaration-hash enforcement test',
    write_token: 'tok-dh-test',
    pacing: {
      policy: 'milestone',
      budget: 1,
      exempt_kinds: ['plan', 'diagnose', 'design', 'fog'],
      milestone_artifacts: [artifactOverride],
      milestone_signoff: {
        verdict: 'APPROVE',
        verified_by: 'human-reviewer',
        verified_at: '2026-08-22T00:00:00.000Z',
        artifacts_verified: [],
      },
    },
    slices: [
      { id: 'W0', wave: 0, kind: 'impl', status: 'complete', completed_at: '2026-08-22T00:00:00.000Z' },
      { id: 'W1a', wave: 1, kind: 'impl', status: 'pending', desc: 'wave 1 slice' },
    ],
    gate: {},
  }
  writeFileSync(
    path.join(deployedProjectDir, '.groundwork', 'runs', `${SESSION_DPH}.json`),
    JSON.stringify(ledger, null, 2),
  )
}

function runClaim(args: string[]): { code: number; stdout: string; stderr: string } {
  const env = {
    ...process.env,
    CLAUDE_PROJECT_DIR: deployedProjectDir,
    CLAUDE_CODE_SESSION_ID: SESSION_DPH,
  }
  const r = spawnSync('node', [CLI, ...args], { env, encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('DEPLOYED PATH — ledger claim rejects stale-able artifact missing captured_build_hash', () => {
  it('run_output WITHOUT captured_build_hash: exits 1 (REJECTED via deployed path)', () => {
    writeDeclarationLedger({ path: '/tmp/run.log', kind: 'run_output' })
    const r = runClaim(['claim', 'W1a', '--build-hash', 'hash-any'])
    expect(r.code, `exit code must be 1 (rejected); stderr: ${r.stderr}`).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/captured_build_hash/)
  })

  it('screenshot WITHOUT captured_build_hash: exits 1 (REJECTED via deployed path)', () => {
    writeDeclarationLedger({ path: '/tmp/screen.png', kind: 'screenshot' })
    const r = runClaim(['claim', 'W1a', '--build-hash', 'hash-any'])
    expect(r.code, `exit code must be 1 (rejected); stderr: ${r.stderr}`).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/captured_build_hash/)
  })

  it('exit code comes from spawnSync.status (not a pipe) — DEPLOYED PATH proof', () => {
    writeDeclarationLedger({ path: '/tmp/run.log', kind: 'run_output' })
    const r = runClaim(['claim', 'W1a', '--build-hash', 'hash-any'])
    expect(typeof r.code).toBe('number')
    expect(r.code).toBe(1)
  })
})

describe('DEPLOYED PATH — ledger claim ACCEPTS non-stale-able artifact without hash', () => {
  it('file WITHOUT captured_build_hash: exits 0 (accepted — existence-only kind)', () => {
    writeDeclarationLedger({ path: '/tmp/report.html', kind: 'file', captured_build_hash: undefined })
    const r = runClaim(['claim', 'W1a', '--build-hash', 'hash-any'])
    expect(r.code, `exit code must be 0 (accepted); stderr: ${r.stderr}`).toBe(0)
  })
})
