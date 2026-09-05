/**
 * Parity test: DECISION data.kind survives motive-compile's decision_log.
 *
 * Covers the append → compile → plan-review seam:
 *   - First-seen branch: kind is preserved
 *   - Update branch: kind is preserved on revision
 *   - No-kind append: kind is null, not undefined
 *   - alternatives.length is preserved
 *
 * Red proof: run against unmodified motive-compile.mjs (kind absent / undefined).
 * Green proof: run after adding `kind` to the first-seen, update, and legacy branches.
 */
// @ts-nocheck
import { describe, it, expect } from 'vitest'
import { compile } from '../hooks/lib/motive-compile.mjs'

const MOTIVE = 'test-decision-kind'

function makeDecisionEvent(opts: {
  id: string
  kind?: string
  alternatives?: string[]
  line?: number
  revises?: string
}) {
  const data: Record<string, unknown> = {
    id: opts.id,
    decision: `Decision text for ${opts.id}`,
    rationale: 'Rationale for test',
    alternatives: opts.alternatives ?? [],
  }
  if (opts.kind !== undefined) data.kind = opts.kind
  if (opts.revises !== undefined) data.revises = opts.revises
  return {
    type: 'DECISION',
    motive: MOTIVE,
    ts: `2026-09-05T00:00:0${opts.line ?? 0}.000Z`,
    msg: `Decision ${opts.id}`,
    data,
    _order: { shard: 'test.jsonl', line: opts.line ?? 0 },
  }
}

function makeGroundTruth() {
  return {
    head_sha: 'abc1234',
    branch: 'main',
    dirty_paths: [],
    existing_paths: {},
    ledger: {
      found: true,
      slices: [],
      gate: { advisor: { verdict: 'APPROVE' } },
    },
    collected_at: '2026-09-05T00:00:00.000Z',
  }
}

describe('DECISION data.kind survives compile() → decision_log', () => {
  it('kind "structure" appears in decision_log entry', () => {
    const events = [
      makeDecisionEvent({ id: 'D-1', kind: 'structure', alternatives: ['alt-a', 'alt-b'], line: 0 }),
      makeDecisionEvent({ id: 'D-2', kind: 'test-strategy', alternatives: [], line: 1 }),
      makeDecisionEvent({ id: 'D-3', line: 2 }), // no kind
    ]
    const view = compile(events, { groundTruth: makeGroundTruth() })
    const log: any[] = view.agent.decision_log

    const d1 = log.find((d: any) => d.id === 'D-1')
    const d2 = log.find((d: any) => d.id === 'D-2')
    const d3 = log.find((d: any) => d.id === 'D-3')

    expect(d1).toBeDefined()
    expect(d1.kind).toBe('structure')
    expect(d1.alternatives.length).toBeGreaterThanOrEqual(2)

    expect(d2).toBeDefined()
    expect(d2.kind).toBe('test-strategy')

    expect(d3).toBeDefined()
    // A decision appended without kind must expose kind: null (not undefined)
    expect(d3.kind).toBe(null)
    expect('kind' in d3).toBe(true)
  })

  it('kind is preserved on update/revise', () => {
    const events = [
      // First appearance without kind
      makeDecisionEvent({ id: 'D-4', alternatives: ['x'], line: 0 }),
      // Update supplies kind
      {
        type: 'DECISION',
        motive: MOTIVE,
        ts: '2026-09-05T00:00:01.000Z',
        msg: 'D-4 revised',
        data: {
          id: 'D-4',
          decision: 'Revised decision text',
          rationale: 'Revised rationale',
          kind: 'structure',
          revises: 'D-4',
        },
        _order: { shard: 'test.jsonl', line: 1 },
      },
    ]
    const view = compile(events, { groundTruth: makeGroundTruth() })
    const log: any[] = view.agent.decision_log
    const d4 = log.find((d: any) => d.id === 'D-4')
    expect(d4).toBeDefined()
    expect(d4.kind).toBe('structure')
  })
})
