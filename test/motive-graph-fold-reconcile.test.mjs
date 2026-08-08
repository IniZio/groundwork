/**
 * motive-graph-fold-reconcile.test.mjs — S2 reconciliation completeness.
 *
 * Verifies:
 *   S2-AC1: all 18 VALID_TYPES have an explicit handler + CONSUMED_FIELDS entry;
 *           each handler produces an observable delta (not merely no-throw).
 *   S2-AC2: field-level losslessness (CONSUMED_FIELDS ⊇ corpus fields) across
 *           all 5 real motive streams.
 *   S2-AC3: synthetic fixture events for the 8 types absent from all 5 real
 *           streams fold losslessly and produce observable attrs entries.
 *
 * Run: npx vitest run test/motive-graph-fold-reconcile.test.mjs
 */

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readOrderedEvents } from '../hooks/lib/journal-order.mjs'
import { assembleGraphFold, CONSUMED_FIELDS } from '../hooks/lib/motive-graph-fold.mjs'
import { VALID_TYPES } from '../hooks/lib/journal-io.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const JOURNAL_DIR = path.join(ROOT, '.groundwork', 'journal')

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Return (type, field) pairs present in events but absent from CONSUMED_FIELDS.
 * @param {object[]} events
 * @returns {{type:string, field:string, ts:string}[]}
 */
function collectLosses(events) {
  const losses = []
  for (const event of events) {
    if (!VALID_TYPES.includes(event.type)) continue
    const dataFields = event.data ? Object.keys(event.data) : []
    const consumed = CONSUMED_FIELDS[event.type] ?? new Set()
    for (const field of dataFields) {
      if (!consumed.has(field)) {
        losses.push({ type: event.type, field, ts: event.ts })
      }
    }
  }
  return losses
}

/** Build a one-shot event stream: MOTIVE_CREATED + one typed event. */
function makeStream(type, data = {}) {
  return [
    {
      type: 'MOTIVE_CREATED',
      motive: 'test',
      ts: '2026-01-01T00:00:00.000Z',
      data: { objective: 'test' },
    },
    {
      type,
      motive: 'test',
      ts: '2026-01-01T00:00:01.000Z',
      data,
    },
  ]
}

// ── S2-AC1: all 18 VALID_TYPES have declared roles ────────────────────────

