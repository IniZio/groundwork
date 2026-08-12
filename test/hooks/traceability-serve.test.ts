/**
 * test/hooks/traceability-serve.test.ts
 *
 * Smoke test for hooks/traceability-serve.mjs (S6 of tracking-viz, AC-1..AC-3).
 *
 * Tests:
 *   1. GET /graph returns the classified graph JSON (nodes + edges with classification).
 *   2. GET / returns self-contained HTML with no external URLs (no bundler, no CDN).
 *
 * Full browser / live-verification is deferred to S8 / qa.
 *
 * @verifies S6-AC-1 (serve command exists and starts)
 * @verifies S6-AC-2 (GET /graph returns classified graph)
 * @verifies S6-AC-3 (GET / returns self-contained HTML)
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'

import { buildTraceabilityGraph } from '../../hooks/lib/traceability-join.mjs'
import { classifyTraceabilityGraph } from '../../hooks/lib/traceability-classify.mjs'
import { startServer } from '../../hooks/traceability-serve.mjs'

// ---------------------------------------------------------------------------
// Stub adapter (mirrors traceability-classify.test.ts pattern)
// ---------------------------------------------------------------------------

function makeAdapter(overrides: {
  slug?: string
  objective?: string
  slices?: object[]
  verificationEvents?: object[]
  gateEvents?: object[]
  specRequirements?: object[]
  coverageMap?: Record<string, { declared: string | null; verified: boolean; tests: string[] }>
} = {}) {
  return {
    getMotive:             () => overrides.slug ?? 'test-serve-motive',
    getObjective:          () => overrides.objective ?? 'Ship the interactive traceability graph',
    getSlices:             () => overrides.slices ?? [],
    getVerificationEvents: () => overrides.verificationEvents ?? [],
    getGateEvents:         () => overrides.gateEvents ?? [],
    getSpecRequirements:   () => overrides.specRequirements ?? [],
    getCoverageMap:        () => overrides.coverageMap ?? {},
  }
}

// ---------------------------------------------------------------------------
// Fixture: small but complete graph (objective + 1 slice + 1 gate APPROVE)
// ---------------------------------------------------------------------------

const FIXTURE_SLICES = [
  {
    id: 'S1',
    status: 'complete',
    desc: 'Pipeline adapter',
    blocked_by: [],
    covers_ac: [],
    decisions: [],
    test_paths: ['test/hooks/traceability-serve.test.ts'],
  },
]

const FIXTURE_SPEC_REQS = [
  {
    id: 'SRV-R-001',
    title: 'Serve must start',
    verification: 'automated',
    criticality: 'must',
    origin_decision_ref: null,
  },
]

const FIXTURE_GATE_EVENTS = [
  { which: 'advisor', verdict: 'APPROVE', citation: null, rubric: null },
]

function buildFixtureGraph() {
  const adapter = makeAdapter({
    slug: 'test-serve-motive',
    slices: FIXTURE_SLICES,
    specRequirements: FIXTURE_SPEC_REQS,
    gateEvents: FIXTURE_GATE_EVENTS,
  })
  const base = buildTraceabilityGraph(adapter)
  const classified = classifyTraceabilityGraph(base, /* stampedRefs= */ [])
  return { ...classified, slug: 'test-serve-motive' }
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let openServers: Server[] = []

afterEach(() => {
  for (const s of openServers) {
    try { s.close() } catch { /* ignore */ }
  }
  openServers = []
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('traceability-serve — GET /graph', () => {
  it('returns 200 JSON with nodes and edges having classification fields', async () => {
    const graph = buildFixtureGraph()
    const { server, url } = await startServer(graph, /* port= */ 0)
    openServers.push(server)

    const res = await fetch(url + '/graph')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/json/)

    const body = await res.json() as { nodes: object[]; edges: Array<{ classification?: string }> }
    expect(body).toHaveProperty('nodes')
    expect(body).toHaveProperty('edges')
    expect(Array.isArray(body.nodes)).toBe(true)
    expect(Array.isArray(body.edges)).toBe(true)

    // Every edge must carry a classification label
    const validClassifications = new Set(['proven', 'unproven', 'stale', 'missing'])
    for (const edge of body.edges) {
      expect(edge).toHaveProperty('classification')
      expect(validClassifications.has(edge.classification as string)).toBe(true)
    }
  })

  it('returns slug field in the graph payload', async () => {
    const graph = buildFixtureGraph()
    const { server, url } = await startServer(graph, 0)
    openServers.push(server)

    const body = await fetch(url + '/graph').then((r) => r.json()) as Record<string, unknown>
    expect(body.slug).toBe('test-serve-motive')
  })
})

describe('traceability-serve — GET /', () => {
  it('returns 200 HTML', async () => {
    const graph = buildFixtureGraph()
    const { server, url } = await startServer(graph, 0)
    openServers.push(server)

    const res = await fetch(url + '/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/html/)

    const html = await res.text()
    // Must be a real HTML document
    expect(html).toMatch(/<!DOCTYPE html/i)
    expect(html).toMatch(/<html/)
    expect(html).toMatch(/<\/html>/)
  })

  it('is self-contained — no external http(s) src= or href= references', async () => {
    const graph = buildFixtureGraph()
    const { server, url } = await startServer(graph, 0)
    openServers.push(server)

    const html = await fetch(url + '/').then((r) => r.text())

    // No external scripts or stylesheets loaded from remote hosts
    expect(html).not.toMatch(/src=["']https?:\/\//i)
    expect(html).not.toMatch(/href=["']https?:\/\//i)
    // No import() or importScripts() from external hosts
    expect(html).not.toMatch(/import\s*\(["']https?:\/\//i)
  })

  it('embeds the graph data as JSON (nodes visible in page source)', async () => {
    const graph = buildFixtureGraph()
    const { server, url } = await startServer(graph, 0)
    openServers.push(server)

    const html = await fetch(url + '/').then((r) => r.text())
    // The slug should appear in the page title and the embedded JSON
    expect(html).toContain('test-serve-motive')
    // The <script> block must be present and contain node/edge data
    expect(html).toContain('"nodes"')
    expect(html).toContain('"edges"')
    expect(html).toContain('"classification"')
  })

  it('responds with 404 for unknown paths', async () => {
    const graph = buildFixtureGraph()
    const { server, url } = await startServer(graph, 0)
    openServers.push(server)

    const res = await fetch(url + '/unknown-path')
    expect(res.status).toBe(404)
  })
})

describe('traceability-serve — server lifecycle', () => {
  it('binds to an ephemeral port when port=0 and returns a numeric port', async () => {
    const graph = buildFixtureGraph()
    const { server, port, url } = await startServer(graph, 0)
    openServers.push(server)

    expect(typeof port).toBe('number')
    expect(port).toBeGreaterThan(0)
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('serves multiple concurrent requests correctly', async () => {
    const graph = buildFixtureGraph()
    const { server, url } = await startServer(graph, 0)
    openServers.push(server)

    // Fire three requests in parallel
    const [r1, r2, r3] = await Promise.all([
      fetch(url + '/graph').then((r) => r.status),
      fetch(url + '/').then((r) => r.status),
      fetch(url + '/graph').then((r) => r.status),
    ])
    expect(r1).toBe(200)
    expect(r2).toBe(200)
    expect(r3).toBe(200)
  })
})
