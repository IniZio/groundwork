/**
 * Tests for hooks/lib/pacing.mjs — session-pacing policy engine.
 *
 * Pure unit tests: plain object fixtures, no filesystem, no process mocks.
 * Covers all 12 acceptance criteria from the pace-lib ledger slice.
 *
 * AC reference (from D-28 / D-29 / task brief):
 *  AC-1  absent pacing → everything allowed (back-compat)
 *  AC-2  resolveUnit returns wave for policy=wave, sliceId for policy=slice
 *  AC-3  resolvedUnits counts only units where ALL non-exempt slices are complete
 *  AC-4  inFlightUnit returns lowest-numbered unit with incomplete non-exempt work
 *  AC-5  claims into in-flight unit are always allowed
 *  AC-6  entering a NEW unit requires resolvedUnits < budget + grant.range
 *  AC-7  grant.range extends the cap; absent grant → range=0
 *  AC-8  exempt kinds never count toward resolution or budget
 *  AC-9  checkPace returns {allowed,reason,remedy} with informative strings on block
 *  AC-10 isExhausted is false when in-flight unit exists
 *  AC-11 isExhausted is true when all budget consumed and remaining non-exempt work
 *  AC-12 policy=slice treats each non-exempt slice as its own unit
 */

// @verifies PACING-R-001
// @verifies PACING-R-002

import { describe, it, expect } from 'vitest'
import {
  resolveUnit,
  resolvedUnits,
  inFlightUnit,
  isExhausted,
  checkPace,
} from '../../hooks/lib/pacing.mjs'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeSlice(
  id: string,
  wave: number,
  kind: string,
  status: 'pending' | 'in_progress' | 'complete',
) {
  return { id, wave, kind, status }
}

function makePacing(
  policy: 'wave' | 'slice',
  budget: number,
  exemptKinds: string[] = [],
  grant?: { range: number; granted_at: string; granted_by: string; reason: string },
) {
  return { policy, budget, exempt_kinds: exemptKinds, ...(grant ? { grant } : {}) }
}

