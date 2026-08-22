/**
 * Tests for hooks/lib/traceability-ambient.mjs
 *
 * Covers:
 *   S5-AC-1 — Wave-band topological layout: each tier has a representation.
 *   S5-AC-2 — Semantic edge styling: edges carry classification-based attributes.
 *   S5-AC-3 — Needs-You list: unproven/stale/missing links are surfaced.
 *   S5-D-2  — TRACE.html output path exists after regeneration.
 *   S5-D-9  — Three D-9 patterns present in the rendered HTML.
 *   Offline  — Output contains no external URLs (self-contained).
 */

import { describe, it, expect } from 'vitest'
import { renderTraceHtml } from '../../hooks/lib/traceability-ambient.mjs'

// ---------------------------------------------------------------------------
// Helpers — build minimal ClassifiedGraph fixtures
// ---------------------------------------------------------------------------

type MinNode = { type: string; id: string; label?: string }
type MinEdge = { source: string; target: string; kind: string; classification: 'proven' | 'unproven' | 'stale' | 'missing' }

function makeGraph(nodes: MinNode[], edges: MinEdge[]) {
  return { nodes, edges, artifactEvidence: [] }
}

/** One node of every primary tier type. */
const ALL_TIER_NODES: MinNode[] = [
  { type: 'objective',         id: 'objective:motive',  label: 'Ship it' },
  { type: 'spec-requirement',  id: 'spec-requirement:R-001', label: 'R-001' },
  { type: 'slice',             id: 'slice:S1',          label: 'S1' },
  { type: 'self-test',         id: 'self-test:S1:t1',   label: 'test-S1' },
  { type: 'live-verify',       id: 'live-verify:v1',    label: 'verify-v1' },
  { type: 'gate',              id: 'gate:advisor',      label: 'advisor' },
  { type: 'artifact-evidence', id: 'artifact-evidence:shot.png', label: 'shot.png' },
]

const PROVEN_EDGE: MinEdge = {
  source: 'slice:S1', target: 'spec-requirement:R-001',
  kind: 'covers', classification: 'proven',
}
const UNPROVEN_EDGE: MinEdge = {
  source: 'spec-requirement:R-001', target: 'objective:motive',
  kind: 'covers', classification: 'unproven',
}
const STALE_EDGE: MinEdge = {
  source: 'self-test:S1:t1', target: 'slice:S1',
  kind: 'verifies', classification: 'stale',
}
const MISSING_EDGE: MinEdge = {
  source: 'spec-requirement:R-001', target: 'objective:motive',
  kind: 'covers', classification: 'missing',
}

// ---------------------------------------------------------------------------
// AC-1: Wave-band topological layout — node per tier
// ---------------------------------------------------------------------------

describe('renderTraceHtml — AC-1: wave-band tier layout', () => {
  it('produces a tier swimlane for each active node type', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, []), 'test-motive')

    // Each tier must have a data-tier attribute in a rect (the swimlane band)
    expect(html).toContain('data-tier="objective"')
    expect(html).toContain('data-tier="spec-requirement"')
    expect(html).toContain('data-tier="slice"')
    expect(html).toContain('data-tier="self-test"')
    expect(html).toContain('data-tier="live-verify"')
    expect(html).toContain('data-tier="gate"')
    expect(html).toContain('data-tier="artifact-evidence"')
  })

  it('labels each tier by human-readable name', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, []), 'test-motive')
    expect(html).toContain('Objective')
    expect(html).toContain('Spec Requirements')
    expect(html).toContain('Slices')
    expect(html).toContain('Self-Tests')
    expect(html).toContain('Live Verifications')
    expect(html).toContain('Gate Verdicts')
    expect(html).toContain('Artifact Evidence')
  })

  it('emits a node group element for each node', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, [PROVEN_EDGE]), 'test-motive')
    for (const n of ALL_TIER_NODES) {
      expect(html).toContain(`data-id="${n.id}"`)
    }
  })

  it('renders no tier bands for an empty graph', () => {
    const html = renderTraceHtml(makeGraph([], []), 'test-motive')
    expect(html).not.toContain('data-tier="objective"')
    expect(html).toContain('0 active tiers')
  })
})

// ---------------------------------------------------------------------------
// AC-2: Semantic edge styling — classification-based attributes and colors
// ---------------------------------------------------------------------------

