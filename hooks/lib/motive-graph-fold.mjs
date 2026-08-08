/**
 * motive-graph-fold.mjs — Pure event-fold engine for the motive DAG.
 *
 * Implements five revision primitives replayed over an ordered journal event
 * stream to produce a canonical graph document:
 *
 *   node.assert(kind, id, attrs)   — upsert a node
 *   node.retire(id, by)            — mark a node retired (immutable append)
 *   edge.assert(kind, from, to)    — upsert a directed edge
 *   edge.retire(kind, from, to)    — mark an edge retired
 *   attr.set(nodeId, key, value)   — update one node attribute
 *
 * Public API (signature FROZEN by D-9/D-10):
 *   assembleGraphFold(orderedEvents, { at?, charter?, groundTruth? })
 *     → { schema_version, motive, nodes[], edges[], attrs }
 *
 * Purity contract (S1-AC3):
 *   - No node:fs / node:child_process imports.
 *   - No wall-clock access, no random, no node process globals.
 *   - Deterministic for a fixed ordered event list.
 *
 * Field-level losslessness (R-006 / S1-AC1):
 *   - Every VALID_TYPE has an explicit named handler (no catch-all fallthrough).
 *   - CONSUMED_FIELDS declares the full set of data.* fields each handler
 *     processes; the tracer test asserts corpus fields ⊆ CONSUMED_FIELDS.
 *   - "motive_provenance" is classified as explicitly-ignored provenance and
 *     is always listed in CONSUMED_FIELDS but never stored in graph state.
 */

import { EDGE_KINDS } from './motive-graph.mjs'

export const SCHEMA_VERSION = 1

/**
 * Legal node kinds (R-001 node schema + `baseline` from D-8).
 * @type {ReadonlySet<string>}
 */
export const NODE_KINDS = Object.freeze(
  new Set([
    'objective',
    'decision',
    'open-item',
    'ticket',
    'acceptance-criterion',
    'slice',
    'spec-requirement',
    'baseline',
  ])
)

/**
 * Fields explicitly consumed per VALID_TYPE.
 *
 * Rules:
 *   - "motive_provenance" is explicitly-ignored provenance (S1-AC1 exemption).
 *     It appears in many events as an internal routing hint and is listed here
 *     so the losslessness test counts it as consumed.
 *   - S2 extends entries for MILESTONE, VERIFICATION, and PAUSE with fields
 *     observed in the full 5-motive corpus census.
 *   - Types absent from all 5 existing motive streams (SPEC_CHANGE, LINT_DRIFT,
 *     PROTOTYPE_RESULT, FAILURE, WAIVER, HANDOFF, SESSION_START, SPEC_DRIFT)
 *     are mapped to the fields used in S2-AC3 synthetic fixture events.
 *
 * @type {Readonly<Record<string, ReadonlySet<string>>>}
 */
export const CONSUMED_FIELDS = Object.freeze({
  MOTIVE_CREATED: Object.freeze(new Set(['objective'])),

  DECISION: Object.freeze(
    new Set([
      'id',
      'title',
      'status',
      'summary',
      'rationale',
      'source',
      'alternatives',
      'blast',
      'gaps',
      'relates_to',
      'resolves',
      'retires',
      'revises',
      'refs',
      'research',
      'supersedes',
      'items_registered',
      'decision',
    ])
  ),

  BASELINE: Object.freeze(new Set(['name', 'shard'])),

  GATE: Object.freeze(
    new Set(['verdict', 'citation', 'rubric', 'which', 'motive_provenance'])
  ),

  MILESTONE: Object.freeze(
    new Set([
      'id',
      'items',
      'note',
      'ownership',
      'plan',
      'range',
      'reason',
      'slices',
      'supersedes',
      'amendments',
      'amends',
      'decisions',
      'event',
      'motive_provenance',
      // S2: fields observed in 5-motive corpus census
      'waves',
      'pacing_override',
      'spec_traceability',
    ])
  ),

  AC_COVERAGE: Object.freeze(
    new Set(['ac', 'slice', 'covering', 'motive_provenance'])
  ),

  TASK_COMPLETE: Object.freeze(
    new Set(['slice', 'slice_id', 'session_id', 'motive_provenance'])
  ),

  SESSION_END: Object.freeze(new Set(['outcome', 'motive_provenance'])),

  // S2: fields observed in graph-pilot and groundwork-development corpora.
  VERIFICATION: Object.freeze(
    new Set(['req_ids', 'overall', 'scenarios', 'node_count', 'edge_count', 'screenshot', 'mode', 'findings'])
  ),

  // S2: fields observed in codify-motive-dag and graph-authoring corpora.
  PAUSE: Object.freeze(new Set(['pointer', 'summary', 'next_actions'])),

  // Attribute-mutating types absent from all 5 existing motive corpora.
  // Fields are mapped from synthetic fixture events authored for S2-AC3.
  SESSION_START:    Object.freeze(new Set(['session_id'])),
  SPEC_CHANGE:      Object.freeze(new Set(['file', 'change'])),
  LINT_DRIFT:       Object.freeze(new Set(['node_id', 'invariant'])),
  PROTOTYPE_RESULT: Object.freeze(new Set(['prototype', 'outcome'])),
  FAILURE:          Object.freeze(new Set(['kind', 'slices'])),
  WAIVER:           Object.freeze(new Set(['ac', 'reason'])),
  HANDOFF:          Object.freeze(new Set(['to', 'summary'])),
  SPEC_DRIFT:       Object.freeze(new Set(['spec_id', 'drift'])),
})

