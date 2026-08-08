/**
 * motive-graph-fold-reconcile.test.mjs — S2 reconciliation completeness.
 *
 * Verifies:
 *   S2-AC1: all 19 VALID_TYPES have an explicit handler + CONSUMED_FIELDS entry;
 *           each handler produces an observable delta (not merely no-throw).
 *   S2-AC2: field-level losslessness STRUCTURAL CHECK — for each attribute-mutating
 *           event in all 5 real motive streams, every data.* field is verified against
 *           the corresponding record in the fold output.  Independent of
 *           CONSUMED_FIELDS / AllFieldsSet — cannot be blinded by AllFieldsSet.has().
 *           Covers: 13 attrs-bucket types (positional) + TASK_COMPLETE (node-based
 *           last-write-wins simulation).  GRAPH_MUTATE is absent from all 5 real
 *           streams and is not covered here — S2-AC1 observable-delta test covers it.
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
 * Maps each attrs-bucket event type to the fold.attrs bucket it populates.
 * Each handler pushes { ts: event.ts, ...data } into these arrays in event-stream order.
 * SESSION_END additionally adds session: event.session before the data spread.
 *
 * NOTE: GRAPH_MUTATE and TASK_COMPLETE use AllFieldsSet but are NOT attrs-bucket types.
 * TASK_COMPLETE is covered separately below (node-based). GRAPH_MUTATE is absent from
 * all 5 real motive streams and not covered by S2-AC2 — S2-AC1 observable-delta covers it.
 *
 * @type {Readonly<Record<string, string>>}
 */
const ATTRS_BUCKET = Object.freeze({
  GATE:             'gates',
  MILESTONE:        'milestones',
  SESSION_END:      'sessions',
  VERIFICATION:     'verifications',
  PAUSE:            'pauses',
  SESSION_START:    'session_starts',
  SPEC_CHANGE:      'spec_changes',
  LINT_DRIFT:       'lint_drifts',
  PROTOTYPE_RESULT: 'prototype_results',
  FAILURE:          'failures',
  WAIVER:           'waivers',
  HANDOFF:          'handoffs',
  SPEC_DRIFT:       'spec_drifts',
})

/**
 * Structural losslessness detector.
 *
 * For each event in the stream, locates the corresponding record in the fold
 * output and verifies every data.* field is present with the same value.
 *
 * Coverage:
 *   - 13 attrs-bucket types: positional insertion-order matching against
 *     fold.attrs.<bucket>[idx].  A post-walk bucket-alignment check asserts
 *     bucketIdx[b] === fold.attrs[b].length so a guard skipping events would
 *     be caught.
 *   - TASK_COMPLETE: per-sliceKey last-write-wins simulation mirrors the fold's
 *     Object.assign merge; expected node attrs are compared against fold.nodes.
 *     motive_provenance is verified EXCLUDED (intentional drop per S1-AC1).
 *
 * NOT covered — named explicitly:
 *   - GRAPH_MUTATE: op-based node mutations, no attrs bucket; absent from all 5
 *     real motive streams — S2-AC1 observable-delta test covers it.
 *
 * INDEPENDENT of CONSUMED_FIELDS / AllFieldsSet — AllFieldsSet.has() cannot
 * blind this check.
 *
 * @param {object[]} events
 * @returns {{
 *   losses: Array<{type:string, field:string, ts:string, expected:unknown, actual:unknown}>,
 *   eventsChecked: number,
 *   fieldsCompared: number
 * }}
 */