describe('renderTraceHtml — AC-2: semantic edge styling', () => {
  it('adds data-classification="proven" on a proven edge', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, [PROVEN_EDGE]), 'test-motive')
    expect(html).toContain('data-classification="proven"')
    expect(html).toContain('class="edge edge-proven"')
    expect(html).toContain('#22c55e')  // green stroke
  })

  it('adds data-classification="unproven" on an unproven edge with amber color', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, [UNPROVEN_EDGE]), 'test-motive')
    expect(html).toContain('data-classification="unproven"')
    expect(html).toContain('class="edge edge-unproven"')
    expect(html).toContain('#d97706')  // amber stroke
    // Unproven edges are dashed
    expect(html).toContain('stroke-dasharray')
  })

  it('adds data-classification="stale" on a stale edge with red color', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, [STALE_EDGE]), 'test-motive')
    expect(html).toContain('data-classification="stale"')
    expect(html).toContain('class="edge edge-stale"')
    expect(html).toContain('#ef4444')  // red stroke
  })

  it('adds data-classification="missing" on a missing edge with dashed red', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, [MISSING_EDGE]), 'test-motive')
    expect(html).toContain('data-classification="missing"')
    expect(html).toContain('class="edge edge-missing"')
    expect(html).toContain('#dc2626')  // darker red stroke
  })

  it('renders the edge kind as a data attribute', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, [PROVEN_EDGE, STALE_EDGE]), 'test-motive')
    expect(html).toContain('data-kind="covers"')
    expect(html).toContain('data-kind="verifies"')
  })

  it('uses SVG path elements for edges', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, [PROVEN_EDGE]), 'test-motive')
    // path with cubic bezier (C command)
    expect(html).toMatch(/<path class="edge[^"]*" data-classification="proven"/)
    expect(html).toContain(' C ')  // cubic bezier control point
  })
})

// ---------------------------------------------------------------------------
// AC-3: Needs-You list — unproven + stale + missing surfaced
// ---------------------------------------------------------------------------

describe('renderTraceHtml — AC-3: Needs-You list', () => {
  it('shows Needs You section with count when unproven edges exist', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, [UNPROVEN_EDGE]), 'test-motive')
    expect(html).toContain('Needs You')
    expect(html).toContain('class="needs-item needs-unproven"')
    expect(html).toContain('badge-unproven')
  })

  it('lists stale edges in the Needs-You section', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, [STALE_EDGE]), 'test-motive')
    expect(html).toContain('class="needs-item needs-stale"')
    expect(html).toContain('badge-stale')
  })

  it('lists missing edges in the Needs-You section', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, [MISSING_EDGE]), 'test-motive')
    expect(html).toContain('class="needs-item needs-missing"')
    expect(html).toContain('badge-missing')
  })

  it('shows count of needs-attention items', () => {
    const edges = [UNPROVEN_EDGE, STALE_EDGE, MISSING_EDGE]
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, edges), 'test-motive')
    expect(html).toContain('(3)')
  })

  it('shows "all good" message when every edge is proven', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, [PROVEN_EDGE]), 'test-motive')
    expect(html).toContain('all-good')
    expect(html).not.toContain('needs-item needs-unproven')
    expect(html).not.toContain('needs-item needs-stale')
  })

  it('excludes proven edges from the Needs-You list', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, [PROVEN_EDGE, UNPROVEN_EDGE]), 'test-motive')
    // Only 1 unproven item should appear — proven must NOT be in needs-list
    expect(html).toContain('(1)')
    expect(html).not.toContain('badge-proven')
  })
})

// ---------------------------------------------------------------------------
// Offline: no external URLs in generated HTML
// ---------------------------------------------------------------------------

describe('renderTraceHtml — offline / self-contained', () => {
  it('contains no http:// or https:// URLs pointing to external resources', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, [PROVEN_EDGE, UNPROVEN_EDGE, STALE_EDGE]), 'test-motive')

    // Strip XML/HTML comments and <title> text — those may mention URLs in prose
    const stripped = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<title>[^<]*<\/title>/g, '')

    // Should have no src= or href= pointing to external hosts
    const externalUrlPattern = /(src|href|url)\s*=\s*["']https?:\/\//gi
    const externalMatches = stripped.match(externalUrlPattern)
    expect(externalMatches).toBeNull()

    // Should have no @import from an external URL
    const importPattern = /@import\s+url\s*\(\s*["']?https?:\/\//gi
    expect(stripped.match(importPattern)).toBeNull()
  })

  it('is a valid HTML document with head and body', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, [PROVEN_EDGE]), 'test-motive')
    expect(html).toMatch(/^<!DOCTYPE html>/i)
    expect(html).toContain('<head>')
    expect(html).toContain('<body>')
    expect(html).toContain('</html>')
  })

  it('includes inline CSS (no external stylesheet)', () => {
    const html = renderTraceHtml(makeGraph([], []), 'test-motive')
    expect(html).toContain('<style>')
    expect(html).not.toMatch(/<link[^>]+stylesheet[^>]+https?:\/\//)
  })

  it('includes the slug in the page title', () => {
    const html = renderTraceHtml(makeGraph([], []), 'my-motive')
    expect(html).toContain('<title>Traceability — my-motive</title>')
  })
})

