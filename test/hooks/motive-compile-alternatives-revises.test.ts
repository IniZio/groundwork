// @ts-nocheck — pure-JS .mjs targets; type assertions not required here
/**
 * motive-compile-alternatives-revises.test.ts
 *
 * Regression tests for two changes to hooks/lib/motive-compile.mjs:
 *   Change A — alternatives field present on keyed (id-bearing) decision entries
 *   Change B — revises field marks same-id merges intentional; unmarked collisions flagged
 */

import { describe, it, expect } from 'vitest'
import { compile } from '../../hooks/lib/motive-compile.mjs'

// ── helpers ───────────────────────────────────────────────────────────────

function decisionEvent(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'DECISION',
    motive: 'test',
    ts: '2026-08-04T10:00:00.000Z',
    data: { id, status, title: `Decision ${id}`, ...extra },
    _order: { shard: 'test.jsonl', line: 0 },
  }
}

// ── Change A: alternatives on first-seen keyed entry ──────────────────────

describe('Change A — alternatives on keyed entries', () => {
  it('alternatives is present and populated when the event carries it', () => {
    const alts = [{ option: 'Option A', ruled_out_because: 'too slow' }]
    const events = [decisionEvent('D1', 'accepted', { alternatives: alts })]
    const view = compile(events)
    const entry = view.agent.decision_log.find((d: any) => d.id === 'D1')
    expect(entry).toBeDefined()
    expect(entry.alternatives).toEqual(alts)
  })

  it('alternatives defaults to [] when the event omits it', () => {
    const events = [decisionEvent('D1', 'proposed')]
    const view = compile(events)
    const entry = view.agent.decision_log.find((d: any) => d.id === 'D1')
    expect(entry).toBeDefined()
    expect(entry.alternatives).toEqual([])
  })

  it('alternatives is an array, not undefined or null', () => {
    const events = [decisionEvent('D2', 'accepted')]
    const view = compile(events)
    const entry = view.agent.decision_log[0]
    expect(Array.isArray(entry.alternatives)).toBe(true)
  })

  it('alternatives is populated on same-id merge when later event provides it', () => {
    const alts = [{ option: 'Alt B', ruled_out_because: 'risky' }]
    const events = [
      decisionEvent('D3', 'proposed'),              // first-seen: no alternatives
      decisionEvent('D3', 'accepted', { alternatives: alts }), // merge: provides alternatives
    ]
    const view = compile(events)
    const entry = view.agent.decision_log.find((d: any) => d.id === 'D3')
    expect(entry.alternatives).toEqual(alts)
  })

  it('merge event omitting alternatives does NOT clobber prior value', () => {
    const alts = [{ option: 'Keep me', ruled_out_because: 'already correct' }]
    const events = [
      decisionEvent('D4', 'proposed', { alternatives: alts }), // first-seen: has alternatives
      decisionEvent('D4', 'accepted'),                          // merge: no alternatives
    ]
    const view = compile(events)
    const entry = view.agent.decision_log.find((d: any) => d.id === 'D4')
    expect(entry.alternatives).toEqual(alts)
    expect(entry.status).toBe('accepted')
  })

  it('legacy (id-less) decisions still carry alternatives as before', () => {
    const alts = [{ option: 'Legacy alt', ruled_out_because: 'old path' }]
    const events = [
      {
        type: 'DECISION',
        motive: 'test',
        ts: '2026-08-04T10:00:00.000Z',
        data: { decision: 'no id decision', rationale: 'reason', alternatives: alts },
        _order: { shard: 'test.jsonl', line: 0 },
      },
    ]
    const view = compile(events)
    expect(view.agent.decisions).toHaveLength(1)
    expect(view.agent.decisions[0].alternatives).toEqual(alts)
  })
})

// ── Change B: revises field and unmarked collision detection ──────────────

describe('Change B — revises and unmarked_collision', () => {
  it('single-event keyed entry has no unmarked_collision flag', () => {
    const events = [decisionEvent('D5', 'accepted')]
    const view = compile(events)
    const entry = view.agent.decision_log.find((d: any) => d.id === 'D5')
    expect(entry.unmarked_collision).toBeUndefined()
  })

  it('same-id merge without revises sets unmarked_collision: true', () => {
    const events = [
      decisionEvent('D6', 'proposed'),
      decisionEvent('D6', 'accepted'),
    ]
    const view = compile(events)
    const entry = view.agent.decision_log.find((d: any) => d.id === 'D6')
    expect(entry.unmarked_collision).toBe(true)
  })

  it('same-id merge with revises === id clears the collision flag', () => {
    const events = [
      decisionEvent('D7', 'proposed'),
      decisionEvent('D7', 'accepted', { revises: 'D7' }),
    ]
    const view = compile(events)
    const entry = view.agent.decision_log.find((d: any) => d.id === 'D7')
    expect(entry.unmarked_collision).toBeUndefined()
  })

  it('same-id merge with revises pointing to a DIFFERENT id still sets unmarked_collision: true', () => {
    // Regression: a bare truthy check would suppress the flag here, silently defeating the signal.
    const events = [
      decisionEvent('D8', 'proposed'),
      decisionEvent('D8', 'accepted', { revises: 'D-999' }), // revises !== 'D8'
    ]
    const view = compile(events)
    const entry = view.agent.decision_log.find((d: any) => d.id === 'D8')
    expect(entry.unmarked_collision).toBe(true)
  })

  it('revises on merge event is recorded on the compiled entry', () => {
    const events = [
      decisionEvent('D8b', 'proposed'),
      decisionEvent('D8b', 'accepted', { revises: 'D8b' }),
    ]
    const view = compile(events)
    const entry = view.agent.decision_log.find((d: any) => d.id === 'D8b')
    expect(entry.revises).toBe('D8b')
  })

  it('three-event revises-marked merge: last non-null fields win, no collision flag', () => {
    const events = [
      decisionEvent('D9', 'proposed', { rationale: 'initial' }),
      decisionEvent('D9', 'accepted', { revises: 'D9', rationale: 'revised rationale' }),
      decisionEvent('D9', 'accepted', { revises: 'D9', rationale: 'final rationale' }),
    ]
    const view = compile(events)
    const entry = view.agent.decision_log.find((d: any) => d.id === 'D9')
    expect(entry.status).toBe('accepted')
    expect(entry.rationale).toBe('final rationale')
    expect(entry.unmarked_collision).toBeUndefined()
  })

  it('different-id supersedes keeps two entries and sets no collision flag on either', () => {
    const events = [
      decisionEvent('D10', 'accepted'),
      decisionEvent('D11', 'accepted', { supersedes: 'D10' }),
    ]
    const view = compile(events)
    const log = view.agent.decision_log
    expect(log).toHaveLength(2)
    const d10 = log.find((d: any) => d.id === 'D10')
    const d11 = log.find((d: any) => d.id === 'D11')
    expect(d10.status).toBe('superseded')
    expect(d10.superseded_by).toBe('D11')
    expect(d10.unmarked_collision).toBeUndefined()
    expect(d11.supersedes).toBe('D10')
    expect(d11.unmarked_collision).toBeUndefined()
  })

  it('existing S2-AC1 invariant preserved: proposed→accepted still yields one entry with status accepted', () => {
    // The collision flag is informational; it must not change the merge result.
    const events = [
      decisionEvent('D1', 'proposed'),
      decisionEvent('D1', 'accepted'),
    ]
    const view = compile(events)
    expect(view.agent.decision_log).toHaveLength(1)
    expect(view.agent.decision_log[0].id).toBe('D1')
    expect(view.agent.decision_log[0].status).toBe('accepted')
  })
})
