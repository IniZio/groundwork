// @ts-nocheck
/**
 * journal-graph exporter correctness guard
 *
 * Pins assembleMotiveGraph() against DURABLE, INDEPENDENTLY-KNOWN invariants
 * for the groundwork-development motive.  These are NOT generated-vs-regenerated
 * consistency checks — each assertion is its own yardstick against known-correct
 * facts about the motive's long-running journal.
 *
 * Why groundwork-development?
 *   It is the richest, oldest motive in this repo.  Decisions like D-81/D-82 are
 *   permanently committed to the journal; they will never be removed.
 *
 * RED→GREEN sensitive: every assertion was mentally broken (e.g. 'decision:D-99'
 * instead of 'decision:D-81') to confirm it would fail on the real output before
 * being committed here.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { assembleMotiveGraph, EDGE_KINDS } from '../../hooks/lib/motive-graph.mjs'

// ---------------------------------------------------------------------------
// Setup — resolve repo root the same way all other hook tests do
// ---------------------------------------------------------------------------

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const SLUG = 'groundwork-development'

// Canonical type → id-prefix map (must match the source in motive-graph.mjs)
const TYPE_PREFIX: Record<string, string> = {
  objective: 'objective:',
  decision: 'decision:',
  'open-item': 'openitem:',
  ticket: 'ticket:',
  'acceptance-criterion': 'ac:',
  slice: 'slice:',
  'spec-requirement': 'req:',
}

// Allowed edge kinds per schema (EdgeKind ∈ … comment in motive-graph.mjs)
const ALLOWED_EDGE_KINDS = new Set([
  'anchors',
  'resolved_by',
  'graduated_to',
  'blocked_by',
  'covers_ac',
  'slice_decision',
  'spec_xref',
])

// ---------------------------------------------------------------------------
// Graph — loaded once, shared across all its
// ---------------------------------------------------------------------------

let graph: Awaited<ReturnType<typeof assembleMotiveGraph>>

beforeAll(async () => {
  graph = await assembleMotiveGraph({ projectDir: ROOT, slug: SLUG })
})

// ---------------------------------------------------------------------------
// 1. Schema shape
// ---------------------------------------------------------------------------

describe('1 — schema shape', () => {
  it('schema_version === 1', () => {
    expect(graph.schema_version).toBe(1)
  })

  it('motive slug matches request', () => {
    expect(graph.motive).toBe(SLUG)
  })

  it('nodes is an array', () => {
    expect(Array.isArray(graph.nodes)).toBe(true)
  })

  it('edges is an array', () => {
    expect(Array.isArray(graph.edges)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. Objective root
// ---------------------------------------------------------------------------

describe('2 — objective root', () => {
  it('exactly one node with id "objective:root" and type "objective"', () => {
    const roots = graph.nodes.filter((n) => n.id === 'objective:root')
    expect(roots).toHaveLength(1)
    expect(roots[0].type).toBe('objective')
  })
})

// ---------------------------------------------------------------------------
// 3. Durable decisions present
// ---------------------------------------------------------------------------

describe('3 — durable decisions present', () => {
  it('node decision:D-81 exists with type "decision"', () => {
    const node = graph.nodes.find((n) => n.id === 'decision:D-81')
    expect(node).toBeDefined()
    expect(node!.type).toBe('decision')
  })

  it('node decision:D-82 exists with type "decision"', () => {
    const node = graph.nodes.find((n) => n.id === 'decision:D-82')
    expect(node).toBeDefined()
    expect(node!.type).toBe('decision')
  })
})

// ---------------------------------------------------------------------------
// 4. Durable anchors edge
// ---------------------------------------------------------------------------

describe('4 — durable anchors edge', () => {
  it('edge objective:root → decision:D-81 with kind "anchors" exists', () => {
    const edge = graph.edges.find(
      (e) => e.source === 'objective:root' && e.target === 'decision:D-81' && e.kind === 'anchors',
    )
    expect(edge).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 5. HARD INVARIANT — zero dangling edges
// ---------------------------------------------------------------------------

describe('5 — zero dangling edges (HARD INVARIANT)', () => {
  it('every edge source and target is a known node id', () => {
    const nodeIds = new Set(graph.nodes.map((n) => n.id))
    const dangling: string[] = []

    for (const e of graph.edges) {
      if (!nodeIds.has(e.source)) dangling.push(`source "${e.source}" (→ ${e.target})`)
      if (!nodeIds.has(e.target)) dangling.push(`target "${e.target}" (← ${e.source})`)
    }

    expect(dangling, `Dangling edge endpoints: ${dangling.join(', ')}`).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 6. Id-prefix convention
// ---------------------------------------------------------------------------

describe('6 — id-prefix convention', () => {
  it('every node id starts with the canonical prefix for its type', () => {
    const violations: string[] = []

    for (const n of graph.nodes) {
      const expectedPrefix = TYPE_PREFIX[n.type]
      if (expectedPrefix === undefined) {
        violations.push(`unknown type "${n.type}" on node "${n.id}"`)
      } else if (!n.id.startsWith(expectedPrefix)) {
        violations.push(`node "${n.id}" has type "${n.type}" but id does not start with "${expectedPrefix}"`)
      }
    }

    expect(violations, violations.join('\n')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 7. Edge-kind domain
// ---------------------------------------------------------------------------

describe('7 — edge-kind domain', () => {
  it('every edge kind is one of the 7 allowed kinds', () => {
    const violations = graph.edges
      .filter((e) => !ALLOWED_EDGE_KINDS.has(e.kind))
      .map((e) => `"${e.kind}" on ${e.source} → ${e.target}`)

    expect(violations, violations.join('\n')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 8. graduated_to shape (durable)
// ---------------------------------------------------------------------------

describe('8 — graduated_to shape', () => {
  it('at least one graduated_to edge exists', () => {
    const graduated = graph.edges.filter((e) => e.kind === 'graduated_to')
    expect(graduated.length).toBeGreaterThanOrEqual(1)
  })

  it('every graduated_to edge has open-item source and ticket target', () => {
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
    const graduated = graph.edges.filter((e) => e.kind === 'graduated_to')
    const violations: string[] = []

    for (const e of graduated) {
      const src = nodeById.get(e.source)
      const tgt = nodeById.get(e.target)
      if (src?.type !== 'open-item') {
        violations.push(`source "${e.source}" has type "${src?.type ?? 'UNKNOWN'}" (expected open-item)`)
      }
      if (tgt?.type !== 'ticket') {
        violations.push(`target "${e.target}" has type "${tgt?.type ?? 'UNKNOWN'}" (expected ticket)`)
      }
    }

    expect(violations, violations.join('\n')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 10. EDGE_KINDS vocabulary
// ---------------------------------------------------------------------------

describe('10 — EDGE_KINDS vocabulary', () => {
  const EXPECTED_KINDS = [
    'anchors',
    'resolved_by',
    'graduated_to',
    'blocked_by',
    'covers_ac',
    'slice_decision',
    'spec_xref',
  ] as const

  it('EDGE_KINDS has exactly the 7 expected kind keys', () => {
    const keys = Object.keys(EDGE_KINDS).sort()
    expect(keys).toEqual([...EXPECTED_KINDS].sort())
  })

  it('PARITY: vocabulary keys match the set of kind values actually emitted by assembleMotiveGraph', () => {
    const emittedKinds = new Set(graph.edges.map((e: { kind: string }) => e.kind))
    const vocabKinds = new Set(Object.keys(EDGE_KINDS))
    // Every emitted kind must be in the vocabulary
    const missing = [...emittedKinds].filter((k) => !vocabKinds.has(k))
    expect(missing, `Emitted kinds missing from vocabulary: ${missing.join(', ')}`).toHaveLength(0)
  })

  it('anchors: drives_layering=true, render=primary, direction=down', () => {
    expect(EDGE_KINDS.anchors).toEqual({ drives_layering: true, render: 'primary', direction: 'down' })
  })

  it('resolved_by: drives_layering=false, render=muted, direction=lateral', () => {
    expect(EDGE_KINDS.resolved_by).toEqual({ drives_layering: false, render: 'muted', direction: 'lateral' })
  })

  it('graduated_to: drives_layering=false, render=muted, direction=lateral', () => {
    expect(EDGE_KINDS.graduated_to).toEqual({ drives_layering: false, render: 'muted', direction: 'lateral' })
  })

  it('blocked_by: drives_layering=true, render=primary, direction=up', () => {
    expect(EDGE_KINDS.blocked_by).toEqual({ drives_layering: true, render: 'primary', direction: 'up' })
  })

  it('covers_ac: drives_layering=true, render=primary, direction=down', () => {
    expect(EDGE_KINDS.covers_ac).toEqual({ drives_layering: true, render: 'primary', direction: 'down' })
  })

  it('slice_decision: drives_layering=true, render=hidden, direction=up', () => {
    expect(EDGE_KINDS.slice_decision).toEqual({ drives_layering: true, render: 'hidden', direction: 'up' })
  })

  it('spec_xref: drives_layering=false, render=muted, direction=lateral', () => {
    expect(EDGE_KINDS.spec_xref).toEqual({ drives_layering: false, render: 'muted', direction: 'lateral' })
  })

  it('every entry has the expected shape (drives_layering, render, direction)', () => {
    const validRender = new Set(['primary', 'muted', 'hidden'])
    const validDirection = new Set(['down', 'up', 'lateral'])
    for (const [kind, entry] of Object.entries(EDGE_KINDS)) {
      expect(typeof entry.drives_layering, `${kind}.drives_layering`).toBe('boolean')
      expect(validRender.has(entry.render), `${kind}.render="${entry.render}" invalid`).toBe(true)
      expect(validDirection.has(entry.direction), `${kind}.direction="${entry.direction}" invalid`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 9. CLI: non-zero exit for unknown motive (optional)
// ---------------------------------------------------------------------------

describe('9 — CLI error path (optional)', () => {
  it('journal.mjs graph exits non-zero for an unknown motive', () => {
    const CLI = join(ROOT, 'hooks', 'journal.mjs')
    const result = spawnSync(process.execPath, [CLI, 'graph', 'no-such-motive-xyzzy', '--json'], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
      timeout: 10_000,
    })
    // A non-zero exit or an error property indicates the motive was rejected
    const exited = result.status !== null ? result.status !== 0 : result.error != null
    expect(exited).toBe(true)
  })
})
