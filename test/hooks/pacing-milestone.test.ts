/**
 * pacing-milestone.test.ts — S7 milestone pacing unit tests.
 *
 * Verifies:
 *   - PACING-R-007: milestone gate holds without sign-off; releases with APPROVE.
 *   - PACING-R-007: wave-count alone does NOT release under milestone policy.
 *   - PACING-R-007: REJECT verdict does not release.
 *   - PACING-R-009: stale artifact (hash mismatch) does not satisfy the evidence requirement.
 *   - PACING-R-010: awaiting_human composes — the hold suppresses nagging but does not
 *     release the milestone gate itself (gate is released by signoff, not by the hold).
 *
 * All tests operate on the PURE functions in pacing.mjs — no filesystem I/O.
 */

// @verifies PACING-R-007
// @verifies PACING-R-009
// @verifies PACING-R-010

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { checkPace, resolvedUnits, checkMilestoneArtifacts } from '../../hooks/lib/pacing.mjs'

// ---------------------------------------------------------------------------
// Fixtures
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

const APPROVE_SIGNOFF = {
  verdict: 'APPROVE',
  verified_by: 'human-operator',
  verified_at: '2026-08-21T10:00:00.000Z',
  artifacts_verified: ['/tmp/screenshot.png'],
}

const REJECT_SIGNOFF = {
  verdict: 'REJECT',
  verified_by: 'human-operator',
  verified_at: '2026-08-21T10:00:00.000Z',
  artifacts_verified: ['/tmp/screenshot.png'],
  note: 'Screenshot shows wrong state — rerun and re-capture.',
}

// ---------------------------------------------------------------------------
// PACING-R-007: gate holds without sign-off
// ---------------------------------------------------------------------------

describe('PACING-R-007 — milestone gate holds without sign-off', () => {
  it('wave-count alone does NOT release the milestone gate (budget consumed, no sign-off)', () => {
    // Wave 0 complete (budget=1 consumed). Claim into wave 1 must be blocked.
    const doc = milestoneDoc()  // no milestone_signoff
    const result = checkPace(doc, 'W1a')
    expect(result.allowed, 'wave-count alone must not release milestone gate').toBe(false)
    expect(result.reason, 'block message must name the milestone gate').toMatch(/Milestone gate/i)
  })

  it('block message mentions sign-off command for remediation', () => {
    const doc = milestoneDoc()
    const result = checkPace(doc, 'W1a')
    expect(result.remedy, 'remedy must reference milestone-signoff command').toMatch(/milestone-signoff/)
  })

  it('REJECT verdict does NOT release the gate', () => {
    const doc = milestoneDoc({ milestone_signoff: REJECT_SIGNOFF })
    const result = checkPace(doc, 'W1a')
    expect(result.allowed, 'REJECT verdict must not release milestone gate').toBe(false)
    expect(result.reason, 'block message must name REJECT verdict').toMatch(/REJECT/)
  })

  it('absent sign-off — block message notes no sign-off recorded', () => {
    const doc = milestoneDoc()
    const result = checkPace(doc, 'W1a')
    expect(result.reason).toMatch(/No sign-off recorded/i)
  })
})

// ---------------------------------------------------------------------------
// PACING-R-007: gate releases with APPROVE
// ---------------------------------------------------------------------------

describe('PACING-R-007 — milestone gate releases with APPROVE sign-off', () => {
  it('APPROVE sign-off + fresh artifact releases the gate (allows claiming wave 1)', () => {
    // Must supply build hash matching captured_build_hash to prove freshness.
    const doc = milestoneDoc({ milestone_signoff: APPROVE_SIGNOFF })
    const result = checkPace(doc, 'W1a', 'hash-abc')
    expect(result.allowed, 'APPROVE sign-off must release milestone gate').toBe(true)
  })

  it('APPROVE sign-off + fresh artifact allows multiple slices in the new wave', () => {
    const doc = milestoneDoc({ milestone_signoff: APPROVE_SIGNOFF })
    expect(checkPace(doc, 'W1a', 'hash-abc').allowed).toBe(true)
    expect(checkPace(doc, 'W1b', 'hash-abc').allowed).toBe(true)
  })

  it('slices in the already-entered unit are always allowed (no gate)', () => {
    // W0 is in the current unit (wave 0) — already in-progress.
    const doc = {
      pacing: { policy: 'milestone', budget: 1, exempt_kinds: [] as string[] },
      slices: [
        { id: 'W0a', wave: 0, kind: 'impl', status: 'in_progress' },
        { id: 'W0b', wave: 0, kind: 'impl', status: 'pending' },
      ],
    }
    // W0b is in the same unit (wave 0) that W0a is already in_progress.
    // The active-unit bypass means this is always free.
    const result = checkPace(doc, 'W0b')
    expect(result.allowed, 'intra-wave claims always allowed regardless of signoff').toBe(true)
  })

  it('exempt slices are always allowed (plan, diagnose, etc.)', () => {
    const doc = {
      pacing: { policy: 'milestone', budget: 1, exempt_kinds: ['plan', 'diagnose', 'design', 'fog'] as string[] },
      slices: [
        { id: 'W0', wave: 0, kind: 'impl', status: 'complete' },
        { id: 'PLAN', wave: 2, kind: 'plan', status: 'pending' },
      ],
    }
    const result = checkPace(doc, 'PLAN')
    expect(result.allowed, 'exempt slices bypass milestone gate').toBe(true)
  })
})

