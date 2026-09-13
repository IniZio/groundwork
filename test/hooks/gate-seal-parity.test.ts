/**
 * gate-seal-parity.test.ts — Parity guard for canonicalReleaseState.
 * @verifies T20 (gate-seal fold unification)
 *
 * Asserts that the shared canonicalReleaseState function in hooks/lib/gate-seal.mjs
 * produces deterministic output across the full combination matrix of checkpoint_hold
 * and gate_phases. Also proves the bite: the old inlined divergent implementation
 * (checkpoint_hold-first, gate_phases-second, raw) gives a DIFFERENT string for the
 * combination case.
 */

import { describe, expect, it } from 'vitest'
import { canonicalReleaseState } from '../../hooks/lib/gate-seal.mjs'

// ---------------------------------------------------------------------------
// OLD divergent implementation — inlined verbatim for bite proof.
// ---------------------------------------------------------------------------

function canonicalReleaseState_OLD(ledger: Record<string, unknown>): string {
  const slices = Array.isArray(ledger.slices) ? (ledger.slices as Record<string, unknown>[]) : []
  const sortedSlices = slices
    .map(s => ({ id: String(s.id), status: String(s.status), created_by: (s as any).created_by ?? null }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const extractVerdict = (gate: unknown): string | null => {
    const a = (gate as Record<string, unknown>)?.advisor
    if (!a) return null
    if (typeof a === 'string') return a
    if (typeof a === 'object' && a !== null && 'verdict' in a) return String((a as Record<string, unknown>).verdict)
    return null
  }
  const state: Record<string, unknown> = {
    schema_version: ledger.schema_version ?? null,
    session_id: ledger.session_id ?? null,
    active: ledger.active ?? null,
    advisor_verdict: extractVerdict(ledger.gate),
    slices: sortedSlices,
  }
  if (ledger.checkpoint_hold !== undefined) {
    state.checkpoint_hold = ledger.checkpoint_hold
  }
  const gateForSeal = ledger.gate as Record<string, unknown> | undefined
  if (gateForSeal?.phases !== undefined) {
    state.gate_phases = gateForSeal.phases
  }
  return JSON.stringify(state)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_LEDGER = {
  schema_version: 1,
  session_id: 'test-sess',
  active: true,
  slices: [] as unknown[],
}

describe('canonicalReleaseState parity', () => {
  describe('bite proof — pre-fix divergence', () => {
    it('OLD implementation gives different string than shared when both checkpoint_hold and gate_phases are present', () => {
      const ledger = {
        ...BASE_LEDGER,
        checkpoint_hold: 'wave-1',
        gate: {
          phases: {
            'phase-a': { deliverable: 'impl', tier: 'advisory' },
          },
        },
      }
      const shared = canonicalReleaseState(ledger)
      const old = canonicalReleaseState_OLD(ledger)
      expect(shared).not.toBe(old)
    })
  })

  describe('shared implementation — combination matrix', () => {
    it('neither checkpoint_hold nor gate_phases — stable output', () => {
      const ledger = { ...BASE_LEDGER }
      const result = canonicalReleaseState(ledger)
      const parsed = JSON.parse(result) as Record<string, unknown>
      expect(parsed).not.toHaveProperty('checkpoint_hold')
      expect(parsed).not.toHaveProperty('gate_phases')
      expect(canonicalReleaseState(ledger)).toBe(result)
    })

    it('checkpoint_hold alone — included after other optional fields', () => {
      const ledger = { ...BASE_LEDGER, checkpoint_hold: 'wave-1' }
      const result = canonicalReleaseState(ledger)
      const parsed = JSON.parse(result) as Record<string, unknown>
      expect(parsed).toHaveProperty('checkpoint_hold', 'wave-1')
      expect(parsed).not.toHaveProperty('gate_phases')
    })

    it('gate_phases alone — includes normalized gate_phases', () => {
      const ledger = {
        ...BASE_LEDGER,
        gate: {
          phases: {
            'phase-b': { deliverable: 'review', tier: 'blocking', verdict: 'APPROVE' },
          },
        },
      }
      const result = canonicalReleaseState(ledger)
      const parsed = JSON.parse(result) as Record<string, unknown>
      expect(parsed).toHaveProperty('gate_phases')
      expect(parsed).not.toHaveProperty('checkpoint_hold')
      const phases = parsed.gate_phases as Record<string, Record<string, unknown>>
      expect(phases['phase-b']).toMatchObject({
        deliverable: 'review',
        tier: 'blocking',
        verdict: 'APPROVE',
        verified_by: null,
        verified_at: null,
      })
    })

    it('BOTH checkpoint_hold AND gate_phases — gate_phases BEFORE checkpoint_hold', () => {
      const ledger = {
        ...BASE_LEDGER,
        checkpoint_hold: 'wave-2',
        gate: {
          phases: {
            'phase-a': { deliverable: 'impl', tier: 'advisory' },
          },
        },
      }
      const result = canonicalReleaseState(ledger)
      const parsed = JSON.parse(result) as Record<string, unknown>
      const keys = Object.keys(parsed)
      const gpIdx = keys.indexOf('gate_phases')
      const chIdx = keys.indexOf('checkpoint_hold')
      expect(gpIdx).toBeGreaterThanOrEqual(0)
      expect(chIdx).toBeGreaterThanOrEqual(0)
      expect(gpIdx).toBeLessThan(chIdx)
    })

    it('checkpoint_hold coerced to string — numeric value becomes string', () => {
      const ledger = { ...BASE_LEDGER, checkpoint_hold: 42 }
      const result = canonicalReleaseState(ledger)
      const parsed = JSON.parse(result) as Record<string, unknown>
      expect(parsed.checkpoint_hold).toBe('42')
      expect(typeof parsed.checkpoint_hold).toBe('string')
    })

    it('gate_phases normalized — string coercion, sorted keys, null for absent optional fields', () => {
      const ledger = {
        ...BASE_LEDGER,
        gate: {
          phases: {
            'z-phase': { deliverable: 'z-work', tier: 'blocking' },
            'a-phase': { deliverable: 'a-work', tier: 'advisory', verdict: 'APPROVE', verified_by: 'agent', verified_at: '2026-09-13' },
          },
        },
      }
      const result = canonicalReleaseState(ledger)
      const parsed = JSON.parse(result) as Record<string, unknown>
      const phases = parsed.gate_phases as Record<string, Record<string, unknown>>
      expect(Object.keys(phases)).toEqual(['a-phase', 'z-phase'])
      expect(phases['a-phase']).toEqual({
        deliverable: 'a-work',
        tier: 'advisory',
        verdict: 'APPROVE',
        verified_by: 'agent',
        verified_at: '2026-09-13',
      })
      expect(phases['z-phase']).toEqual({
        deliverable: 'z-work',
        tier: 'blocking',
        verdict: null,
        verified_by: null,
        verified_at: null,
      })
    })

    it('idempotent — same ledger produces byte-identical string on repeated calls', () => {
      const ledger = {
        ...BASE_LEDGER,
        checkpoint_hold: 'wave-1',
        gate: {
          phases: {
            'phase-a': { deliverable: 'impl', tier: 'advisory' },
            'phase-b': { deliverable: 'review', tier: 'blocking', verdict: 'APPROVE' },
          },
        },
      }
      const r1 = canonicalReleaseState(ledger)
      const r2 = canonicalReleaseState(ledger)
      const r3 = canonicalReleaseState(ledger)
      expect(r1).toBe(r2)
      expect(r2).toBe(r3)
    })
  })
})