// ---------------------------------------------------------------------------
// AC-1: absent pacing → everything allowed
// ---------------------------------------------------------------------------
describe('AC-1: absent pacing → back-compat allow-all', () => {
  const doc = { slices: [makeSlice('S1', 0, 'impl', 'pending')] }

  it('checkPace allows when pacing is absent', () => {
    expect(checkPace(doc, 'S1')).toEqual({ allowed: true })
  })

  it('resolvedUnits returns 0 when pacing is absent', () => {
    expect(resolvedUnits(doc)).toBe(0)
  })

  it('inFlightUnit returns null when pacing is absent', () => {
    expect(inFlightUnit(doc)).toBeNull()
  })

  it('isExhausted returns false when pacing is absent', () => {
    expect(isExhausted(doc)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AC-2: resolveUnit returns correct unit per policy
// ---------------------------------------------------------------------------
describe('AC-2: resolveUnit returns wave (policy=wave) or sliceId (policy=slice)', () => {
  const slices = [makeSlice('S1', 2, 'impl', 'pending'), makeSlice('S2', 3, 'impl', 'pending')]

  it('returns wave number for policy=wave', () => {
    const doc = { pacing: makePacing('wave', 2), slices }
    expect(resolveUnit(doc, 'S1')).toBe(2)
    expect(resolveUnit(doc, 'S2')).toBe(3)
  })

  it('returns slice id for policy=slice', () => {
    const doc = { pacing: makePacing('slice', 2), slices }
    expect(resolveUnit(doc, 'S1')).toBe('S1')
    expect(resolveUnit(doc, 'S2')).toBe('S2')
  })

  it('returns null for unknown slice id', () => {
    const doc = { pacing: makePacing('wave', 2), slices }
    expect(resolveUnit(doc, 'UNKNOWN')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AC-3: resolvedUnits counts units where ALL non-exempt slices are complete
// ---------------------------------------------------------------------------
describe('AC-3: resolvedUnits counts fully-resolved units', () => {
  it('wave with all non-exempt complete → counted', () => {
    const doc = {
      pacing: makePacing('wave', 3),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 0, 'impl', 'complete'),
        makeSlice('S3', 1, 'impl', 'pending'),
      ],
    }
    expect(resolvedUnits(doc)).toBe(1) // wave 0 resolved; wave 1 not
  })

  it('partial completion does not count the wave', () => {
    const doc = {
      pacing: makePacing('wave', 3),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 0, 'impl', 'pending'),
      ],
    }
    expect(resolvedUnits(doc)).toBe(0)
  })

  it('policy=slice: each complete non-exempt slice is one resolved unit', () => {
    const doc = {
      pacing: makePacing('slice', 5),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 0, 'impl', 'complete'),
        makeSlice('S3', 0, 'impl', 'pending'),
      ],
    }
    expect(resolvedUnits(doc)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// AC-4: inFlightUnit returns lowest-numbered unit with incomplete non-exempt work
// ---------------------------------------------------------------------------
describe('AC-4: inFlightUnit returns lowest incomplete unit', () => {
  it('returns lowest wave with incomplete non-exempt slice', () => {
    const doc = {
      pacing: makePacing('wave', 3),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 1, 'impl', 'pending'),
        makeSlice('S3', 2, 'impl', 'pending'),
      ],
    }
    expect(inFlightUnit(doc)).toBe(1)
  })

  it('returns null when all non-exempt slices are complete', () => {
    const doc = {
      pacing: makePacing('wave', 3),
      slices: [makeSlice('S1', 0, 'impl', 'complete')],
    }
    expect(inFlightUnit(doc)).toBeNull()
  })

  it('policy=slice: returns id of first incomplete non-exempt slice', () => {
    const doc = {
      pacing: makePacing('slice', 5),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 0, 'impl', 'pending'),
        makeSlice('S3', 0, 'impl', 'pending'),
      ],
    }
    expect(inFlightUnit(doc)).toBe('S2')
  })
})

// ---------------------------------------------------------------------------
// AC-5: claims into in-flight unit are always allowed
// ---------------------------------------------------------------------------
describe('AC-5: in-flight unit claims are always allowed', () => {
  it('allows claim into in-flight wave even when budget at cap', () => {
    // Wave 0 resolved; wave 1 is in-flight (budget=1 so cap reached)
    const doc = {
      pacing: makePacing('wave', 1),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 1, 'impl', 'pending'),
        makeSlice('S3', 1, 'impl', 'in_progress'),
      ],
    }
    // S2 and S3 are both in wave 1 (in-flight) — both must be allowed
    expect(checkPace(doc, 'S2').allowed).toBe(true)
    expect(checkPace(doc, 'S3').allowed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC-6: new unit requires resolvedUnits < budget + grant.range
// ---------------------------------------------------------------------------
describe('AC-6: new unit blocked when budget consumed', () => {
  it('blocks a new wave when budget=1 and one wave already resolved', () => {
    const doc = {
      pacing: makePacing('wave', 1),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 1, 'impl', 'pending'),
      ],
    }
    const result = checkPace(doc, 'S2')
    expect(result.allowed).toBe(false)
  })

  it('allows new wave when resolvedUnits < budget', () => {
    const doc = {
      pacing: makePacing('wave', 2),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 1, 'impl', 'pending'),
      ],
    }
    expect(checkPace(doc, 'S2').allowed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC-7: grant.range extends the cap
// ---------------------------------------------------------------------------
describe('AC-7: grant.range extends budget cap', () => {
  const grant = { range: 2, granted_at: '2026-08-01T00:00:00Z', granted_by: 'human', reason: 'test' }

  it('allows new unit when resolvedUnits < budget + grant.range', () => {
    // budget=1, grant.range=2 → cap=3; one wave resolved → cap not reached
    const doc = {
      pacing: makePacing('wave', 1, [], grant),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 1, 'impl', 'pending'),
      ],
    }
    expect(checkPace(doc, 'S2').allowed).toBe(true)
  })

  it('blocks once resolvedUnits reaches budget + grant.range', () => {
    // budget=1, grant.range=1 → cap=2; two waves resolved
    const doc = {
      pacing: makePacing('wave', 1, [], { ...grant, range: 1 }),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 1, 'impl', 'complete'),
        makeSlice('S3', 2, 'impl', 'pending'),
      ],
    }
    const result = checkPace(doc, 'S3')
    expect(result.allowed).toBe(false)
  })

  it('absent grant defaults to range=0', () => {
    // budget=1, no grant → cap=1; one resolved wave → blocked
    const doc = {
      pacing: makePacing('wave', 1),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 1, 'impl', 'pending'),
      ],
    }
    expect(checkPace(doc, 'S2').allowed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AC-8: exempt kinds never count toward resolution or budget
// ---------------------------------------------------------------------------
describe('AC-8: exempt kinds are invisible to the pacing engine', () => {
  it('exempt slices in a wave do not block wave resolution', () => {
    // Wave 0: one impl (complete) + one plan (exempt, pending) → wave 0 resolved
    const doc = {
      pacing: makePacing('wave', 1, ['plan']),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 0, 'plan', 'pending'), // exempt
      ],
    }
    expect(resolvedUnits(doc)).toBe(1)
  })

  it('exempt slices are always claimable regardless of budget', () => {
    // Budget exhausted (wave 0 resolved, budget=1)
    const doc = {
      pacing: makePacing('wave', 1, ['plan']),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('plan-1', 1, 'plan', 'pending'), // exempt
      ],
    }
    expect(checkPace(doc, 'plan-1').allowed).toBe(true)
  })

  it('exempt slices are not counted by resolvedUnits (policy=slice)', () => {
    const doc = {
      pacing: makePacing('slice', 5, ['diagnose']),
      slices: [
        makeSlice('D1', 0, 'diagnose', 'complete'), // exempt — not counted
        makeSlice('S1', 0, 'impl', 'complete'),
      ],
    }
    expect(resolvedUnits(doc)).toBe(1) // only S1 counts
  })
})

// ---------------------------------------------------------------------------
// AC-9: checkPace reason/remedy are informative when blocked
// ---------------------------------------------------------------------------
describe('AC-9: blocked reason and remedy are informative', () => {
  it('reason names budget consumed and refused unit', () => {
    const doc = {
      pacing: makePacing('wave', 1),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 1, 'impl', 'pending'),
      ],
    }
    const result = checkPace(doc, 'S2')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/budget/)
    expect(result.reason).toMatch(/consumed/)
    expect(result.reason).toMatch(/wave 1/)
  })

  it('remedy mentions autopilot and pause', () => {
    const doc = {
      pacing: makePacing('wave', 1),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 1, 'impl', 'pending'),
      ],
    }
    const result = checkPace(doc, 'S2')
    expect(result.remedy).toMatch(/autopilot/)
    expect(result.remedy).toMatch(/pause/)
  })

  it('reason names slice id for policy=slice', () => {
    const doc = {
      pacing: makePacing('slice', 1),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 0, 'impl', 'pending'),
      ],
    }
    const result = checkPace(doc, 'S2')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/"S2"/)
  })
})

