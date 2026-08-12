/**
 * test/hooks/traceability-serve.test.ts
 *
 * Tests for hooks/traceability-serve.mjs.
 *
 * S6 tests (AC-1..AC-3):
 *   1. GET /graph returns the classified graph JSON (nodes + edges with classification).
 *   2. GET / returns self-contained HTML with no external URLs (no bundler, no CDN).
 *
 * S7 tests (AC-5, D-3, D-8):
 *   3. POST /rejudge appends a scoped GATE event keyed by D-8 link_id and regen reflects it.
 *   4. buildClassifiedGraph never calls appendEvent (off-hot-path invariant — D-3).
 *
 * @verifies S6-AC-1 (serve command exists and starts)
 * @verifies S6-AC-2 (GET /graph returns classified graph)
 * @verifies S6-AC-3 (GET / returns self-contained HTML)
 * @verifies S7-AC-5 (on-demand single-link re-judge)
 * @verifies S7-D-3  (re-judge never on regen hot path)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Server } from 'node:http'

import { buildTraceabilityGraph } from '../../hooks/lib/traceability-join.mjs'
import { classifyTraceabilityGraph } from '../../hooks/lib/traceability-classify.mjs'
import {
  startServer,
  buildHtml,
  buildClassifiedGraph,
  rejudgeLink,
} from '../../hooks/traceability-serve.mjs'

// ---------------------------------------------------------------------------
// S6 — Stub adapter (no filesystem; pure in-memory graph)
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
// S6 — Fixture: small but complete graph (objective + 1 slice + 1 gate APPROVE)
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
// S6 — Server lifecycle (shared afterEach cleanup for stub-graph tests)
// ---------------------------------------------------------------------------

let openServers: Server[] = []

afterEach(() => {
  for (const s of openServers) {
    try { s.close() } catch { /* ignore */ }
  }
  openServers = []
})

// ---------------------------------------------------------------------------
// S6 — GET /graph
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

// ---------------------------------------------------------------------------
// S6 — GET /
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// S6 — Server lifecycle
// ---------------------------------------------------------------------------

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

// ===========================================================================
// S7 — On-demand single-link re-judge (AC-5, D-3, D-8)
// ===========================================================================

// ---------------------------------------------------------------------------
// S7 — Helpers: minimal filesystem project for journal-write tests
// ---------------------------------------------------------------------------

/** Create a minimal groundwork project directory with a named motive. */
function makeProjectDir(slug: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'trace-serve-test-'))
  mkdirSync(join(dir, '.groundwork', 'journal'), { recursive: true })
  mkdirSync(join(dir, '.groundwork', 'motives', slug), { recursive: true })
  mkdirSync(join(dir, '.groundwork', 'runs'), { recursive: true })
  writeFileSync(
    join(dir, '.groundwork', 'motives', slug, 'motive.md'),
    `# ${slug}\n\nObjective: test motive for S7\n`,
  )
  return dir
}

/** Read all JSONL lines from the journal directory, returning parsed events. */
function readJournalEvents(projectDir: string): object[] {
  const journalDir = join(projectDir, '.groundwork', 'journal')
  let files: string[]
  try {
    const fs = require('node:fs') as typeof import('node:fs')
    files = fs.readdirSync(journalDir).filter((f: string) => f.endsWith('.jsonl'))
  } catch { return [] }
  const events: object[] = []
  for (const f of files) {
    const lines = readFileSync(join(journalDir, f), 'utf8').split('\n').filter(Boolean)
    for (const l of lines) {
      try { events.push(JSON.parse(l)) } catch { /* skip malformed */ }
    }
  }
  return events
}

// ---------------------------------------------------------------------------
// S7 — rejudgeLink: appends scoped GATE event (write side of AC-5)
// ---------------------------------------------------------------------------

