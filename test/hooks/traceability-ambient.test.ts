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