// ---------------------------------------------------------------------------
// AC-10: isExhausted is false when in-flight unit exists
// ---------------------------------------------------------------------------
describe('AC-10: isExhausted false while in-flight unit exists', () => {
  it('not exhausted when work is actively in_progress in a unit', () => {
    const doc = {
      pacing: makePacing('wave', 1),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 1, 'impl', 'in_progress'), // actively claimed
      ],
    }
    // budget=1, wave 0 resolved — budget at cap, BUT wave 1 is actively being worked
    expect(isExhausted(doc)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AC-11: isExhausted true when budget consumed and remaining non-exempt work
// ---------------------------------------------------------------------------
describe('AC-11: isExhausted true when no claimable unit remains', () => {
  it('exhausted when all budget consumed, nothing in_progress, future slices pending', () => {
    const doc = {
      pacing: makePacing('wave', 1),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        // wave 1 not yet started (no in_progress) and budget is consumed
        makeSlice('S2', 1, 'impl', 'pending'),
      ],
    }
    expect(isExhausted(doc)).toBe(true)
  })

  it('not exhausted when budget still available', () => {
    const doc = {
      pacing: makePacing('wave', 2),
      slices: [
        makeSlice('S1', 0, 'impl', 'complete'),
        makeSlice('S2', 1, 'impl', 'pending'),
      ],
    }
    expect(isExhausted(doc)).toBe(false)
  })

  it('not exhausted when all non-exempt slices complete (nothing remaining)', () => {
    const doc = {
      pacing: makePacing('wave', 1),
      slices: [makeSlice('S1', 0, 'impl', 'complete')],
    }
    expect(isExhausted(doc)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AC-12: policy=slice treats each non-exempt slice as its own unit
// ---------------------------------------------------------------------------
describe('AC-12: policy=slice unit granularity', () => {
  it('each non-exempt slice in same wave is a separate unit', () => {
    const doc = {
      pacing: makePacing('slice', 2),
      slices: [
        makeSlice('A', 0, 'impl', 'complete'), // unit A resolved
        makeSlice('B', 0, 'impl', 'complete'), // unit B resolved
        makeSlice('C', 0, 'impl', 'pending'),  // unit C → new unit
      ],
    }
    // budget=2, resolvedUnits=2 → cap reached; C must be blocked
    const result = checkPace(doc, 'C')
    expect(result.allowed).toBe(false)
  })

  it('in-flight slice unit is still claimable (itself is in-flight)', () => {
    const doc = {
      pacing: makePacing('slice', 1),
      slices: [
        makeSlice('A', 0, 'impl', 'complete'),  // resolved
        makeSlice('B', 0, 'impl', 'in_progress'), // in-flight unit
      ],
    }
    // B is in-flight → claiming B is always free
    expect(checkPace(doc, 'B').allowed).toBe(true)
  })
})