function collectStructuralLosses(events) {
  const fold = assembleGraphFold(events)
  const losses = []
  let eventsChecked = 0
  let fieldsCompared = 0

  // ── Part 1: attrs-bucket types — positional insertion-order matching ──────

  // Positional counter per bucket: advances once per attrs-bucket event of that type.
  const bucketIdx = {}
  for (const bucket of Object.values(ATTRS_BUCKET)) bucketIdx[bucket] = 0

  for (const event of events) {
    const bucketName = ATTRS_BUCKET[event.type]
    if (!bucketName) continue // not an attrs-bucket type

    eventsChecked++
    const data = event.data ?? {}
    const dataFields = Object.keys(data)

    const idx = bucketIdx[bucketName]++
    const record = fold.attrs[bucketName][idx]

    if (!record) {
      losses.push({
        type: event.type,
        field: '(record missing)',
        ts: event.ts,
        expected: `fold.attrs.${bucketName}[${idx}] to exist`,
        actual: undefined,
      })
      continue
    }

    for (const field of dataFields) {
      fieldsCompared++
      const expected = data[field]
      const actual = record[field]
      // JSON.stringify for deep equality (handles nested objects/arrays).
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        losses.push({ type: event.type, field, ts: event.ts, expected, actual })
      }
    }
  }

  // Post-walk bucket-alignment invariant: every record in every bucket must have
  // been visited.  A handler that conditionally skips pushes would break alignment
  // and would be caught here rather than silently comparing the wrong record.
  for (const [type, bucket] of Object.entries(ATTRS_BUCKET)) {
    const expected = fold.attrs[bucket].length
    const walked = bucketIdx[bucket]
    if (walked !== expected) {
      losses.push({
        type,
        field: '(bucket length mismatch — positional alignment broken)',
        ts: '',
        expected: `walked ${walked} events`,
        actual: `fold.attrs.${bucket}.length === ${expected}`,
      })
    }
  }

  // ── Part 2: TASK_COMPLETE — node-based last-write-wins simulation ──────────

  // handleTaskComplete: const { slice, slice_id, motive_provenance: _mp, ...rest } = data
  //   nodeAssert('slice', `slice:${sliceKey}`, { ...rest, slice, slice_id, _completed_at: event.ts })
  // Multiple TASK_COMPLETE events for the same sliceKey merge via Object.assign (last-write wins).
  // We simulate the same merge in stream order, then diff against fold.nodes.

  /** @type {Map<string, { expected: object, lastTs: string }>} */
  const expectedBySlice = new Map()

  for (const event of events) {
    if (event.type !== 'TASK_COMPLETE') continue
    eventsChecked++
    const data = event.data ?? {}
    const { slice, slice_id, motive_provenance: _mp, ...rest } = data
    const sliceKey = slice_id ?? slice
    if (!sliceKey) continue

    const nodeAttrs = { ...rest, slice, slice_id, _completed_at: event.ts }
    const entry = expectedBySlice.get(sliceKey)
    if (entry) {
      Object.assign(entry.expected, nodeAttrs)
      entry.lastTs = event.ts
    } else {
      expectedBySlice.set(sliceKey, { expected: { ...nodeAttrs }, lastTs: event.ts })
    }
  }

  for (const [sliceKey, { expected, lastTs }] of expectedBySlice) {
    const nodeId = `slice:${sliceKey}`
    const node = fold.nodes.find((n) => n.id === nodeId)

    if (!node) {
      losses.push({
        type: 'TASK_COMPLETE',
        field: '(slice node missing)',
        ts: lastTs,
        expected: nodeId,
        actual: undefined,
      })
      continue
    }

    for (const [field, expectedVal] of Object.entries(expected)) {
      if (expectedVal == null) continue // undefined/null fields: Object.assign stores them as-is; skip
      fieldsCompared++
      const actual = node.attrs[field]
      if (JSON.stringify(expectedVal) !== JSON.stringify(actual)) {
        losses.push({
          type: 'TASK_COMPLETE',
          field,
          ts: lastTs,
          expected: expectedVal,
          actual,
        })
      }
    }

    // Verify motive_provenance is EXCLUDED from the node (S1-AC1 explicit-ignore exemption).
    if (node.attrs.motive_provenance !== undefined) {
      losses.push({
        type: 'TASK_COMPLETE',
        field: 'motive_provenance',
        ts: lastTs,
        expected: '(must be absent — intentionally excluded by handler)',
        actual: node.attrs.motive_provenance,
      })
    }
  }

  return { losses, eventsChecked, fieldsCompared }
}

/** Build a one-shot event stream: MOTIVE_CREATED + one typed event.
 *  Events carry `ord` (replay index) so node handlers can persist _ord/_ts. */
function makeStream(type, data = {}) {
  return [
    {
      type: 'MOTIVE_CREATED',
      motive: 'test',
      ts: '2026-01-01T00:00:00.000Z',
      ord: 0,
      data: { objective: 'test' },
    },
    {
      type,
      motive: 'test',
      ts: '2026-01-01T00:00:01.000Z',
      ord: 1,
      data,
    },
  ]
}

