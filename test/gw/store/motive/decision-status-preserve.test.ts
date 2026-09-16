import { describe, it, expect } from 'vitest'
import { fromLegacyDecision } from '../../../../src/gw/store/motive/decision.js'

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    ts: '2026-09-16T10:00:00Z',
    motive: 'obsidian-native-groundwork',
    data: {
      id: 'D-35',
      decision: 'Use structure kind',
      rationale: 'Keeps decisions categorised',
      alternatives: [],
      ...overrides,
    },
  }
}

describe('fromLegacyDecision — status and kind preservation (S3-STATUS-PRESERVE)', () => {
  it('AC1: source status:"proposed" → converted status is "proposed"', () => {
    const result = fromLegacyDecision(makeEvent({ status: 'proposed' }))
    expect(result.status).toBe('proposed')
  })

  it('AC2: source status:"accepted" → converted status is "accepted"', () => {
    const result = fromLegacyDecision(makeEvent({ status: 'accepted' }))
    expect(result.status).toBe('accepted')
  })

  it('AC3: source with NO status field → defaults to "proposed", not "accepted"', () => {
    const ev = {
      ts: '2026-09-16T10:00:00Z',
      motive: 'obsidian-native-groundwork',
      data: {
        id: 'D-35',
        decision: 'Some decision',
        rationale: 'Some rationale',
        alternatives: [] as string[],
      },
    }
    const result = fromLegacyDecision(ev)
    expect(result.status).toBe('proposed')
    expect(result.status).not.toBe('accepted')
  })

  it('AC4: kind:"structure" survives conversion (D-35 realistic case)', () => {
    const result = fromLegacyDecision(makeEvent({ kind: 'structure' }))
    expect(result.kind).toBe('structure')
  })
})