// ---------------------------------------------------------------------------
// V3: Wave banding — slice nodes banded by explicit wave or topo fallback
// ---------------------------------------------------------------------------

describe('renderTraceHtml — V3: wave banding for slice nodes', () => {
  it('places all slices in a single "Slices" band when only one wave exists', () => {
    const nodes: MinNode[] = [
      { type: 'slice', id: 'slice:S1', label: 'S1' },
      { type: 'slice', id: 'slice:S2', label: 'S2' },
    ]
    const html = renderTraceHtml(makeGraph(nodes, []), 'test-motive')
    // Single wave → label is "Slices", no wave suffix
    expect(html).toContain('data-tier="slice"')
    // Should NOT produce "Wave" suffix when only one wave
    expect(html).not.toContain('Wave 0')
    expect(html).not.toContain('Wave 1')
  })

  it('splits slices into multiple wave bands when explicit wave differs', () => {
    const nodes = [
      { type: 'slice', id: 'slice:S1', label: 'S1', wave: 0, status: 'complete', blocked_by: [] },
      { type: 'slice', id: 'slice:S2', label: 'S2', wave: 1, status: 'pending',  blocked_by: ['slice:S1'] },
      { type: 'slice', id: 'slice:S3', label: 'S3', wave: 2, status: 'pending',  blocked_by: ['slice:S2'] },
    ]
    const html = renderTraceHtml(makeGraph(nodes, []), 'test-motive')
    // Wave suffix labels must appear
    expect(html).toContain('Wave 0')
    expect(html).toContain('Wave 1')
    expect(html).toContain('Wave 2')
    // All three slice nodes still present
    expect(html).toContain('data-id="slice:S1"')
    expect(html).toContain('data-id="slice:S2"')
    expect(html).toContain('data-id="slice:S3"')
  })

  it('uses topological depth as fallback when wave is null', () => {
    // S1 has no blockers → topo layer 0; S2 blocked by S1 → topo layer 1
    const nodes = [
      { type: 'slice', id: 'slice:S1', label: 'S1', wave: null, status: 'complete', blocked_by: [] },
      { type: 'slice', id: 'slice:S2', label: 'S2', wave: null, status: 'pending',  blocked_by: ['slice:S1'] },
    ]
    const html = renderTraceHtml(makeGraph(nodes, []), 'wave-null-motive')
    // Two waves → must produce wave-suffix labels
    expect(html).toContain('Wave 0')
    expect(html).toContain('Wave 1')
  })

  it('does not crash or emit wave bands when graph has no slice nodes', () => {
    const nodes: MinNode[] = [
      { type: 'objective', id: 'objective:O1', label: 'Obj' },
    ]
    const html = renderTraceHtml(makeGraph(nodes, []), 'no-slices')
    expect(html).not.toContain('data-tier="slice"')
    expect(html).not.toContain('Wave ')
  })
})

// ---------------------------------------------------------------------------
// V3: Frontier distinction — ready-now slices must be visually distinct
// ---------------------------------------------------------------------------

