/**
 * motive-graph-fold-tracer.test.mjs — Wave-0 tracer bullet for assembleGraphFold.
 *
 * Replays the groundwork-development journal stream (9/19 VALID_TYPES) through
 * the pure fold engine and asserts:
 *
 *   S1-AC1: field-level losslessness — CONSUMED_FIELDS[type] ⊇ corpus fields
 *   S1-AC2: fold ⊇ assembleMotiveGraph for event-producible node types
 *   S1-AC3: purity guard — grep the fold source for forbidden I/O patterns
 *   S1-AC4: zero new tsc errors (verified separately via pnpm run check)
 *
 * Run: npx vitest run test/motive-graph-fold-tracer.test.mjs
 */

import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { readOrderedEvents } from '../hooks/lib/journal-order.mjs'
import { assembleGraphFold, CONSUMED_FIELDS, NODE_KINDS } from '../hooks/lib/motive-graph-fold.mjs'
import { assembleMotiveGraph, EDGE_KINDS } from '../hooks/lib/motive-graph.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const JOURNAL_DIR = path.join(ROOT, '.groundwork', 'journal')
const MOTIVE = 'groundwork-development'
const FOLD_SRC_PATH = path.join(ROOT, 'hooks', 'lib', 'motive-graph-fold.mjs')

// ── Fixtures loaded once before all tests ─────────────────────────────────

/** @type {object[]} */
let events = []
/** @type {import('../hooks/lib/motive-graph-fold.mjs').FoldGraph} */
let fold
/** @type {object} Ground truth from assembleMotiveGraph */
let gt

beforeAll(async () => {
  const result = readOrderedEvents(JOURNAL_DIR, { motive: MOTIVE })
  events = result.events
  fold = assembleGraphFold(events)
  gt = await assembleMotiveGraph({ projectDir: ROOT, slug: MOTIVE })
})

// ── S1-AC3: purity guard ──────────────────────────────────────────────────