describe('S2-AC1 — all 18 VALID_TYPES have declared roles', () => {
  it('CONSUMED_FIELDS has an entry for every VALID_TYPE', () => {
    for (const type of VALID_TYPES) {
      expect(
        Object.prototype.hasOwnProperty.call(CONSUMED_FIELDS, type),
        `CONSUMED_FIELDS is missing an entry for VALID_TYPE "${type}"`
      ).toBe(true)
    }
  })

  // Observable-delta checks — for each type, fold a minimal stream and assert
  // the event produced a concrete graph change.  This bites when a handler is
  // missing or unwired: the fold silently no-ops and the assertion fails.
  const deltaChecks = {
    MOTIVE_CREATED:   (fold) => expect(fold.nodes.find((n) => n.id === 'objective:root')).toBeDefined(),
    DECISION:         (fold) => expect(fold.nodes.some((n) => n.type === 'decision')).toBe(true),
    BASELINE:         (fold) => expect(fold.nodes.some((n) => n.type === 'baseline')).toBe(true),
    AC_COVERAGE:      (fold) => expect(fold.edges.some((e) => e.kind === 'covers_ac')).toBe(true),
    GATE:             (fold) => expect(fold.attrs.gates.length).toBeGreaterThan(0),
    MILESTONE:        (fold) => expect(fold.attrs.milestones.length).toBeGreaterThan(0),
    TASK_COMPLETE:    (fold) => expect(fold.nodes.some((n) => n.type === 'slice')).toBe(true),
    SESSION_END:      (fold) => expect(fold.attrs.sessions.length).toBeGreaterThan(0),
    VERIFICATION:     (fold) => expect(fold.attrs.verifications.length).toBeGreaterThan(0),
    PAUSE:            (fold) => expect(fold.attrs.pauses.length).toBeGreaterThan(0),
    SESSION_START:    (fold) => expect(fold.attrs.session_starts.length).toBeGreaterThan(0),
    SPEC_CHANGE:      (fold) => expect(fold.attrs.spec_changes.length).toBeGreaterThan(0),
    LINT_DRIFT:       (fold) => expect(fold.attrs.lint_drifts.length).toBeGreaterThan(0),
    PROTOTYPE_RESULT: (fold) => expect(fold.attrs.prototype_results.length).toBeGreaterThan(0),
    FAILURE:          (fold) => expect(fold.attrs.failures.length).toBeGreaterThan(0),
    WAIVER:           (fold) => expect(fold.attrs.waivers.length).toBeGreaterThan(0),
    HANDOFF:          (fold) => expect(fold.attrs.handoffs.length).toBeGreaterThan(0),
    SPEC_DRIFT:       (fold) => expect(fold.attrs.spec_drifts.length).toBeGreaterThan(0),
  }

  // Minimal payloads that trigger the observable output for each type.
  const minimalPayloads = {
    MOTIVE_CREATED:   { objective: 'test' },
    DECISION:         { id: 'D-1', title: 'test decision' },
    BASELINE:         { name: 'v1', shard: 'shard-001' },
    AC_COVERAGE:      { ac: 'AC1', slice: 'S1' },
    GATE:             { verdict: 'APPROVE', which: 'advisor' },
    MILESTONE:        { id: 'M1', items: [] },
    TASK_COMPLETE:    { slice: 'S1' },
    SESSION_END:      { outcome: 'done' },
    VERIFICATION:     { overall: 'pass', mode: 'manual' },
    PAUSE:            { pointer: 'step-1', summary: 'paused' },
    SESSION_START:    { session_id: 'sess-001' },
    SPEC_CHANGE:      { file: 'doc/specs/foo.md', change: 'added' },
    LINT_DRIFT:       { node_id: 'decision:D-1', invariant: 'no-orphan' },
    PROTOTYPE_RESULT: { prototype: 'graph-layout', outcome: 'viable' },
    FAILURE:          { kind: 'test', slices: ['S1'] },
    WAIVER:           { ac: 'AC1', reason: 'out-of-scope' },
    HANDOFF:          { to: 'human', summary: 'review needed' },
    SPEC_DRIFT:       { spec_id: 'R-001', drift: 'undocumented change' },
  }

  for (const type of VALID_TYPES) {
    it(`${type} handler produces an observable delta`, () => {
      const payload = minimalPayloads[type] ?? {}
      // For MOTIVE_CREATED the stream IS the payload; re-build so root node is created.
      const stream =
        type === 'MOTIVE_CREATED'
          ? [{ type: 'MOTIVE_CREATED', motive: 'test', ts: '2026-01-01T00:00:00.000Z', data: payload }]
          : makeStream(type, payload)
      const fold = assembleGraphFold(stream)
      const check = deltaChecks[type]
      if (check) check(fold)
    })
  }
})

// ── S2-AC2: losslessness across all 5 real motives ────────────────────────

describe('S2-AC2 — field-level losslessness across 5 real motive streams', () => {
  const REAL_MOTIVES = [
    'codify-motive-dag',
    'graph-authoring',
    'graph-pilot',
    'groundwork-development',
    'sealed-gate',
  ]

  for (const slug of REAL_MOTIVES) {
    it(`${slug} folds losslessly`, () => {
      const { events } = readOrderedEvents(JOURNAL_DIR, { motive: slug })
      expect(events.length).toBeGreaterThan(0)
      const losses = collectLosses(events)
      if (losses.length > 0) {
        const named = losses.map((l) => `${l.type}.${l.field} (at ${l.ts})`).join('\n  ')
        expect.fail(`Named field losses in ${slug}:\n  ${named}`)
      }
      expect(losses).toHaveLength(0)
    })
  }
})

// ── S2-AC3: synthetic fixtures for the 8 real-stream-absent types ─────────

/**
 * The 8 event types absent from all 5 existing motive streams.
 * Each is exercised by a hand-authored synthetic fixture event below.
 */
