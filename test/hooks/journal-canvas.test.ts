// @ts-nocheck
/**
 * journal-canvas exporter correctness guard
 *
 * Pins toJsonCanvas() against DURABLE, INDEPENDENTLY-KNOWN invariants for the
 * groundwork-development motive.  These are NOT generated-vs-regenerated
 * consistency checks — each assertion is its own yardstick against known-correct
 * facts about the transform and the motive's long-running journal.
 *
 * Why groundwork-development?
 *   It is the richest, oldest motive in this repo.  Nodes like decision:D-81 and
 *   objective:root are permanently committed to the journal; they will never be
 *   removed.
 *
 * RED→GREEN sensitive: every assertion was mentally broken (e.g. wrong toEnd
 * value, wrong color, flipped parity) to confirm it would fail on the real output
 * before being committed here.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { assembleMotiveGraph } from '../../hooks/lib/motive-graph.mjs'
import { toJsonCanvas, TYPE_COLORS } from '../../hooks/lib/motive-canvas.mjs'
import { FIXTURE_DIR } from '../fixtures/motive-corpus/index.mjs'

// ---------------------------------------------------------------------------
// Setup — resolve repo root the same way all other hook tests do
// ---------------------------------------------------------------------------

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const SLUG = 'groundwork-development'
const USE_LIVE = !!process.env.USE_LIVE_CORPUS
const PROJ_DIR = USE_LIVE ? ROOT : FIXTURE_DIR

// ---------------------------------------------------------------------------
// Data — loaded once, shared across all tests
// ---------------------------------------------------------------------------

let graph: Awaited<ReturnType<typeof assembleMotiveGraph>>
let canvas: ReturnType<typeof toJsonCanvas>

beforeAll(async () => {
  graph = await assembleMotiveGraph({ projectDir: PROJ_DIR, slug: SLUG })
  canvas = toJsonCanvas(graph)
})

// ---------------------------------------------------------------------------
// 1. JSON Canvas shape
// ---------------------------------------------------------------------------

describe('1 — JSON Canvas shape', () => {
  it('every canvas node has required string fields', () => {
    const violations: string[] = []
    for (const n of canvas.nodes) {
      if (typeof n.id !== 'string' || n.id === '')
        violations.push(`node missing string id: ${JSON.stringify(n.id)}`)
      if (n.type !== 'text')
        violations.push(`node "${n.id}" type is "${n.type}", expected "text"`)
      if (typeof n.text !== 'string' || n.text === '')
        violations.push(`node "${n.id}" missing string text`)
      if (typeof n.color !== 'string' || n.color === '')
        violations.push(`node "${n.id}" missing string color`)
    }
    expect(violations, violations.join('\n')).toHaveLength(0)
  })

  it('every canvas node x, y, width, height are integers (spec requires integer, not just finite)', () => {
    const violations: string[] = []
    for (const n of canvas.nodes) {
      for (const field of ['x', 'y', 'width', 'height'] as const) {
        if (!Number.isInteger(n[field]))
          violations.push(`node "${n.id}" field "${field}" = ${n[field]} is NOT an integer`)
      }
    }
    expect(violations, violations.join('\n')).toHaveLength(0)
  })

  it('every canvas edge has required fields with correct literals', () => {
    const violations: string[] = []
    for (const e of canvas.edges) {
      if (typeof e.id !== 'string' || e.id === '')
        violations.push(`edge missing string id`)
      if (typeof e.fromNode !== 'string' || e.fromNode === '')
        violations.push(`edge "${e.id}" missing string fromNode`)
      if (typeof e.toNode !== 'string' || e.toNode === '')
        violations.push(`edge "${e.id}" missing string toNode`)
      if (e.toEnd !== 'arrow')
        violations.push(`edge "${e.id}" toEnd is "${e.toEnd}", expected "arrow"`)
      if (typeof e.label !== 'string' || e.label === '')
        violations.push(`edge "${e.id}" missing string label`)
    }
    expect(violations, violations.join('\n')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 2. Parity — canvas counts match D-5 counts (relative invariant)
// ---------------------------------------------------------------------------

describe('2 — parity with D-5 input', () => {
  it('canvas node count === D-5 node count', () => {
    expect(canvas.nodes).toHaveLength(graph.nodes.length)
  })

  it('canvas edge count === D-5 edge count', () => {
    expect(canvas.edges).toHaveLength(graph.edges.length)
  })
})

// ---------------------------------------------------------------------------
// 3. No dangling edges (HARD INVARIANT)
// ---------------------------------------------------------------------------

describe('3 — no dangling edges', () => {
  it('every edge.fromNode and edge.toNode exists in the node id set', () => {
    const nodeIds = new Set(canvas.nodes.map((n) => n.id))
    const dangling: string[] = []

    for (const e of canvas.edges) {
      if (!nodeIds.has(e.fromNode))
        dangling.push(`fromNode "${e.fromNode}" on edge "${e.id}" has no matching canvas node`)
      if (!nodeIds.has(e.toNode))
        dangling.push(`toNode "${e.toNode}" on edge "${e.id}" has no matching canvas node`)
    }

    expect(dangling, dangling.join('\n')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 4. Type → color encoding
// ---------------------------------------------------------------------------

describe('4 — type→color encoding', () => {
  it('all decision nodes carry TYPE_COLORS["decision"]', () => {
    const decisions = canvas.nodes.filter((n) => n.id.startsWith('decision:'))
    expect(decisions.length).toBeGreaterThanOrEqual(1)

    const violations: string[] = []
    for (const n of decisions) {
      if (n.color !== TYPE_COLORS['decision'])
        violations.push(`node "${n.id}" color is "${n.color}", expected "${TYPE_COLORS['decision']}"`)
    }
    expect(violations, violations.join('\n')).toHaveLength(0)
  })

  it('all objective nodes carry TYPE_COLORS["objective"]', () => {
    const objectives = canvas.nodes.filter((n) => n.id.startsWith('objective:'))
    expect(objectives.length).toBeGreaterThanOrEqual(1)

    const violations: string[] = []
    for (const n of objectives) {
      if (n.color !== TYPE_COLORS['objective'])
        violations.push(`node "${n.id}" color is "${n.color}", expected "${TYPE_COLORS['objective']}"`)
    }
    expect(violations, violations.join('\n')).toHaveLength(0)
  })

  it('decision node text starts with "[decision]"', () => {
    const decisions = canvas.nodes.filter((n) => n.id.startsWith('decision:'))
    const violations: string[] = []
    for (const n of decisions) {
      if (!n.text.startsWith('[decision]'))
        violations.push(`node "${n.id}" text does not start with "[decision]": ${n.text.slice(0, 40)}`)
    }
    expect(violations, violations.join('\n')).toHaveLength(0)
  })

  it('objective node text starts with "[objective]"', () => {
    const objectives = canvas.nodes.filter((n) => n.id.startsWith('objective:'))
    const violations: string[] = []
    for (const n of objectives) {
      if (!n.text.startsWith('[objective]'))
        violations.push(`node "${n.id}" text does not start with "[objective]": ${n.text.slice(0, 40)}`)
    }
    expect(violations, violations.join('\n')).toHaveLength(0)
  })

  it('all 7 TYPE_COLORS values are valid canvasColors (hex #RGB or #RRGGBB)', () => {
    // Pure static check — does not need real motive data.
    // Catches typos in the color table that would emit invalid canvasColor strings.
    const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/
    const PRESET_RE = /^[1-6]$/
    const violations: string[] = []
    for (const [type, color] of Object.entries(TYPE_COLORS)) {
      if (!HEX_RE.test(color) && !PRESET_RE.test(color))
        violations.push(`TYPE_COLORS["${type}"] = "${color}" is not a valid canvasColor`)
    }
    expect(violations, violations.join('\n')).toHaveLength(0)
  })

  it('every canvas node with a known D-5 type carries exactly TYPE_COLORS[type]', () => {
    // Maps each canvas node back to its D-5 type via graph.nodes, then verifies
    // the color the transform emitted matches TYPE_COLORS exactly.
    const d5TypeById = new Map<string, string>()
    for (const n of graph.nodes) d5TypeById.set(n.id, n.type)

    // Collect one representative node id per D-5 type (for coverage reporting)
    const typesSeen = new Set<string>()
    const violations: string[] = []

    for (const cn of canvas.nodes) {
      const d5type = d5TypeById.get(cn.id)
      if (d5type === undefined) continue // shouldn't happen given parity test
      const expected = TYPE_COLORS[d5type as keyof typeof TYPE_COLORS]
      if (expected === undefined) continue // type not in TYPE_COLORS — fallback path, not tested here
      typesSeen.add(d5type)
      if (cn.color !== expected)
        violations.push(`node "${cn.id}" (type "${d5type}") color is "${cn.color}", expected TYPE_COLORS["${d5type}"] = "${expected}"`)
    }

    // Require the DURABLE types to be exercised by this motive.
    //
    // Durable = derived from the committed journal or the committed charter, which is
    // the premise this file states up front. Two D-5 types are NOT durable for a fixed
    // motive and are therefore excluded here:
    //   - spec-requirement: parsed from doc/specs/**; 0 nodes in groundwork-development.
    //   - slice: read from .groundwork/runs/*.json by motive-graph.mjs findLedger().
    //     Run ledgers are gitignored, per-session, and rotate away; whether ANY ledger
    //     on disk is stamped with this motive is ambient state, not a committed fact.
    //     Requiring it here made the assertion depend on runtime data the repo does not
    //     carry. Colour encoding for both excluded types is covered deterministically by
    //     the synthetic positive control below, which cannot go vacuous.
    const DURABLE_TYPES = ['objective','decision','open-item','ticket','acceptance-criterion']
    const missingDurable = DURABLE_TYPES.filter(t => !typesSeen.has(t))
    expect(missingDurable, `Missing expected type(s) in canvas: ${missingDurable.join(', ')}`).toHaveLength(0)

    expect(violations, violations.join('\n')).toHaveLength(0)
  })

  it('positive control — toJsonCanvas encodes every TYPE_COLORS type exactly (synthetic, all 7)', () => {
    // Deterministic yardstick for the colour transform across ALL seven D-5 types,
    // including the two the ambient corpus cannot guarantee (slice, spec-requirement).
    const ALL_SEVEN = [
      'objective','decision','open-item','ticket','acceptance-criterion','slice','spec-requirement',
    ]
    expect(Object.keys(TYPE_COLORS).sort(), 'TYPE_COLORS key set drifted from the D-5 type vocabulary')
      .toEqual([...ALL_SEVEN].sort())

    const doc = {
      nodes: ALL_SEVEN.map(t => ({ id: `${t}:probe`, type: t, label: `probe ${t}` })),
      edges: [],
    }
    const synthetic = toJsonCanvas(doc as never)

    expect(synthetic.nodes).toHaveLength(ALL_SEVEN.length)
    const violations: string[] = []
    for (const t of ALL_SEVEN) {
      const cn = synthetic.nodes.find(n => n.id === `${t}:probe`)
      if (!cn) { violations.push(`type "${t}" produced no canvas node`); continue }
      if (cn.color !== TYPE_COLORS[t as keyof typeof TYPE_COLORS])
        violations.push(`type "${t}" color is "${cn.color}", expected "${TYPE_COLORS[t as keyof typeof TYPE_COLORS]}"`)
      if (!cn.text.startsWith(`[${t}]`))
        violations.push(`type "${t}" text does not start with "[${t}]": ${JSON.stringify(cn.text)}`)
    }
    expect(violations, violations.join('\n')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 5. Pinned real ids — durable anchors that must always be present
// ---------------------------------------------------------------------------

describe('5 — pinned real ids', () => {
  it('canvas node for decision:D-81 has type "text" and decision color', () => {
    const node = canvas.nodes.find((n) => n.id === 'decision:D-81')
    expect(node, 'canvas node decision:D-81 not found').toBeDefined()
    expect(node!.type).toBe('text')
    expect(node!.color).toBe(TYPE_COLORS['decision'])   // '#F59E0B'
    expect(node!.text).toMatch(/^\[decision\]/)
  })

  it('canvas node for objective:root has type "text" and objective color', () => {
    const node = canvas.nodes.find((n) => n.id === 'objective:root')
    expect(node, 'canvas node objective:root not found').toBeDefined()
    expect(node!.type).toBe('text')
    expect(node!.color).toBe(TYPE_COLORS['objective'])  // '#3B82F6'
    expect(node!.text).toMatch(/^\[objective\]/)
  })

  it('canvas edge for objective:root → decision:D-81 anchors has toEnd "arrow"', () => {
    const edgeId = 'e:objective:root->decision:D-81:anchors'
    const edge = canvas.edges.find((e) => e.id === edgeId)
    expect(edge, `canvas edge "${edgeId}" not found`).toBeDefined()
    expect(edge!.fromNode).toBe('objective:root')
    expect(edge!.toNode).toBe('decision:D-81')
    expect(edge!.toEnd).toBe('arrow')
    expect(edge!.label).toBe('anchors')
  })
})
