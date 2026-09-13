/**
 * Unit tests for hooks/lib/checkpoint.mjs
 *
 * Covers AC-1 (types exist and export), extracted helpers behave correctly,
 * and pacing.mjs re-exports the same symbols for backward compatibility.
 */

import { describe, it, expect } from 'vitest'
import {
  STALEABLE_ARTIFACT_KINDS,
  KNOWN_ARTIFACT_KINDS,
  checkMilestoneArtifacts,
} from '../../hooks/lib/checkpoint.mjs'
import {
  STALEABLE_ARTIFACT_KINDS as PACING_STALEABLE,
  KNOWN_ARTIFACT_KINDS as PACING_KNOWN,
  checkMilestoneArtifacts as pacingCheckMilestone,
} from '../../hooks/lib/pacing.mjs'

// ---------------------------------------------------------------------------
// Export surface
// ---------------------------------------------------------------------------

describe('checkpoint.mjs exports', () => {
  it('STALEABLE_ARTIFACT_KINDS is an array containing screenshot and run_output', () => {
    expect(Array.isArray(STALEABLE_ARTIFACT_KINDS)).toBe(true)
    expect(STALEABLE_ARTIFACT_KINDS).toContain('screenshot')
    expect(STALEABLE_ARTIFACT_KINDS).toContain('run_output')
  })

  it('KNOWN_ARTIFACT_KINDS is a superset of STALEABLE_ARTIFACT_KINDS', () => {
    for (const kind of STALEABLE_ARTIFACT_KINDS) {
      expect(KNOWN_ARTIFACT_KINDS).toContain(kind)
    }
    expect(KNOWN_ARTIFACT_KINDS).toContain('live_url')
    expect(KNOWN_ARTIFACT_KINDS).toContain('file')
  })

  it('pacing.mjs re-exports the same values (extraction back-compat)', () => {
    expect(PACING_STALEABLE).toBe(STALEABLE_ARTIFACT_KINDS)
    expect(PACING_KNOWN).toBe(KNOWN_ARTIFACT_KINDS)
    expect(pacingCheckMilestone).toBe(checkMilestoneArtifacts)
  })
})

// ---------------------------------------------------------------------------
// checkMilestoneArtifacts — pass cases
// ---------------------------------------------------------------------------

describe('checkMilestoneArtifacts — satisfied cases', () => {
  it('returns satisfied when pacing is absent', () => {
    expect(checkMilestoneArtifacts({})).toEqual({ satisfied: true, staleArtifacts: [] })
  })

  it('returns satisfied when pacing has no milestone_artifacts', () => {
    const doc = { pacing: { policy: 'milestone', budget: 1 } }
    expect(checkMilestoneArtifacts(doc)).toEqual({ satisfied: true, staleArtifacts: [] })
  })

  it('returns satisfied when milestone_artifacts is empty', () => {
    const doc = { pacing: { policy: 'milestone', budget: 1, milestone_artifacts: [] } }
    expect(checkMilestoneArtifacts(doc)).toEqual({ satisfied: true, staleArtifacts: [] })
  })

  it('screenshot with matching captured_build_hash is fresh', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        milestone_artifacts: [{ kind: 'screenshot', path: 'shot.png', captured_build_hash: 'abc123' }],
      },
    }
    const result = checkMilestoneArtifacts(doc, 'abc123')
    expect(result.satisfied).toBe(true)
    expect(result.staleArtifacts).toHaveLength(0)
  })

  it('file artifact with no captured_build_hash is fresh (existence-only)', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        milestone_artifacts: [{ kind: 'file', path: 'out.txt' }],
      },
    }
    expect(checkMilestoneArtifacts(doc, null)).toEqual({ satisfied: true, staleArtifacts: [] })
  })
})

// ---------------------------------------------------------------------------
// checkMilestoneArtifacts — fail-closed cases
// ---------------------------------------------------------------------------

describe('checkMilestoneArtifacts — fail-closed rejections', () => {
  it('rejects unknown artifact kind', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        milestone_artifacts: [{ kind: 'video', path: 'clip.mp4' }],
      },
    }
    const result = checkMilestoneArtifacts(doc, 'abc')
    expect(result.satisfied).toBe(false)
    expect(result.staleArtifacts).toContain('clip.mp4')
    expect(result.reason).toMatch(/unknown kind/)
  })

  it('rejects screenshot without captured_build_hash', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        milestone_artifacts: [{ kind: 'screenshot', path: 'shot.png' }],
      },
    }
    const result = checkMilestoneArtifacts(doc, 'abc')
    expect(result.satisfied).toBe(false)
    expect(result.staleArtifacts).toContain('shot.png')
    expect(result.reason).toMatch(/captured_build_hash/)
  })

  it('rejects screenshot with hash mismatch', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        milestone_artifacts: [{ kind: 'screenshot', path: 'shot.png', captured_build_hash: 'old' }],
      },
    }
    const result = checkMilestoneArtifacts(doc, 'new')
    expect(result.satisfied).toBe(false)
    expect(result.staleArtifacts).toContain('shot.png')
    expect(result.reason).toMatch(/[Ss]tale/)
  })

  it('rejects screenshot when current hash is null (cannot verify)', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        milestone_artifacts: [{ kind: 'screenshot', path: 'shot.png', captured_build_hash: 'abc' }],
      },
    }
    const result = checkMilestoneArtifacts(doc, null)
    expect(result.satisfied).toBe(false)
    expect(result.reason).toMatch(/no current build hash/)
  })

  it('rejects live_url without a captured companion', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        milestone_artifacts: [{ kind: 'live_url', path: 'https://example.com' }],
      },
    }
    const result = checkMilestoneArtifacts(doc, null)
    expect(result.satisfied).toBe(false)
    expect(result.reason).toMatch(/companion/)
  })

  it('live_url with a screenshot companion passes the cross-artifact check', () => {
    const doc = {
      pacing: {
        policy: 'milestone',
        budget: 1,
        milestone_artifacts: [
          { kind: 'live_url', path: 'https://example.com' },
          { kind: 'screenshot', path: 'shot.png', captured_build_hash: 'abc' },
        ],
      },
    }
    const result = checkMilestoneArtifacts(doc, 'abc')
    expect(result.satisfied).toBe(true)
  })
})