// ── S2-AC1: all 19 VALID_TYPES have declared roles ────────────────────────

describe('S2-AC1 — all 19 VALID_TYPES have declared roles', () => {
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
    DECISION:         (fold) => {
      const n = fold.nodes.find((m) => m.type === 'decision')
      expect(n).toBeDefined()
      // ord and ts from event envelope are persisted on first creation
      expect(typeof n.attrs._ord).toBe('number')
      expect(typeof n.attrs._ts).toBe('string')
    },
    BASELINE:         (fold) => {
      const n = fold.nodes.find((m) => m.type === 'baseline')
      expect(n).toBeDefined()
      expect(typeof n.attrs._ord).toBe('number')
      expect(typeof n.attrs._ts).toBe('string')
    },
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
    GRAPH_MUTATE:     (fold) => expect(fold.nodes.some((n) => n.type === 'decision')).toBe(true),
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
    GRAPH_MUTATE:     { op: 'node.assert', kind: 'decision', id: 'decision:D-gm', attrs: { title: 'via GRAPH_MUTATE' } },
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
    it(`${slug} folds losslessly (structural check)`, () => {
      const { events } = readOrderedEvents(JOURNAL_DIR, { motive: slug })
      expect(events.length).toBeGreaterThan(0)
      const { losses, eventsChecked, fieldsCompared } = collectStructuralLosses(events)
      // Non-vacuity guard: a structural oracle that walks zero records is as blind as AllFieldsSet.
      // Each real motive has at least GATE + SESSION_END events, so eventsChecked must be > 0.
      expect(
        eventsChecked,
        `${slug}: structural check walked 0 events — oracle is vacuous (no attrs-bucket or TASK_COMPLETE events found)`
      ).toBeGreaterThan(0)
      if (losses.length > 0) {
        const named = losses
          .map((l) => `${l.type}.${l.field} (at ${l.ts}): expected ${JSON.stringify(l.expected)}, got ${JSON.stringify(l.actual)}`)
          .join('\n  ')
        expect.fail(
          `[S2-AC2] ${slug}: ${losses.length} field loss(es) detected by structural check ` +
          `(${eventsChecked} events checked, ${fieldsCompared} fields compared):\n  ${named}`
        )
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
    // S2-AC3 non-circular passthrough proof: includes a field ('extra_sentinel')
    // that was NOT enumerated in the original CONSUMED_FIELDS['FAILURE'] list.
    // If the handler field-picks instead of doing passthrough, this field is
    // dropped and the assertion below catches it — proving structural coverage.
    data: { kind: 'test', slices: ['S1'], extra_sentinel: 'passthrough-proof' },
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

  it('synthetic stream folds losslessly (structural check)', () => {
    const { losses, eventsChecked, fieldsCompared } = collectStructuralLosses(SYNTHETIC_STREAM)
    // Non-vacuity guard: SYNTHETIC_STREAM has 8 absent-type events, so eventsChecked must be > 0.
    expect(
      eventsChecked,
      'synthetic stream: structural check walked 0 events — oracle is vacuous'
    ).toBeGreaterThan(0)
    if (losses.length > 0) {
      const named = losses
        .map((l) => `${l.type}.${l.field} (at ${l.ts}): expected ${JSON.stringify(l.expected)}, got ${JSON.stringify(l.actual)}`)
        .join('\n  ')
      expect.fail(
        `[S2-AC3] Synthetic stream: ${losses.length} field loss(es) detected by structural check ` +
        `(${eventsChecked} events checked, ${fieldsCompared} fields compared):\n  ${named}`
      )
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

  // S2-AC3 non-circular passthrough proof: the FAILURE fixture carries
  // extra_sentinel which was NOT in the original enumerated field list.
  // A field-picking handler would drop it; a passthrough handler preserves it.
  it('FAILURE passthrough: extra_sentinel field survives the fold (non-circular fixture proof)', () => {
    const fold = assembleGraphFold(SYNTHETIC_STREAM)
    const failureRecords = fold.attrs.failures
    expect(failureRecords.length).toBeGreaterThan(0)
    expect(failureRecords[0].extra_sentinel).toBe('passthrough-proof')
  })
})

// ── First-event guard: _ord/_ts must not be overwritten by re-issued events ──
//
// The guard in handleDecision and handleBaseline:
//   if (!nodesMap.has(nodeId)) { _ord = event.ord; _ts = event.ts }
//
// Without this guard, a second DECISION or BASELINE event for the same id/name
// would clobber _ord/_ts with the later event's ord/ts — breaking compile()-
// equivalent insertion ordering in decision_log and baselines.
//
// These are MULTI-EVENT tests: a single-event stream cannot distinguish guarded
// from unguarded behaviour (both produce the same result when the node is new).
// The mutation under test: remove `if (!nodesMap.has(nodeId))` so that every
// DECISION/BASELINE event, including re-issues, overwrites _ord/_ts.

describe('First-event guard — _ord/_ts not overwritten by re-issued DECISION/BASELINE', () => {
  it('DECISION: re-issued second event does NOT overwrite _ord/_ts (guard bite test)', () => {
    // Two DECISION events for the same id:
    //   event 1: ord=5  → creates the node, sets _ord=5
    //   event 2: ord=99 → updates status but MUST NOT overwrite _ord
    // Mutant (guard removed): _ord would be 99 after the second event.
    const stream = [
      {
        type: 'MOTIVE_CREATED',
        motive: 'guard-test',
        ts: '2026-01-01T00:00:00.000Z',
        ord: 0,
        data: { objective: 'guard bite test' },
      },
      {
        type: 'DECISION',
        motive: 'guard-test',
        ts: '2026-01-01T00:01:00.000Z',
        ord: 5,
        data: { id: 'D-guard', title: 'initial decision', status: 'proposed' },
      },
      {
        type: 'DECISION',
        motive: 'guard-test',
        ts: '2026-01-01T00:02:00.000Z',
        ord: 99,
        data: { id: 'D-guard', status: 'accepted' },
      },
    ]
    const fold = assembleGraphFold(stream)
    const node = fold.nodes.find((n) => n.id === 'decision:D-guard')
    expect(node, 'decision:D-guard must exist after two events').toBeDefined()
    // First-event semantics: _ord and _ts must reflect the FIRST event, not the re-issue.
    expect(node.attrs._ord, '_ord must be 5 (first event), not 99 (re-issue)').toBe(5)
    expect(node.attrs._ts, '_ts must be first event ts').toBe('2026-01-01T00:01:00.000Z')
    // The re-issue DID update other attrs via Object.assign.
    expect(node.attrs.status, 'status updated by second event').toBe('accepted')
  })

  it('BASELINE: re-issued second event does NOT overwrite _ord/_ts (guard bite test)', () => {
    // Two BASELINE events for the same name:
    //   event 1: ord=3  → creates the node, sets _ord=3
    //   event 2: ord=77 → updates shard but MUST NOT overwrite _ord
    // Mutant (guard removed): _ord would be 77 after the second event.
    const stream = [
      {
        type: 'MOTIVE_CREATED',
        motive: 'guard-test',
        ts: '2026-01-01T00:00:00.000Z',
        ord: 0,
        data: { objective: 'guard bite test' },
      },
      {
        type: 'BASELINE',
        motive: 'guard-test',
        ts: '2026-01-01T00:01:00.000Z',
        ord: 3,
        data: { name: 'v1', shard: 'shard-001' },
      },
      {
        type: 'BASELINE',
        motive: 'guard-test',
        ts: '2026-01-01T00:02:00.000Z',
        ord: 77,
        data: { name: 'v1', shard: 'shard-002' },
      },
    ]
    const fold = assembleGraphFold(stream)
    const node = fold.nodes.find((n) => n.id === 'baseline:v1')
    expect(node, 'baseline:v1 must exist after two events').toBeDefined()
    // First-event semantics: _ord and _ts must reflect the FIRST event.
    expect(node.attrs._ord, '_ord must be 3 (first event), not 77 (re-issue)').toBe(3)
    expect(node.attrs._ts, '_ts must be first event ts').toBe('2026-01-01T00:01:00.000Z')
    // The re-issue DID update shard via Object.assign.
    expect(node.attrs.shard, 'shard updated by second event').toBe('shard-002')
  })
})