const ABSENT_TYPES = [
  'SPEC_CHANGE',
  'LINT_DRIFT',
  'PROTOTYPE_RESULT',
  'FAILURE',
  'WAIVER',
  'HANDOFF',
  'SESSION_START',
  'SPEC_DRIFT',
]

/** Minimal synthetic stream: MOTIVE_CREATED + one event per absent type. */
const SYNTHETIC_STREAM = [
  {
    type: 'MOTIVE_CREATED',
    motive: 'synth-test',
    ts: '2026-01-01T00:00:00.000Z',
    data: { objective: 'synthetic fixture motive' },
  },
  {
    type: 'SPEC_CHANGE',
    motive: 'synth-test',
    ts: '2026-01-01T00:01:00.000Z',
    data: { file: 'doc/specs/foo.md', change: 'added requirement' },
  },
  {
    type: 'LINT_DRIFT',
    motive: 'synth-test',
    ts: '2026-01-01T00:02:00.000Z',
    data: { node_id: 'decision:D-1', invariant: 'no-orphan' },
  },
  {
    type: 'PROTOTYPE_RESULT',
    motive: 'synth-test',
    ts: '2026-01-01T00:03:00.000Z',
    data: { prototype: 'graph-layout', outcome: 'viable' },
  },
  {
    type: 'FAILURE',
    motive: 'synth-test',
    ts: '2026-01-01T00:04:00.000Z',
    data: { kind: 'test', slices: ['S1'] },
  },
  {
    type: 'WAIVER',
    motive: 'synth-test',
    ts: '2026-01-01T00:05:00.000Z',
    data: { ac: 'AC1', reason: 'out-of-scope' },
  },
  {
    type: 'HANDOFF',
    motive: 'synth-test',
    ts: '2026-01-01T00:06:00.000Z',
    data: { to: 'human', summary: 'review needed' },
  },
  {
    type: 'SESSION_START',
    motive: 'synth-test',
    ts: '2026-01-01T00:07:00.000Z',
    data: { session_id: 'sess-001' },
  },
  {
    type: 'SPEC_DRIFT',
    motive: 'synth-test',
    ts: '2026-01-01T00:08:00.000Z',
    data: { spec_id: 'R-001', drift: 'undocumented change' },
  },
]

describe('S2-AC3 — synthetic fixtures for 8 real-stream-absent types', () => {
  it('all 8 absent types have synthetic fixture events', () => {
    const synthTypes = new Set(SYNTHETIC_STREAM.map((e) => e.type))
    for (const type of ABSENT_TYPES) {
      expect(synthTypes.has(type), `No synthetic fixture for absent type "${type}"`).toBe(true)
    }
  })

  it('synthetic stream folds without throwing', () => {
    expect(() => assembleGraphFold(SYNTHETIC_STREAM)).not.toThrow()
  })

  it('synthetic stream folds losslessly', () => {
    const losses = collectLosses(SYNTHETIC_STREAM)
    if (losses.length > 0) {
      const named = losses.map((l) => `${l.type}.${l.field} (at ${l.ts})`).join('\n  ')
      expect.fail(`Named field losses in synthetic stream:\n  ${named}`)
    }
    expect(losses).toHaveLength(0)
  })

  // Per-type: each absent type produces an observable attrs entry.
  const attrsKey = {
    SPEC_CHANGE:      'spec_changes',
    LINT_DRIFT:       'lint_drifts',
    PROTOTYPE_RESULT: 'prototype_results',
    FAILURE:          'failures',
    WAIVER:           'waivers',
    HANDOFF:          'handoffs',
    SESSION_START:    'session_starts',
    SPEC_DRIFT:       'spec_drifts',
  }

  for (const type of ABSENT_TYPES) {
    it(`${type} synthetic event is captured in fold.attrs.${attrsKey[type]}`, () => {
      const fold = assembleGraphFold(SYNTHETIC_STREAM)
      const arr = fold.attrs[attrsKey[type]]
      expect(Array.isArray(arr), `fold.attrs.${attrsKey[type]} is not an array`).toBe(true)
      expect(arr.length).toBeGreaterThan(0)
    })
  }
})