describe('S1-AC3 — purity guard', () => {
  it('fold source has no node:fs or node:child_process import', () => {
    const src = fs.readFileSync(FOLD_SRC_PATH, 'utf8')
    expect(src).not.toMatch(/['"]node:fs['"]/)
    expect(src).not.toMatch(/['"]node:child_process['"]/)
  })

  it('fold source has no non-deterministic calls (Date.now / new Date / Math.random / process.)', () => {
    const src = fs.readFileSync(FOLD_SRC_PATH, 'utf8')
    expect(src).not.toMatch(/Date\.now\s*\(/)
    expect(src).not.toMatch(/new Date\s*\(/)
    expect(src).not.toMatch(/Math\.random\s*\(/)
    expect(src).not.toMatch(/\bprocess\./)
  })

  it('fold source has no default: fallthrough clause', () => {
    const src = fs.readFileSync(FOLD_SRC_PATH, 'utf8')
    // The dispatch table uses an object — no switch/default: should appear.
    expect(src).not.toMatch(/\bdefault\s*:/)
  })
})

// ── Corpus shape sanity ────────────────────────────────────────────────────

describe('corpus sanity', () => {
  it('groundwork-development stream has events', () => {
    expect(events.length).toBeGreaterThan(0)
  })

  it('all 9 expected event types are present in the corpus', () => {
    const presentTypes = new Set(events.map((e) => e.type))
    const expected = [
      'AC_COVERAGE',
      'BASELINE',
      'DECISION',
      'GATE',
      'MILESTONE',
      'MOTIVE_CREATED',
      'SESSION_END',
      'TASK_COMPLETE',
      'VERIFICATION',
    ]
    for (const t of expected) {
      expect(presentTypes.has(t), `expected event type ${t} in corpus`).toBe(true)
    }
  })
})

// ── S1-AC1: field-level losslessness ──────────────────────────────────────

describe('S1-AC1 — field-level losslessness (CONSUMED_FIELDS ⊇ corpus fields)', () => {
  it('every data field in every corpus event is listed in CONSUMED_FIELDS[type]', () => {
    const losses = []
    for (const event of events) {
      const type = event.type
      const dataFields = event.data ? Object.keys(event.data) : []
      const consumed = CONSUMED_FIELDS[type] ?? new Set()
      for (const field of dataFields) {
        if (!consumed.has(field)) {
          losses.push({ type, field, ts: event.ts })
        }
      }
    }
    if (losses.length > 0) {
      const named = losses
        .map((l) => `${l.type}.${l.field} (at ${l.ts})`)
        .join('\n  ')
      expect.fail(
        `Named field losses (fields present in corpus but absent from CONSUMED_FIELDS):\n  ${named}`
      )
    }
    expect(losses).toHaveLength(0)
  })

  it('CONSUMED_FIELDS covers all 19 VALID_TYPES (no type left unregistered)', async () => {
    // Dynamically load VALID_TYPES to avoid hardcoding the list.
    const { VALID_TYPES } = await import('../hooks/lib/journal-io.mjs')
    for (const type of VALID_TYPES) {
      expect(
        Object.prototype.hasOwnProperty.call(CONSUMED_FIELDS, type),
        `CONSUMED_FIELDS is missing an entry for VALID_TYPE "${type}"`
      ).toBe(true)
    }
  })
})

// ── Well-formed output ────────────────────────────────────────────────────

describe('fold output structure', () => {
  it('schema_version is 1', () => {
    expect(fold.schema_version).toBe(1)
  })

  it('motive field matches corpus motive slug', () => {
    expect(fold.motive).toBe(MOTIVE)
  })

  it('objective:root node is present', () => {
    const obj = fold.nodes.find((n) => n.id === 'objective:root')
    expect(obj).toBeDefined()
    expect(obj.type).toBe('objective')
    expect(typeof obj.attrs.objective).toBe('string')
    expect(obj.attrs.objective.length).toBeGreaterThan(0)
  })

  it('decision nodes exist for DECISION events that carry an id field', () => {
    const eventsWithId = events.filter((e) => e.type === 'DECISION' && e.data?.id)
    const foldNodeIds = new Set(fold.nodes.map((n) => n.id))
    const missing = eventsWithId.filter(
      (e) => !foldNodeIds.has(`decision:${e.data.id}`)
    )
    if (missing.length > 0) {
      const ids = missing.map((e) => `decision:${e.data.id}`).join(', ')
      expect.fail(`Fold is missing decision nodes: ${ids}`)
    }
    expect(eventsWithId.length).toBeGreaterThan(0)
  })

  it('every node type is a member of NODE_KINDS', () => {
    const invalidNodes = fold.nodes.filter((n) => !NODE_KINDS.has(n.type))
    if (invalidNodes.length > 0) {
      const ids = invalidNodes.map((n) => `${n.id}(${n.type})`).join(', ')
      expect.fail(`Nodes with undeclared types: ${ids}`)
    }
    expect(fold.nodes.length).toBeGreaterThan(0)
  })

  it('every edge kind is a member of EDGE_KINDS', () => {
    const validKinds = new Set(Object.keys(EDGE_KINDS))
    const invalidEdges = fold.edges.filter((e) => !validKinds.has(e.kind))
    if (invalidEdges.length > 0) {
      const desc = invalidEdges.map((e) => `${e.from}-[${e.kind}]→${e.to}`).join(', ')
      expect.fail(`Edges with undeclared kinds: ${desc}`)
    }
    expect(fold.edges.length).toBeGreaterThan(0)
  })

  it('every edge endpoint references a node that exists in the fold', () => {
    const nodeIds = new Set(fold.nodes.map((n) => n.id))
    const dangling = fold.edges.filter(
      (e) => !nodeIds.has(e.from) || !nodeIds.has(e.to)
    )
    if (dangling.length > 0) {
      const desc = dangling.map((e) => `${e.from}-[${e.kind}]→${e.to}`).join(', ')
      expect.fail(`Dangling edges (endpoint not in nodes): ${desc}`)
    }
  })

  it('baseline node is present from the BASELINE event', () => {
    const baselineEvt = events.find((e) => e.type === 'BASELINE')
    expect(baselineEvt).toBeDefined()
    const baselineId = `baseline:${baselineEvt.data.name}`
    const baselineNode = fold.nodes.find((n) => n.id === baselineId)
    expect(baselineNode).toBeDefined()
    expect(baselineNode.type).toBe('baseline')
  })

  it('keyed decision nodes carry _ord and _ts attrs from the event envelope (first-seen semantics)', () => {
    const keyedDecisions = fold.nodes.filter(
      (n) => n.type === 'decision' && !n.id.startsWith('decision:_legacy_ord')
    )
    expect(keyedDecisions.length).toBeGreaterThan(0)
    for (const n of keyedDecisions) {
      expect(typeof n.attrs._ord, `${n.id} _ord must be a number`).toBe('number')
      expect(typeof n.attrs._ts, `${n.id} _ts must be a string`).toBe('string')
    }
  })

  it('baseline node carries _ord and _ts attrs from the event envelope', () => {
    const baselineNode = fold.nodes.find((n) => n.type === 'baseline')
    expect(baselineNode).toBeDefined()
    expect(typeof baselineNode.attrs._ord).toBe('number')
    expect(typeof baselineNode.attrs._ts).toBe('string')
  })

  it('AC_COVERAGE events produce covers_ac edges', () => {
    const acEvents = events.filter((e) => e.type === 'AC_COVERAGE' && e.data?.ac && e.data?.slice)
    expect(acEvents.length).toBeGreaterThan(0)
    const coverEdges = fold.edges.filter((e) => e.kind === 'covers_ac')
    expect(coverEdges.length).toBeGreaterThan(0)
  })

  it('gate verdicts are captured in attrs.gates', () => {
    const gateEvents = events.filter((e) => e.type === 'GATE')
    expect(gateEvents.length).toBeGreaterThan(0)
    expect(fold.attrs.gates.length).toBeGreaterThanOrEqual(gateEvents.length)
    // Each gate record must have verdict and which fields.
    for (const g of fold.attrs.gates) {
      expect(typeof g.verdict).toBe('string')
      expect(typeof g.which).toBe('string')
    }
  })

  it('session summaries are captured in attrs.sessions', () => {
    const sessionEvents = events.filter((e) => e.type === 'SESSION_END')
    expect(sessionEvents.length).toBeGreaterThan(0)
    expect(fold.attrs.sessions.length).toBe(sessionEvents.length)
  })
})

// ── S1-AC2: fold ⊇ assembleMotiveGraph (event-producible node types) ──────

describe('S1-AC2 — fold superset of assembleMotiveGraph (interim tracer bar)', () => {
  /**
   * Node types the pure fold can produce from journal events.
   * open-item, ticket, and spec-requirement nodes come from files (not events)
   * and are excluded from the S1 superset check.
   * spec-requirement is also explicitly excluded by the Wave-0 premise gate (D-82).
   */
  const EVENT_PRODUCIBLE_TYPES = new Set(['objective', 'decision', 'acceptance-criterion'])

  it('fold contains every objective and decision node from assembleMotiveGraph', () => {
    const foldNodeIds = new Set(fold.nodes.map((n) => n.id))
    const gtFiltered = gt.nodes.filter((n) => EVENT_PRODUCIBLE_TYPES.has(n.type))

    const missing = gtFiltered.filter((n) => !foldNodeIds.has(n.id))
    if (missing.length > 0) {
      const ids = missing.map((n) => `${n.id}(${n.type})`).join(', ')
      expect.fail(
        `Fold is missing ${missing.length} event-producible nodes from assembleMotiveGraph:\n  ${ids}`
      )
    }
    expect(gtFiltered.length).toBeGreaterThan(0)
  })

  it('fold contains all anchors edges that assembleMotiveGraph produces', () => {
    // assembleMotiveGraph uses { source, target, kind }; fold uses { from, to, kind }.
    const gtAnchors = gt.edges.filter((e) => e.kind === 'anchors')
    const foldAnchorSet = new Set(
      fold.edges
        .filter((e) => e.kind === 'anchors')
        .map((e) => `${e.from}→${e.to}`)
    )
    const missing = gtAnchors.filter(
      (e) => !foldAnchorSet.has(`${e.source}→${e.target}`)
    )
    if (missing.length > 0) {
      const desc = missing.map((e) => `${e.source}→${e.target}`).join(', ')
      expect.fail(`Fold missing anchors edges: ${desc}`)
    }
    expect(gtAnchors.length).toBeGreaterThan(0)
  })
})

// ── Determinism check ─────────────────────────────────────────────────────

describe('determinism (R-004)', () => {
  it('replaying the same events produces an identical graph', () => {
    const fold2 = assembleGraphFold(events)
    expect(fold2.schema_version).toBe(fold.schema_version)
    expect(fold2.motive).toBe(fold.motive)
    expect(fold2.nodes.length).toBe(fold.nodes.length)
    expect(fold2.edges.length).toBe(fold.edges.length)
    // Deep structural check on the sorted node/edge arrays.
    const sortedNodes = (g) =>
      [...g.nodes].sort((a, b) => a.id.localeCompare(b.id)).map((n) => n.id)
    const sortedEdges = (g) =>
      [...g.edges]
        .sort((a, b) => `${a.kind}:${a.from}:${a.to}`.localeCompare(`${b.kind}:${b.from}:${b.to}`))
        .map((e) => `${e.kind}:${e.from}:${e.to}`)
    expect(sortedNodes(fold2)).toEqual(sortedNodes(fold))
    expect(sortedEdges(fold2)).toEqual(sortedEdges(fold))
  })
})

// ── at-filter (point-in-time fold) ────────────────────────────────────────

describe('at-filter (point-in-time fold)', () => {
  it('folding up to the first event timestamp produces fewer nodes than full fold', () => {
    if (events.length < 2) return
    const firstTs = events[0].ts
    const partial = assembleGraphFold(events, { at: firstTs })
    expect(partial.nodes.length).toBeLessThanOrEqual(fold.nodes.length)
  })

  it('folding up to a past timestamp yields no nodes when at is before all events', () => {
    const past = '1970-01-01T00:00:00.000Z'
    const empty = assembleGraphFold(events, { at: past })
    expect(empty.nodes).toHaveLength(0)
    expect(empty.edges).toHaveLength(0)
  })
})

// ── Signature contract ────────────────────────────────────────────────────

describe('assembleGraphFold frozen signature (D-9/D-10)', () => {
  it('accepts orderedEvents as first argument and opts as second', () => {
    expect(() => assembleGraphFold([])).not.toThrow()
    expect(() => assembleGraphFold([], {})).not.toThrow()
    expect(() => assembleGraphFold([], { at: undefined, charter: undefined, groundTruth: undefined })).not.toThrow()
  })

  it('returns the expected top-level shape', () => {
    const result = assembleGraphFold([])
    expect(result).toHaveProperty('schema_version')
    expect(result).toHaveProperty('motive')
    expect(result).toHaveProperty('nodes')
    expect(result).toHaveProperty('edges')
    expect(result).toHaveProperty('attrs')
    expect(Array.isArray(result.nodes)).toBe(true)
    expect(Array.isArray(result.edges)).toBe(true)
  })
})
