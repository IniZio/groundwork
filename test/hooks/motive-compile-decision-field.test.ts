// @ts-nocheck — pure-JS .mjs targets; type assertions not required here
/**
 * motive-compile-decision-field.test.ts
 *
 * Regression test for ticket-04: DECISION event `decision` text is silently
 * dropped from the compiled decision_log when a `title` is also present.
 *
 * Fix: add a standalone `decision` field to the compiled entry, distinct from
 * `title`, so the verdict text survives regardless of whether `title` is set.
 *
 * Covers:
 *   - both-fields: decision text preserved when title AND decision are present
 *   - title-only: title field still works; decision field is null
 *   - decision-only: decision text promoted to title (existing fallback behaviour)
 */

import { describe, it, expect } from 'vitest'
import { compile } from '../../hooks/lib/motive-compile.mjs'

// ── helpers ───────────────────────────────────────────────────────────────

function decisionEvent(id: string, data: Record<string, unknown>) {
  return {
    type: 'DECISION',
    motive: 'test',
    ts: '2026-08-06T10:00:00.000Z',
    data: { id, status: 'accepted', rationale: 'r', ...data },
    _order: { shard: 'test.jsonl', line: 0 },
  }
}

function findEntry(view: any, id: string) {
  return view.agent.decision_log.find((d: any) => d.id === id)
}

// ── ticket-04 regression ──────────────────────────────────────────────────

describe('ticket-04 — decision field preserved through compile', () => {
  it('retains decision text when both title and decision are present (red→green)', () => {
    const events = [
      decisionEvent('D-99', {
        title: 'Human-facing label',
        decision: 'The explicit verdict sentence',
      }),
    ]
    const view = compile(events)
    const entry = findEntry(view, 'D-99')
    expect(entry).toBeDefined()
    // title must use the human-facing label (unchanged)
    expect(entry.title).toBe('Human-facing label')
    // decision must be independently preserved — this was the bug
    expect(entry.decision).toBe('The explicit verdict sentence')
  })

  it('title-only: title set, decision field is null', () => {
    const events = [
      decisionEvent('D-100', {
        title: 'Title only',
        // no decision field
      }),
    ]
    const view = compile(events)
    const entry = findEntry(view, 'D-100')
    expect(entry).toBeDefined()
    expect(entry.title).toBe('Title only')
    expect(entry.decision).toBeNull()
  })

  it('decision-only: decision text promoted to title (existing fallback), decision field set', () => {
    const events = [
      decisionEvent('D-101', {
        // no title — decision used as fallback
        decision: 'Verdict as title fallback',
      }),
    ]
    const view = compile(events)
    const entry = findEntry(view, 'D-101')
    expect(entry).toBeDefined()
    // existing fallback: decision text promoted to title when title absent
    expect(entry.title).toBe('Verdict as title fallback')
    // decision field also present
    expect(entry.decision).toBe('Verdict as title fallback')
  })

  it('decision field survives a merge update (second event with same id)', () => {
    const events = [
      decisionEvent('D-102', {
        title: 'Initial label',
        decision: 'Initial verdict',
        status: 'proposed',
      }),
      // Second event updates status and decision text
      {
        type: 'DECISION',
        motive: 'test',
        ts: '2026-08-06T11:00:00.000Z',
        data: {
          id: 'D-102',
          status: 'accepted',
          title: 'Updated label',
          decision: 'Updated verdict',
          rationale: 'r',
          revises: 'D-102',
        },
        _order: { shard: 'test.jsonl', line: 1 },
      },
    ]
    const view = compile(events)
    const entry = findEntry(view, 'D-102')
    expect(entry).toBeDefined()
    expect(entry.title).toBe('Updated label')
    expect(entry.decision).toBe('Updated verdict')
  })
})