// ---------------------------------------------------------------------------
// resolvedUnits — milestone counts waves (same as wave policy)
// ---------------------------------------------------------------------------

describe('resolvedUnits — milestone uses wave counting', () => {
  it('resolvedUnits counts resolved waves regardless of sign-off status', () => {
    // Wave 0 complete (both slices) — sign-off absent. resolvedUnits = 1.
    const doc = milestoneDoc()
    expect(resolvedUnits(doc), 'wave 0 resolved even without signoff').toBe(1)
  })

  it('resolvedUnits same result with APPROVE sign-off', () => {
    const doc = milestoneDoc({ milestone_signoff: APPROVE_SIGNOFF })
    expect(resolvedUnits(doc)).toBe(1)
  })

  it('resolvedUnits = 0 when no waves are complete', () => {
    const doc = {
      pacing: { policy: 'milestone', budget: 1, exempt_kinds: [] as string[] },
      slices: [{ id: 'S1', wave: 0, kind: 'impl', status: 'pending' }],
    }
    expect(resolvedUnits(doc)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// PACING-R-007 + PACING-R-009: APPROVE + artifact freshness at release time
// ---------------------------------------------------------------------------

describe('PACING-R-007+R-009 — APPROVE sign-off requires FRESH artifacts at gate release', () => {
  it('APPROVE + STALE artifacts does NOT release the gate', () => {
    // Human signed off while artifacts were fresh (hash-abc).
    // Build was then rebuilt (now hash-xyz). Artifacts are stale.
    const doc = milestoneDoc({ milestone_signoff: APPROVE_SIGNOFF })
    // Pass 'hash-xyz' as current build hash — artifact has 'hash-abc' → stale.
    const result = checkPace(doc, 'W1a', 'hash-xyz')
    expect(result.allowed, 'APPROVE + stale artifacts must NOT release gate').toBe(false)
    expect(result.reason, 'block message must name stale artifacts').toMatch(/stale/i)
    expect(result.reason, 'block message must reference the stale path').toMatch(/\/tmp\/screenshot\.png/)
  })

  it('APPROVE + FRESH artifacts DOES release the gate', () => {
    // Human signed off; build hash matches artifact's captured_build_hash → fresh.
    const doc = milestoneDoc({ milestone_signoff: APPROVE_SIGNOFF })
    // Artifact has captured_build_hash='hash-abc'; current build is also 'hash-abc'.
    const result = checkPace(doc, 'W1a', 'hash-abc')
    expect(result.allowed, 'APPROVE + fresh artifacts must release gate').toBe(true)
  })

  it('APPROVE + no currentBuildHash + artifact has captured_build_hash → gate BLOCKS (fail-closed)', () => {
    // Fail-closed: artifact declares a build hash, but no current hash supplied.
    // Cannot verify freshness → gate blocks until --build-hash is provided.
    const doc = milestoneDoc({ milestone_signoff: APPROVE_SIGNOFF })
    const result = checkPace(doc, 'W1a', null)
    expect(result.allowed, 'gate must block when hash is absent and artifact declares one').toBe(false)
    expect(result.reason).toMatch(/no current build hash supplied/i)
  })

  it('APPROVE + no currentBuildHash omitted + artifact has captured_build_hash → gate BLOCKS (fail-closed)', () => {
    // Omitting the third argument is the same as null — fail-closed applies.
    const doc = milestoneDoc({ milestone_signoff: APPROVE_SIGNOFF })
    const result = checkPace(doc, 'W1a')
    expect(result.allowed, 'gate must block when hash argument is omitted and artifact declares one').toBe(false)
  })

  it('APPROVE + run_output WITH captured_build_hash (matching) → gate releases', () => {
    // run_output requires captured_build_hash. Supply it and match the current build hash.
    // (Previously this test declared run_output without a hash — that was exercising the
    // defect where stale-able artifacts could bypass freshness by omitting the field.)
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        exempt_kinds: ['plan', 'diagnose', 'design', 'fog'] as string[],
        milestone_artifacts: [
          { path: '/tmp/run.log', kind: 'run_output', captured_build_hash: 'hash-run' },
        ],
        milestone_signoff: APPROVE_SIGNOFF,
      },
      slices: [
        { id: 'W0', wave: 0, kind: 'impl', status: 'complete' },
        { id: 'W1a', wave: 1, kind: 'impl', status: 'pending' },
      ],
    }
    const result = checkPace(doc, 'W1a', 'hash-run')
    expect(result.allowed, 'APPROVE + fresh run_output artifact must release gate').toBe(true)
  })

  it('stale-block message names the remedy (re-capture and re-sign)', () => {
    const doc = milestoneDoc({ milestone_signoff: APPROVE_SIGNOFF })
    const result = checkPace(doc, 'W1a', 'hash-xyz')
    expect(result.remedy, 'remedy must instruct re-capture and re-sign').toMatch(/milestone-signoff/)
    expect(result.remedy).toMatch(/build-hash/)
  })
})

// ---------------------------------------------------------------------------
// PACING-R-009: artifact freshness via checkMilestoneArtifacts
// ---------------------------------------------------------------------------

describe('PACING-R-009 — stale artifact does not satisfy evidence requirement', () => {
  it('hash mismatch marks artifact stale → satisfied=false', () => {
    const doc = milestoneDoc()
    // Artifact has captured_build_hash='hash-abc'; current build is 'hash-xyz'.
    const result = checkMilestoneArtifacts(doc, 'hash-xyz')
    expect(result.satisfied, 'stale artifact must not satisfy evidence requirement').toBe(false)
    expect(result.staleArtifacts).toContain('/tmp/screenshot.png')
    expect(result.reason).toMatch(/build hash mismatch/i)
  })

  it('hash match → artifact is fresh → satisfied=true', () => {
    const doc = milestoneDoc()
    // Artifact has captured_build_hash='hash-abc'; current build is also 'hash-abc'.
    const result = checkMilestoneArtifacts(doc, 'hash-abc')
    expect(result.satisfied, 'fresh artifact must satisfy evidence requirement').toBe(true)
    expect(result.staleArtifacts).toHaveLength(0)
  })

  it('no currentBuildHash + artifact has captured_build_hash → fail-closed → satisfied=false', () => {
    // Fail-closed: artifact declares a build hash, but no current hash supplied.
    // Cannot verify freshness → treat as stale (PACING-R-009 fail-closed enforcement).
    const doc = milestoneDoc()
    const result = checkMilestoneArtifacts(doc, null)
    expect(result.satisfied, 'artifact with captured_build_hash + no current hash → must be stale').toBe(false)
    expect(result.staleArtifacts).toContain('/tmp/screenshot.png')
    expect(result.reason).toMatch(/cannot verify freshness/i)
  })

  it('run_output WITH captured_build_hash (matching) + no currentBuildHash → stale (fail-closed)', () => {
    // run_output requires captured_build_hash. When the current build hash is not supplied
    // the artifact cannot be verified — fail-closed means treated as stale.
    // (Previously this test declared run_output without a hash — that was exercising the
    // defect where stale-able artifacts could bypass freshness by omitting the field.)
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
    // run_output requires captured_build_hash. When supplied and matching → fresh.
    // (Previously this test declared run_output without a hash and expected "fresh"
    // via existence-only — that was exercising the defect.)
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
// PACING-R-010: awaiting_human composes with milestone gate
// ---------------------------------------------------------------------------

describe('PACING-R-010 — awaiting_human composes with milestone gate', () => {
  it('awaiting_human=true does not release the milestone gate itself', () => {
    // The hold suppresses the stop-gate nag (tested in stop-gate-await-human.test.ts),
    // but checkPace must still block: the hold is not the sign-off.
    const doc = {
      ...milestoneDoc(),
      awaiting_human: true,  // hold is set — nag suppressed
    }
    const result = checkPace(doc, 'W1a')
    expect(result.allowed, 'awaiting_human hold must not release milestone gate').toBe(false)
  })

  it('awaiting_human=true AND milestone_signoff APPROVE + fresh artifact → gate released', () => {
    // When the human responds with APPROVE, gate opens regardless of hold state.
    // Must supply build hash matching captured_build_hash to prove freshness.
    const doc = {
      ...milestoneDoc({ milestone_signoff: APPROVE_SIGNOFF }),
      awaiting_human: true,
    }
    const result = checkPace(doc, 'W1a', 'hash-abc')
    expect(result.allowed, 'APPROVE sign-off releases gate even with hold set').toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Existing wave/slice behavior is unchanged
// ---------------------------------------------------------------------------

describe('Existing wave/slice policies unaffected by milestone changes', () => {
  it('wave policy: budget exhausted without milestone signoff still blocks (generic message)', () => {
    const doc = {
      pacing: { policy: 'wave', budget: 1, exempt_kinds: [] as string[] },
      slices: [
        { id: 'W0', wave: 0, kind: 'impl', status: 'complete' },
        { id: 'W1', wave: 1, kind: 'impl', status: 'pending' },
      ],
    }
    const result = checkPace(doc, 'W1')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/Pacing budget exhausted/)
    // Must NOT be the milestone gate message
    expect(result.reason).not.toMatch(/Milestone gate/)
  })

  it('slice policy: budget exhausted blocks with generic message', () => {
    const doc = {
      pacing: { policy: 'slice', budget: 1, exempt_kinds: [] as string[] },
      slices: [
        { id: 'S0', wave: 0, kind: 'impl', status: 'complete' },
        { id: 'S1', wave: 0, kind: 'impl', status: 'pending' },
      ],
    }
    const result = checkPace(doc, 'S1')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/Pacing budget exhausted/)
  })
})

// ---------------------------------------------------------------------------
// PACING-R-009 — stale-able artifact without captured_build_hash is REJECTED
// ---------------------------------------------------------------------------

describe('PACING-R-009 — stale-able artifact without captured_build_hash is rejected (fail-closed)', () => {
  it('screenshot without captured_build_hash → rejected (satisfied=false)', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        exempt_kinds: [] as string[],
        milestone_artifacts: [
          { path: '/tmp/screen.png', kind: 'screenshot' },  // no captured_build_hash
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
          { path: '/tmp/run.log', kind: 'run_output' },  // no captured_build_hash
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
    // file kind does not go stale; hash is optional.
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        exempt_kinds: [] as string[],
        milestone_artifacts: [
          { path: '/tmp/report.html', kind: 'file' },  // no hash — OK for file
        ],
      },
      slices: [],
    }
    const result = checkMilestoneArtifacts(doc, 'any-hash')
    expect(result.satisfied).toBe(true)
    expect(result.staleArtifacts).toHaveLength(0)
  })

  it('live_url without captured_build_hash → accepted (not stale-able)', () => {
    // live_url kind does not go stale; hash is optional.
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        exempt_kinds: [] as string[],
        milestone_artifacts: [
          { path: 'https://example.com/app', kind: 'live_url' },  // no hash — OK
        ],
      },
      slices: [],
    }
    const result = checkMilestoneArtifacts(doc, 'any-hash')
    expect(result.satisfied).toBe(true)
    expect(result.staleArtifacts).toHaveLength(0)
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
          { path: '/tmp/thing', captured_build_hash: 'hash-abc' },  // no kind field
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
// DEPLOYED PATH — declaration via bin/ledger rejects stale-able artifact without hash
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
    // PROVE THE BITE: stale-able artifact with no hash must be rejected on the real CLI path.
    // Before the fix, this exited 0 (existence-only, bypassed freshness).
    // After the fix, it must exit 1 with a message naming captured_build_hash.
    writeDeclarationLedger({ path: '/tmp/run.log', kind: 'run_output' })
    const r = runClaim(['claim', 'W1a', '--build-hash', 'hash-any'])
    expect(r.code, `exit code must be 1 (rejected); stderr: ${r.stderr}`).toBe(1)
    // Verify the actual rejection reason mentions the required field.
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
    // file kind is not stale-able; hash is not required; claim must succeed.
    writeDeclarationLedger({ path: '/tmp/report.html', kind: 'file', captured_build_hash: undefined })
    const r = runClaim(['claim', 'W1a', '--build-hash', 'hash-any'])
    expect(r.code, `exit code must be 0 (accepted); stderr: ${r.stderr}`).toBe(0)
  })
})