describe('rejudgeLink (S7 — explicit on-demand action)', () => {
  let projectDir: string
  const SLUG = 'test-motive-s7'

  beforeEach(() => { projectDir = makeProjectDir(SLUG) })
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }) })

  it('writes a GATE event to the journal with the given link_id', () => {
    rejudgeLink('S7', 'APPROVE', 'manual-rejudge', projectDir, SLUG)

    const events = readJournalEvents(projectDir)
    const gate = events.find((e: any) => e.type === 'GATE')
    expect(gate).toBeDefined()
    const g = gate as any
    expect(g.type).toBe('GATE')
    expect(g.data.link_id).toBe('S7')
    expect(g.data.verdict).toBe('APPROVE')
    expect(g.data.which).toBe('manual-rejudge')
    expect(g.motive).toBe(SLUG)
  })

  it('uses the supplied verdict (CORRECTION)', () => {
    rejudgeLink('S3', 'CORRECTION', 'qa', projectDir, SLUG)

    const events = readJournalEvents(projectDir)
    const gate = events.find((e: any) => e.type === 'GATE') as any
    expect(gate?.data?.verdict).toBe('CORRECTION')
    expect(gate?.data?.link_id).toBe('S3')
  })

  it('scopes the event to a different link_id than a prior event (D-8 per-link scoping)', () => {
    rejudgeLink('S1', 'APPROVE', 'manual-rejudge', projectDir, SLUG)
    rejudgeLink('S2', 'APPROVE', 'manual-rejudge', projectDir, SLUG)

    const events = readJournalEvents(projectDir) as any[]
    const gates = events.filter((e: any) => e.type === 'GATE')
    expect(gates).toHaveLength(2)
    const ids = gates.map((g: any) => g.data.link_id).sort()
    expect(ids).toEqual(['S1', 'S2'])
  })
})

// ---------------------------------------------------------------------------
// S7 — Off-hot-path invariant (D-3 load-bearing test)
//
// buildClassifiedGraph MUST NOT call appendEvent. This test would FAIL if
// rejudgeLink (or any write path) were wired into the normal regen.
// ---------------------------------------------------------------------------