describe('renderTraceHtml — V3: frontier visual distinction', () => {
  it('marks a pending slice with no blockers as data-frontier="true"', () => {
    const nodes = [
      { type: 'slice', id: 'slice:S1', label: 'S1', status: 'pending', blocked_by: [] },
    ]
    const html = renderTraceHtml(makeGraph(nodes, []), 'frontier-motive')
    expect(html).toContain('data-frontier="true"')
    expect(html).toContain('class="node node-slice node-frontier"')
  })

  it('emits a frontier-ring rect for frontier slice nodes', () => {
    const nodes = [
      { type: 'slice', id: 'slice:S1', label: 'S1', status: 'pending', blocked_by: [] },
    ]
    const html = renderTraceHtml(makeGraph(nodes, []), 'frontier-motive')
    expect(html).toContain('class="frontier-ring"')
    expect(html).toContain('#f59e0b') // gold stroke
  })

  it('shows the frontier slice in the Ready Now section', () => {
    const nodes = [
      { type: 'slice', id: 'slice:S1', label: 'S1', status: 'pending', blocked_by: [] },
    ]
    const html = renderTraceHtml(makeGraph(nodes, []), 'frontier-motive')
    expect(html).toContain('Ready Now')
    expect(html).toContain('badge-frontier')
    expect(html).toContain('READY')
  })

  it('does not mark a complete slice as frontier', () => {
    const nodes = [
      { type: 'slice', id: 'slice:S1', label: 'S1', status: 'complete', blocked_by: [] },
    ]
    const html = renderTraceHtml(makeGraph(nodes, []), 'complete-motive')
    expect(html).not.toContain('data-frontier="true"')
    expect(html).not.toContain('class="frontier-ring"')
  })

  it('does not mark a slice with an incomplete blocker as frontier', () => {
    const nodes = [
      { type: 'slice', id: 'slice:S1', label: 'S1', status: 'pending',  blocked_by: [] },
      { type: 'slice', id: 'slice:S2', label: 'S2', status: 'pending',  blocked_by: ['slice:S1'] },
    ]
    const html = renderTraceHtml(makeGraph(nodes, []), 'blocked-motive')
    // S1 is on frontier (no blockers), S2 is NOT (S1 is pending, not complete)
    expect(html).toContain('data-id="slice:S1"')
    // Only S1 should have data-frontier
    const frontierCount = (html.match(/data-frontier="true"/g) ?? []).length
    expect(frontierCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// V3: Blocked-chain reveal — transitive blockers discoverable without source
// ---------------------------------------------------------------------------

describe('renderTraceHtml — V3: blocked-chain reveal', () => {
  it('embeds data-blockers on a blocked slice node', () => {
    const nodes = [
      { type: 'slice', id: 'slice:S1', label: 'S1', status: 'pending',  blocked_by: [] },
      { type: 'slice', id: 'slice:S2', label: 'S2', status: 'pending',  blocked_by: ['slice:S1'] },
    ]
    const html = renderTraceHtml(makeGraph(nodes, []), 'blocked-motive')
    // S2 is blocked by S1 — data-blockers must appear on S2's node group
    expect(html).toContain('data-blockers=')
    expect(html).toContain('slice:S1')
  })

  it('shows blocked slice in Blocked Chains section with its blocker list', () => {
    const nodes = [
      { type: 'slice', id: 'slice:S1', label: 'S1', status: 'pending',  blocked_by: [] },
      { type: 'slice', id: 'slice:S2', label: 'S2', status: 'pending',  blocked_by: ['slice:S1'] },
    ]
    const html = renderTraceHtml(makeGraph(nodes, []), 'blocked-motive')
    expect(html).toContain('Blocked Chains')
    expect(html).toContain('blocked by')
    expect(html).toContain('class="blocked-item"')
  })

  it('reveals transitive (multi-hop) blocker chain in data-blockers', () => {
    // S3 blocked by S2 blocked by S1 → transitive chain is S1 + S2
    const nodes = [
      { type: 'slice', id: 'slice:S1', label: 'S1', status: 'pending', blocked_by: [] },
      { type: 'slice', id: 'slice:S2', label: 'S2', status: 'pending', blocked_by: ['slice:S1'] },
      { type: 'slice', id: 'slice:S3', label: 'S3', status: 'pending', blocked_by: ['slice:S2'] },
    ]
    const html = renderTraceHtml(makeGraph(nodes, []), 'transitive-motive')
    // S3's data-blockers must include slice:S1 (transitive) and slice:S2
    const match = html.match(/data-id="slice:S3"[^>]*>[\s\S]*?data-blockers="([^"]+)"/)
    // Alternatively just check the attribute appears in the right group element
    // The g element with data-id="slice:S3" should have data-blockers containing slice:S1
    expect(html).toMatch(/data-id="slice:S3"[^<]*data-blockers="[^"]*slice:S1/)
    expect(html).toMatch(/data-id="slice:S3"[^<]*data-blockers="[^"]*slice:S2/)
  })

  it('adds node-blocked CSS class to blocked (non-frontier) nodes', () => {
    const nodes = [
      { type: 'slice', id: 'slice:S1', label: 'S1', status: 'pending', blocked_by: [] },
      { type: 'slice', id: 'slice:S2', label: 'S2', status: 'pending', blocked_by: ['slice:S1'] },
    ]
    const html = renderTraceHtml(makeGraph(nodes, []), 'blocked-motive')
    expect(html).toContain('node-blocked')
  })
})

// ---------------------------------------------------------------------------
// V3: Cyclic fixture — no crash, no hang
// ---------------------------------------------------------------------------

describe('renderTraceHtml — V3: cycle safety', () => {
  it('does not crash or throw when slice graph contains a cycle', () => {
    // A → B → A (direct cycle)
    const nodes = [
      { type: 'slice', id: 'slice:A', label: 'A', status: 'pending', blocked_by: ['slice:B'] },
      { type: 'slice', id: 'slice:B', label: 'B', status: 'pending', blocked_by: ['slice:A'] },
    ]
    expect(() => renderTraceHtml(makeGraph(nodes, []), 'cyclic-motive')).not.toThrow()
  })

  it('still renders all cyclic nodes (they appear in the SVG)', () => {
    const nodes = [
      { type: 'slice', id: 'slice:A', label: 'A', status: 'pending', blocked_by: ['slice:B'] },
      { type: 'slice', id: 'slice:B', label: 'B', status: 'pending', blocked_by: ['slice:A'] },
    ]
    const html = renderTraceHtml(makeGraph(nodes, []), 'cyclic-motive')
    expect(html).toContain('data-id="slice:A"')
    expect(html).toContain('data-id="slice:B"')
  })

  it('does not emit "Wave" suffix for cyclic slices (fallback to wave 0)', () => {
    // Cyclic slices cannot be assigned topo layers → all fall back to wave 0 → single band
    const nodes = [
      { type: 'slice', id: 'slice:A', label: 'A', status: 'pending', blocked_by: ['slice:B'] },
      { type: 'slice', id: 'slice:B', label: 'B', status: 'pending', blocked_by: ['slice:A'] },
    ]
    const html = renderTraceHtml(makeGraph(nodes, []), 'cyclic-motive')
    // All cyclic slices land in wave 0 → only one wave → no "Wave N" label
    expect(html).not.toContain('Slices — Wave')
  })

  it('handles a 3-node cycle without hanging', () => {
    const nodes = [
      { type: 'slice', id: 'slice:X', label: 'X', status: 'pending', blocked_by: ['slice:Z'] },
      { type: 'slice', id: 'slice:Y', label: 'Y', status: 'pending', blocked_by: ['slice:X'] },
      { type: 'slice', id: 'slice:Z', label: 'Z', status: 'pending', blocked_by: ['slice:Y'] },
    ]
    const html = renderTraceHtml(makeGraph(nodes, []), 'cycle3-motive')
    expect(html).toContain('data-id="slice:X"')
    expect(html).toContain('data-id="slice:Y"')
    expect(html).toContain('data-id="slice:Z"')
  })
})

// ---------------------------------------------------------------------------
// V3: Determinism — same input → byte-identical output
// ---------------------------------------------------------------------------

describe('renderTraceHtml — V3: determinism', () => {
  it('produces byte-identical output across two calls with the same input', () => {
    const nodes = [
      ...ALL_TIER_NODES,
      { type: 'slice', id: 'slice:S2', label: 'S2', wave: 1, status: 'pending', blocked_by: ['slice:S1'] },
    ]
    // Replace S1 with a richer version that has blocked_by
    const richNodes = nodes.map((n) =>
      n.id === 'slice:S1'
        ? { ...n, wave: 0, status: 'complete', blocked_by: [] }
        : n
    )
    const edges = [PROVEN_EDGE, UNPROVEN_EDGE, STALE_EDGE]
    const graph = makeGraph(richNodes, edges)

    const html1 = renderTraceHtml(graph, 'determinism-motive')
    const html2 = renderTraceHtml(graph, 'determinism-motive')
    expect(html1).toBe(html2)
  })

  it('is deterministic for an empty graph', () => {
    const graph = makeGraph([], [])
    expect(renderTraceHtml(graph, 'empty')).toBe(renderTraceHtml(graph, 'empty'))
  })
})

// ---------------------------------------------------------------------------
// D-9: all three patterns present
// ---------------------------------------------------------------------------

describe('renderTraceHtml — D-9 pattern completeness', () => {
  it('renders a legend with all four classification labels', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, []), 'test-motive')
    expect(html).toContain('class="legend"')
    expect(html).toContain('Proven')
    expect(html).toContain('Unproven')
    expect(html).toContain('Stale')
    expect(html).toContain('Missing')
  })

  it('renders coverage stats (proven count, total, percent)', () => {
    const edges = [PROVEN_EDGE, UNPROVEN_EDGE]
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, edges), 'test-motive')
    expect(html).toContain('class="stat-card stat-proven"')
    expect(html).toContain('class="stat-card stat-unproven"')
    expect(html).toContain('%')
  })

  it('renders SVG with swimlanes and edges', () => {
    const html = renderTraceHtml(makeGraph(ALL_TIER_NODES, [PROVEN_EDGE]), 'test-motive')
    expect(html).toContain('<svg ')
    expect(html).toContain('viewBox=')
    expect(html).toContain('class="chart-wrap"')
  })
})