/**
 * assembleGraphFold(orderedEvents, opts)
 *
 * Pure function — no I/O, no mutation of inputs, deterministic for a fixed
 * ordered event list.
 *
 * @param {object[]} orderedEvents
 *   Pre-ordered journal events from `readOrderedEvents(journalDir, { motive })`.
 * @param {object} [opts]
 * @param {string} [opts.at]
 *   Optional ISO-8601 timestamp.  Only events with `ts ≤ at` are replayed
 *   (point-in-time fold).
 * @param {object} [opts.charter]
 *   Optional compiled charter context (injected by caller; not used at S1).
 * @param {object} [opts.groundTruth]
 *   Optional ground-truth graph for S5 equivalence harness (not used at S1).
 * @returns {{
 *   schema_version: number,
 *   motive: string,
 *   nodes: Array<{id:string, type:string, attrs:object}>,
 *   edges: Array<{kind:string, from:string, to:string}>,
 *   attrs: object
 * }}
 */
export function assembleGraphFold(orderedEvents, { at, charter, groundTruth } = {}) {
  // ── Internal mutable state ────────────────────────────────────────────────

  /** @type {Map<string, {id:string, type:string, attrs:object, retired?:boolean}>} */
  const nodesMap = new Map()

  /** @type {Array<{kind:string, from:string, to:string, retired?:boolean}>} */
  const edgesArr = []

  /**
   * Top-level metadata that does not map to typed graph nodes:
   * gate verdicts, session summaries, milestone records, and per-type
   * arrays for each attribute-mutating event kind.
   */
  const attrs = {
    gates:            /** @type {object[]} */ ([]),
    milestones:       /** @type {object[]} */ ([]),
    sessions:         /** @type {object[]} */ ([]),
    verifications:    /** @type {object[]} */ ([]),
    pauses:           /** @type {object[]} */ ([]),
    session_starts:   /** @type {object[]} */ ([]),
    spec_changes:     /** @type {object[]} */ ([]),
    lint_drifts:      /** @type {object[]} */ ([]),
    prototype_results: /** @type {object[]} */ ([]),
    failures:         /** @type {object[]} */ ([]),
    waivers:          /** @type {object[]} */ ([]),
    handoffs:         /** @type {object[]} */ ([]),
    spec_drifts:      /** @type {object[]} */ ([]),
  }

  // Derive motive slug from the first event's motive field.
  const motive = orderedEvents.length > 0 ? (orderedEvents[0].motive ?? '') : ''

  // ── Primitive 1: node.assert ──────────────────────────────────────────────
  function nodeAssert(kind, id, nodeAttrs) {
    if (!NODE_KINDS.has(kind)) {
      throw new TypeError(`assembleGraphFold: unknown node kind "${kind}"`)
    }
    const existing = nodesMap.get(id)
    if (existing) {
      Object.assign(existing.attrs, nodeAttrs)
    } else {
      nodesMap.set(id, { id, type: kind, attrs: { ...nodeAttrs } })
    }
  }

  // ── Primitive 2: node.retire ──────────────────────────────────────────────
  function nodeRetire(id, by) {
    const n = nodesMap.get(id)
    if (n) {
      n.retired = true
      n.attrs._retired_by = by
    }
  }

  // ── Primitive 3: edge.assert ──────────────────────────────────────────────
  function edgeAssert(kind, from, to) {
    if (!EDGE_KINDS[kind]) {
      throw new TypeError(`assembleGraphFold: unknown edge kind "${kind}"`)
    }
    const dup = edgesArr.some(
      (e) => e.kind === kind && e.from === from && e.to === to && !e.retired
    )
    if (!dup) edgesArr.push({ kind, from, to })
  }

  // ── Primitive 4: edge.retire ──────────────────────────────────────────────
  function edgeRetire(kind, from, to) {
    const e = edgesArr.find(
      (e) => e.kind === kind && e.from === from && e.to === to && !e.retired
    )
    if (e) e.retired = true
  }

  // ── Primitive 5: attr.set ─────────────────────────────────────────────────
  function attrSet(nodeId, key, value) {
    const n = nodesMap.get(nodeId)
    if (n) n.attrs[key] = value
  }

  // ── Event handlers — one named handler per VALID_TYPE ───────────────────────
  // Each handler explicitly names every field it consumes from data.
  // "motive_provenance" is bound to the local variable `_mp` (ignored).

  function handleMotiveCreated(data, _event) {
    const { objective } = data
    nodeAssert('objective', 'objective:root', { objective })
  }

  function handleDecision(data, event) {
    const {
      id,
      title,
      status,
      summary,
      rationale,
      source,
      alternatives,
      blast,
      gaps,
      relates_to,
      resolves,
      retires,
      revises,
      refs,
      research,
      supersedes,
      items_registered,
      decision,
    } = data
    // Events without an `id` field get a stable synthetic id from their ordinal.
    const nodeId = id ? `decision:${id}` : `decision:_legacy_ord${event.ord ?? event.ts}`
    nodeAssert('decision', nodeId, {
      id,
      title,
      status,
      summary,
      rationale,
      source,
      alternatives,
      blast,
      gaps,
      relates_to,
      resolves,
      retires,
      revises,
      refs,
      research,
      supersedes,
      items_registered,
      decision,
    })
    if (nodesMap.has('objective:root')) {
      edgeAssert('anchors', 'objective:root', nodeId)
    }
  }

  function handleBaseline(data, _event) {
    const { name, shard } = data
    nodeAssert('baseline', `baseline:${name}`, { name, shard })
  }

  function handleGate(data, event) {
    // motive_provenance: explicitly-ignored provenance (S1-AC1 exemption).
    const { verdict, citation, rubric, which, motive_provenance: _mp } = data
    attrs.gates.push({ ts: event.ts, which, verdict, citation, rubric })
  }

  function handleMilestone(data, event) {
    // motive_provenance: explicitly-ignored provenance (S1-AC1 exemption).
    const {
      id,
      items,
      note,
      ownership,
      plan,
      range,
      reason,
      slices,
      supersedes,
      amendments,
      amends,
      decisions: milestoneDecisions,
      event: evtName,
      motive_provenance: _mp,
      // S2: fields observed in 5-motive corpus census
      waves,
      pacing_override,
      spec_traceability,
    } = data
    attrs.milestones.push({
      ts: event.ts,
      id,
      items,
      note,
      ownership,
      plan,
      range,
      reason,
      slices,
      supersedes,
      amendments,
      amends,
      decisions: milestoneDecisions,
      event: evtName,
      waves,
      pacing_override,
      spec_traceability,
    })
  }

  function handleAcCoverage(data, _event) {
    // motive_provenance: explicitly-ignored provenance (S1-AC1 exemption).
    const { ac, slice, covering, motive_provenance: _mp } = data
    if (ac && slice) {
      // Coverage form: { ac, slice }
      const acId = `ac:${ac}`
      const sliceId = `slice:${slice}`
      if (!nodesMap.has(acId)) nodeAssert('acceptance-criterion', acId, { ac })
      if (!nodesMap.has(sliceId)) nodeAssert('slice', sliceId, { slice })
      edgeAssert('covers_ac', sliceId, acId)
    } else if (ac && Array.isArray(covering)) {
      // Declaration form: { ac, covering: [] }
      const acId = `ac:${ac}`
      if (!nodesMap.has(acId)) nodeAssert('acceptance-criterion', acId, { ac, covering })
    }
  }

  function handleTaskComplete(data, event) {
    // motive_provenance: explicitly-ignored provenance (S1-AC1 exemption).
    const { slice, slice_id, session_id, motive_provenance: _mp } = data
    const sliceKey = slice_id ?? slice
    if (sliceKey) {
      const sliceId = `slice:${sliceKey}`
      if (!nodesMap.has(sliceId)) {
        nodeAssert('slice', sliceId, {
          slice,
          slice_id,
          session_id,
          _completed_at: event.ts,
        })
      } else {
        if (session_id != null) attrSet(sliceId, 'session_id', session_id)
        attrSet(sliceId, '_completed_at', event.ts)
      }
    }
  }

  function handleSessionEnd(data, event) {
    // motive_provenance: explicitly-ignored provenance (S1-AC1 exemption).
    const { outcome, motive_provenance: _mp } = data
    attrs.sessions.push({ ts: event.ts, session: event.session, outcome })
  }

  function handleVerification(data, event) {
    // S2: fields observed in graph-pilot and groundwork-development corpora.
    const { req_ids, overall, scenarios, node_count, edge_count, screenshot, mode, findings } = data
    attrs.verifications.push({ ts: event.ts, req_ids, overall, scenarios, node_count, edge_count, screenshot, mode, findings })
  }

  // ── Attribute-mutating handlers for types present in real streams ────────

  function handlePause(data, event) {
    // S2: fields observed in codify-motive-dag and graph-authoring corpora.
    const { pointer, summary, next_actions } = data
    attrs.pauses.push({ ts: event.ts, pointer, summary, next_actions })
  }

  // ── Attribute-mutating handlers for types absent from all 5 corpora ──────
  // Each handler explicitly names the fields used in S2-AC3 synthetic fixtures
  // (no field is silently dropped via a generic forward).

  function handleSessionStart(data, event) {
    const { session_id } = data
    attrs.session_starts.push({ ts: event.ts, session_id })
  }

  function handleSpecChange(data, event) {
    const { file, change } = data
    attrs.spec_changes.push({ ts: event.ts, file, change })
  }

  function handleLintDrift(data, event) {
    const { node_id, invariant } = data
    attrs.lint_drifts.push({ ts: event.ts, node_id, invariant })
  }

  function handlePrototypeResult(data, event) {
    const { prototype, outcome } = data
    attrs.prototype_results.push({ ts: event.ts, prototype, outcome })
  }

  function handleFailure(data, event) {
    const { kind, slices } = data
    attrs.failures.push({ ts: event.ts, kind, slices })
  }

  function handleWaiver(data, event) {
    const { ac, reason } = data
    attrs.waivers.push({ ts: event.ts, ac, reason })
  }

  function handleHandoff(data, event) {
    const { to, summary } = data
    attrs.handoffs.push({ ts: event.ts, to, summary })
  }

  function handleSpecDrift(data, event) {
    const { spec_id, drift } = data
    attrs.spec_drifts.push({ ts: event.ts, spec_id, drift })
  }

  // ── Dispatch table — one entry per VALID_TYPE ───────────────────────────────
  const HANDLERS = {
    MOTIVE_CREATED:   handleMotiveCreated,
    DECISION:         handleDecision,
    BASELINE:         handleBaseline,
    GATE:             handleGate,
    MILESTONE:        handleMilestone,
    AC_COVERAGE:      handleAcCoverage,
    TASK_COMPLETE:    handleTaskComplete,
    SESSION_END:      handleSessionEnd,
    VERIFICATION:     handleVerification,
    SPEC_CHANGE:      handleSpecChange,
    LINT_DRIFT:       handleLintDrift,
    PROTOTYPE_RESULT: handlePrototypeResult,
    FAILURE:          handleFailure,
    WAIVER:           handleWaiver,
    HANDOFF:          handleHandoff,
    PAUSE:            handlePause,
    SESSION_START:    handleSessionStart,
    SPEC_DRIFT:       handleSpecDrift,
  }

  // ── Replay ────────────────────────────────────────────────────────────────
  for (const event of orderedEvents) {
    // Point-in-time filter: skip events that fall after `at`.
    if (at != null && event.ts > at) continue

    const handler = HANDLERS[event.type]
    if (handler) {
      handler(event.data ?? {}, event)
    }
    // Events whose type is outside VALID_TYPES carry no schema contract and
    // are silently skipped.  VALID_TYPES are fully covered by the dispatch table.
  }

  // ── Build output (strip retired items) ───────────────────────────────────
  const nodes = Array.from(nodesMap.values()).filter((n) => !n.retired)
  const edges = edgesArr.filter((e) => !e.retired)

  return {
    schema_version: SCHEMA_VERSION,
    motive,
    nodes,
    edges,
    attrs,
  }
}
