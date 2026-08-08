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
 * A Set subclass whose .has() always returns true.
 *
 * Used in CONSUMED_FIELDS for attribute-mutating handlers that preserve the
 * WHOLE event data object via spread (passthrough semantics).  Any field name
 * is therefore "consumed", making the fold structurally lossless by construction
 * rather than by field enumeration.  Iterating the set (e.g. [...set]) returns
 * [] since no elements are stored — the == losslessness check in the equivalence
 * test correctly interprets this as "no declared-but-unpopulated fields".
 */
class AllFieldsSet extends Set {
  // eslint-disable-next-line no-unused-vars
  has(_field) { return true }
}

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
 *   - MOTIVE_CREATED, DECISION, BASELINE, AC_COVERAGE: enumerated fields (structural
 *     node-creating handlers where field names drive graph logic).
 *   - All attribute-mutating handlers (GATE, MILESTONE, TASK_COMPLETE, SESSION_END,
 *     VERIFICATION, PAUSE, SESSION_START, SPEC_CHANGE, LINT_DRIFT, PROTOTYPE_RESULT,
 *     FAILURE, WAIVER, HANDOFF, SPEC_DRIFT): use AllFieldsSet — passthrough semantics,
 *     any field is considered consumed, making losslessness structural rather than by
 *     enumeration.  Prevents field-drop when events carry un-enumerated fields.
 *   - GRAPH_MUTATE: uses AllFieldsSet — ops carry different field sets per op type.
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
      'motive_provenance',
    ])
  ),

  BASELINE: Object.freeze(new Set(['name', 'shard'])),

  AC_COVERAGE: Object.freeze(
    new Set(['ac', 'slice', 'covering', 'motive_provenance'])
  ),

  // Attribute-mutating handlers: AllFieldsSet — passthrough, any field consumed.
  GATE:             Object.freeze(new AllFieldsSet()),
  MILESTONE:        Object.freeze(new AllFieldsSet()),
  TASK_COMPLETE:    Object.freeze(new AllFieldsSet()),
  SESSION_END:      Object.freeze(new AllFieldsSet()),
  VERIFICATION:     Object.freeze(new AllFieldsSet()),
  PAUSE:            Object.freeze(new AllFieldsSet()),
  SESSION_START:    Object.freeze(new AllFieldsSet()),
  SPEC_CHANGE:      Object.freeze(new AllFieldsSet()),
  LINT_DRIFT:       Object.freeze(new AllFieldsSet()),
  PROTOTYPE_RESULT: Object.freeze(new AllFieldsSet()),
  FAILURE:          Object.freeze(new AllFieldsSet()),
  WAIVER:           Object.freeze(new AllFieldsSet()),
  HANDOFF:          Object.freeze(new AllFieldsSet()),
  SPEC_DRIFT:       Object.freeze(new AllFieldsSet()),

  // GRAPH_MUTATE: op-dependent field sets; AllFieldsSet covers all ops.
  GRAPH_MUTATE:     Object.freeze(new AllFieldsSet()),
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
      // motive_provenance is explicitly-ignored provenance (S1-AC1 exemption).
      // eslint-disable-next-line no-unused-vars
      motive_provenance: _mp,
    } = data
    // Events without an `id` field get a stable synthetic id from their ordinal.
    const nodeId = id ? `decision:${id}` : `decision:_legacy_ord${event.ord ?? event.ts}`

    // D-12: replicate compile()'s last-non-null-write guard — a later event's
    // null/undefined field must not overwrite an earlier non-null value.
    const candidates = {
      id, title, status, summary, rationale, source, alternatives, blast, gaps,
      relates_to, resolves, retires, revises, refs, research, supersedes,
      items_registered, decision,
    }
    const nodeAttrs = {}
    for (const [k, v] of Object.entries(candidates)) {
      if (v != null) nodeAttrs[k] = v
    }
    nodeAssert('decision', nodeId, nodeAttrs)

    if (nodesMap.has('objective:root')) {
      edgeAssert('anchors', 'objective:root', nodeId)
    }

    // T2-AC1 / D-11: lifecycle edges for supersedes/retires/revises.
    // Only emit when the value looks like a structured decision id (no whitespace).
    // Free-text "retires" descriptions (prose sentences) are skipped.
    function emitLifecycleEdge(kind, targetRaw) {
      if (!targetRaw || typeof targetRaw !== 'string' || /\s/.test(targetRaw)) return
      edgeAssert(kind, nodeId, `decision:${targetRaw}`)
    }
    if (supersedes) emitLifecycleEdge('supersedes', supersedes)
    if (retires)    emitLifecycleEdge('retires',    retires)
    if (revises)    emitLifecycleEdge('revises',    revises)
  }

  function handleBaseline(data, _event) {
    const { name, shard } = data
    nodeAssert('baseline', `baseline:${name}`, { name, shard })
  }

  function handleGate(data, event) {
    // Passthrough: preserve all data fields so no gate field is dropped.
    attrs.gates.push({ ts: event.ts, ...data })
  }

  function handleMilestone(data, event) {
    // Passthrough: preserve all data fields so no milestone field is dropped.
    attrs.milestones.push({ ts: event.ts, ...data })
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
    // Passthrough: upsert a slice node with ALL data fields so nothing is dropped.
    const { slice, slice_id, motive_provenance: _mp, ...rest } = data
    const sliceKey = slice_id ?? slice
    if (sliceKey) {
      nodeAssert('slice', `slice:${sliceKey}`, {
        ...rest, slice, slice_id, _completed_at: event.ts,
      })
    }
  }

  function handleSessionEnd(data, event) {
    // Passthrough: preserve all data fields + event.session for session context.
    attrs.sessions.push({ ts: event.ts, session: event.session, ...data })
  }

  // ── Attribute-mutating handlers — passthrough semantics ───────────────────
  // Each handler spreads the whole data object so no field is ever dropped,
  // regardless of whether it was known at handler-authoring time.  Losslessness
  // is structural (by construction) rather than by field enumeration.

  function handleVerification(data, event) {
    attrs.verifications.push({ ts: event.ts, ...data })
  }

  function handlePause(data, event) {
    attrs.pauses.push({ ts: event.ts, ...data })
  }

  function handleSessionStart(data, event) {
    attrs.session_starts.push({ ts: event.ts, ...data })
  }

  function handleSpecChange(data, event) {
    attrs.spec_changes.push({ ts: event.ts, ...data })
  }

  function handleLintDrift(data, event) {
    attrs.lint_drifts.push({ ts: event.ts, ...data })
  }

  function handlePrototypeResult(data, event) {
    attrs.prototype_results.push({ ts: event.ts, ...data })
  }

  function handleFailure(data, event) {
    attrs.failures.push({ ts: event.ts, ...data })
  }

  function handleWaiver(data, event) {
    attrs.waivers.push({ ts: event.ts, ...data })
  }

  function handleHandoff(data, event) {
    attrs.handoffs.push({ ts: event.ts, ...data })
  }

  function handleSpecDrift(data, event) {
    attrs.spec_drifts.push({ ts: event.ts, ...data })
  }

  // ── GRAPH_MUTATE native handler (T2-AC2 / D-11) ───────────────────────────

  function handleGraphMutate(data, _event) {
    switch (data.op) {
      case 'node.assert':
        nodeAssert(data.kind, data.id, data.attrs ?? {})
        break
      case 'node.retire':
        nodeRetire(data.id, data.by)
        break
      case 'edge.assert':
        edgeAssert(data.kind, data.from, data.to)
        break
      case 'edge.retire':
        edgeRetire(data.kind, data.from, data.to)
        break
      case 'attr.set':
        attrSet(data.nodeId, data.key, data.value)
        break
      // Unknown ops silently skipped (forward-compatible).
    }
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
    GRAPH_MUTATE:     handleGraphMutate,
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