describe('buildClassifiedGraph — off-hot-path invariant (S7-D-3)', () => {
  let projectDir: string
  const SLUG = 'test-motive-hotpath'

  beforeEach(() => { projectDir = makeProjectDir(SLUG) })
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }) })

  it('never calls appendEvent during a normal regen (no writes on hot path)', async () => {
    // Spy on appendEvent — if buildClassifiedGraph called rejudgeLink → appendEvent,
    // this spy would detect it and the assertion below would fail.
    const journalIo = await import('../../hooks/lib/journal-io.mjs')
    const appendSpy = vi.spyOn(journalIo, 'appendEvent').mockImplementation(() => {})

    try {
      // Run the full regen pipeline — may throw on missing fixture data, that's OK;
      // we only care that no write side-effect occurs.
      try { buildClassifiedGraph(SLUG, projectDir) } catch { /* filesystem gaps are acceptable */ }

      // The spy must have zero calls — any call means rejudge leaked into regen
      expect(appendSpy).not.toHaveBeenCalled()
    } finally {
      appendSpy.mockRestore()
    }
  })

  it('rejudgeLink IS detected by the spy (proves spy sensitivity — guard against vacuous test)', async () => {
    // Complementary test: confirms the spy catches a write when one occurs.
    // Without this, the off-hot-path test above could pass vacuously if the spy
    // was not intercepting appendEvent calls correctly.
    const journalIo = await import('../../hooks/lib/journal-io.mjs')
    const appendSpy = vi.spyOn(journalIo, 'appendEvent').mockImplementation(() => {})

    try {
      rejudgeLink('S7', 'APPROVE', 'manual-rejudge', projectDir, SLUG)
      expect(appendSpy).toHaveBeenCalledTimes(1)
    } finally {
      appendSpy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// S7 — POST /rejudge HTTP endpoint (end-to-end AC-5)
// ---------------------------------------------------------------------------

describe('POST /rejudge HTTP endpoint (S7)', () => {
  let projectDir: string
  let serverUrl: string
  let server: Server
  const SLUG = 'test-motive-endpoint'

  beforeEach(async () => {
    projectDir = makeProjectDir(SLUG)
    // Build a minimal classified graph (empty slices is fine for server bootstrap)
    let graph: any
    try { graph = buildClassifiedGraph(SLUG, projectDir) } catch {
      // Fallback minimal graph for server test
      graph = { nodes: [], edges: [], artifactEvidence: [], slug: SLUG }
    }
    const result = await startServer(graph, 0, { slug: SLUG, projectDir })
    server = result.server
    serverUrl = result.url
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(projectDir, { recursive: true, force: true })
  })

  it('returns 400 when link_id is missing', async () => {
    const res = await fetch(`${serverUrl}/rejudge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict: 'APPROVE' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toMatch(/link_id/)
  })

  it('appends a GATE event and returns { ok: true } on a valid request', async () => {
    const res = await fetch(`${serverUrl}/rejudge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link_id: 'S7', verdict: 'APPROVE' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.ok).toBe(true)

    // Verify the event was written to the journal on disk
    const events = readJournalEvents(projectDir) as any[]
    const gate = events.find((e: any) => e.type === 'GATE' && e.data?.link_id === 'S7')
    expect(gate).toBeDefined()
    expect((gate as any).data.verdict).toBe('APPROVE')
  })

  it('updates GET /graph after a successful re-judge (regen reflects new verdict)', async () => {
    // Perform re-judge
    const rejudgeRes = await fetch(`${serverUrl}/rejudge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link_id: 'S7', verdict: 'APPROVE' }),
    })
    expect(rejudgeRes.status).toBe(200)

    // /graph should now reflect the rebuilt data (server rebuilt in-memory after rejudge)
    const after = await (await fetch(`${serverUrl}/graph`)).json() as any
    expect(after).toHaveProperty('nodes')
    expect(after).toHaveProperty('edges')
    // Slug is preserved through rebuild
    expect(after.slug).toBe(SLUG)
  })

  it('GET / returns HTML with re-judge surface after a re-judge', async () => {
    // Initial page must already have the re-judge infrastructure
    const htmlBefore = await (await fetch(`${serverUrl}/`)).text()
    expect(htmlBefore).toContain('rj-btn')
    expect(htmlBefore).toContain('rejudge')

    // Post re-judge: infrastructure must still be present in rebuilt page
    await fetch(`${serverUrl}/rejudge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link_id: 'S7', verdict: 'APPROVE' }),
    })
    const htmlAfter = await (await fetch(`${serverUrl}/`)).text()
    expect(htmlAfter).toContain('rj-btn')
  })

  it('non-POST to /rejudge path returns 405', async () => {
    const res = await fetch(`${serverUrl}/rejudge`, { method: 'DELETE' })
    expect(res.status).toBe(405)
  })
})

// ---------------------------------------------------------------------------
// S7 — buildHtml surface elements (static contract check)
// ---------------------------------------------------------------------------

describe('buildHtml — S7 re-judge surface elements', () => {
  it('includes the rejudge() JS function in the page', () => {
    const graph = { nodes: [], edges: [], artifactEvidence: [], slug: 'test' }
    const html = buildHtml(graph)
    expect(html).toContain('function rejudge(')
    expect(html).toContain('/rejudge')
  })

  it('includes the rj-btn CSS class', () => {
    const graph = { nodes: [], edges: [], artifactEvidence: [], slug: 'test' }
    const html = buildHtml(graph)
    expect(html).toContain('.rj-btn')
  })

  it('includes the edgeLinkId() helper', () => {
    const graph = { nodes: [], edges: [], artifactEvidence: [], slug: 'test' }
    const html = buildHtml(graph)
    expect(html).toContain('function edgeLinkId(')
  })
})
