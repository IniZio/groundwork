/**
 * Tests for hooks/lib/traceability-adapter.mjs — NativeSpineAdapter
 *
 * Covers:
 *   D-3 / AC-5 — Classification sourced from recorded verdicts in real .jsonl journal shards.
 *
 * Regression test for the .ndjson → .jsonl bug:
 *   _readJournalEvents() previously filtered for '.ndjson' while journal-io.mjs
 *   writes '.jsonl'. This made every link unclassifiable as proven/stale because
 *   no GATE or VERIFICATION events ever reached the classifier.
 *
 * @verifies TRACEABILITY-R-003
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NativeSpineAdapter, type GateEvent } from '../../hooks/lib/traceability-adapter.mjs'
import { buildTraceabilityGraph } from '../../hooks/lib/traceability-join.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJournalDir(base: string): string {
  const dir = path.join(base, '.groundwork', 'journal')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Write one event as a JSONL line to the given shard path.
 * Naming follows journal-io.mjs resolveShardPath: <date>-<sessionId>.jsonl
 */
function writeShard(journalDir: string, filename: string, events: object[]): void {
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  writeFileSync(path.join(journalDir, filename), lines, 'utf8')
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'traceability-adapter-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// _readJournalEvents — real .jsonl seam
// ---------------------------------------------------------------------------

describe('NativeSpineAdapter._readJournalEvents — real .jsonl shard seam', () => {
  it('returns GATE events from a .jsonl shard (regression: was filtering .ndjson)', () => {
    // Arrange: write a real .jsonl shard with a GATE APPROVE event.
    // The shard name matches journal-io.mjs's resolveShardPath pattern:
    //   path.join(projectDir, '.groundwork', 'journal', `${d}-${safeId}.jsonl`)
    const journalDir = makeJournalDir(tmpDir)
    writeShard(journalDir, '2026-01-01-test-session.jsonl', [
      {
        ts: '2026-01-01T00:00:00.000Z',
        session: 'test-session',
        motive: 'test-motive',
        type: 'GATE',
        msg: 'advisor gate',
        data: { which: 'advisor', verdict: 'APPROVE', citation: null, rubric: null },
      },
    ])

    // Act: use the real NativeSpineAdapter (not a mock) to read the shard.
    const adapter = new NativeSpineAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    const gates = adapter.getGateEvents()

    // Assert: the GATE event must be present with the correct verdict.
    // FAILS before fix (adapter filtered '.ndjson', found nothing).
    // PASSES after fix (adapter filters '.jsonl', finds the shard).
    expect(gates).toHaveLength(1)
    expect(gates[0].verdict).toBe('APPROVE')
    expect(gates[0].which).toBe('advisor')
  })

  it('filters out events belonging to a different motive (motive-scoping)', () => {
    const journalDir = makeJournalDir(tmpDir)
    writeShard(journalDir, '2026-01-01-test-session.jsonl', [
      {
        ts: '2026-01-01T00:00:00.000Z',
        session: 'test-session',
        motive: 'other-motive',
        type: 'GATE',
        msg: 'gate for another motive',
        data: { which: 'advisor', verdict: 'APPROVE' },
      },
    ])

    const adapter = new NativeSpineAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    const gates = adapter.getGateEvents()

    // Events for a different motive must be excluded.
    expect(gates).toHaveLength(0)
  })

  it('reads VERIFICATION events from a .jsonl shard', () => {
    const journalDir = makeJournalDir(tmpDir)
    writeShard(journalDir, '2026-01-01-test-session.jsonl', [
      {
        ts: '2026-01-01T00:00:00.000Z',
        session: 'test-session',
        motive: 'test-motive',
        type: 'VERIFICATION',
        msg: 'live verify',
        data: {
          result: 'pass',
          link_id: 'S1',
          build_hash: 'abc123',
          notes: 'all checks green',
        },
      },
    ])

    const adapter = new NativeSpineAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    const verifications = adapter.getVerificationEvents()

    expect(verifications).toHaveLength(1)
    expect(verifications[0].result).toBe('pass')
  })

  it('returns empty array when journal dir does not exist', () => {
    // No .groundwork/journal dir created — adapter must not throw.
    const adapter = new NativeSpineAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    expect(adapter.getGateEvents()).toEqual([])
    expect(adapter.getVerificationEvents()).toEqual([])
  })

// ---------------------------------------------------------------------------
// getSlices — wave field (V2 additive)
// ---------------------------------------------------------------------------

describe('NativeSpineAdapter.getSlices — wave field exposure', () => {
  function makeRunsDir(base: string): string {
    const dir = path.join(base, '.groundwork', 'runs')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  function writeLedger(runsDir: string, slices: object[]): void {
    const ledger = {
      active: true,
      motive_ref: 'test-motive',
      slices,
    }
    writeFileSync(path.join(runsDir, '2026-01-01-test.json'), JSON.stringify(ledger), 'utf8')
  }

  it('exposes wave when present as an integer', () => {
    const runsDir = makeRunsDir(tmpDir)
    writeLedger(runsDir, [{ id: 'S1', status: 'complete', wave: 1 }])

    const adapter = new NativeSpineAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    const slices = adapter.getSlices()

    expect(slices).toHaveLength(1)
    expect(slices[0].wave).toBe(1)
  })

  it('returns null for wave when the field is explicitly null', () => {
    const runsDir = makeRunsDir(tmpDir)
    writeLedger(runsDir, [{ id: 'S1', status: 'pending', wave: null }])

    const adapter = new NativeSpineAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    const slices = adapter.getSlices()

    expect(slices).toHaveLength(1)
    expect(slices[0].wave).toBeNull()
  })

  it('returns null for wave when the field is absent', () => {
    const runsDir = makeRunsDir(tmpDir)
    writeLedger(runsDir, [{ id: 'S1', status: 'pending' }])

    const adapter = new NativeSpineAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    const slices = adapter.getSlices()

    expect(slices).toHaveLength(1)
    expect(slices[0].wave).toBeNull()
  })

  it('preserves all existing fields alongside wave', () => {
    const runsDir = makeRunsDir(tmpDir)
    writeLedger(runsDir, [{
      id: 'S2',
      status: 'in_progress',
      wave: 2,
      blocked_by: ['S1'],
      covers_ac: ['AC-1'],
      decisions: ['D-1'],
      ticket: 'T-42',
      desc: 'some slice',
    }])

    const adapter = new NativeSpineAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    const slices = adapter.getSlices()

    expect(slices[0].id).toBe('S2')
    expect(slices[0].status).toBe('in_progress')
    expect(slices[0].wave).toBe(2)
    expect(slices[0].blocked_by).toEqual(['S1'])
    expect(slices[0].covers_ac).toEqual(['AC-1'])
    expect(slices[0].decisions).toEqual(['D-1'])
    expect(slices[0].ticket).toBe('T-42')
    expect(slices[0].desc).toBe('some slice')
  })
})

  it('reads events from multiple .jsonl shards in a single call', () => {
    const journalDir = makeJournalDir(tmpDir)
    writeShard(journalDir, '2026-01-01-session-a.jsonl', [
      {
        ts: '2026-01-01T00:00:00.000Z',
        session: 'session-a',
        motive: 'test-motive',
        type: 'GATE',
        msg: 'gate a',
        data: { which: 'advisor', verdict: 'APPROVE' },
      },
    ])
    writeShard(journalDir, '2026-01-02-session-b.jsonl', [
      {
        ts: '2026-01-02T00:00:00.000Z',
        session: 'session-b',
        motive: 'test-motive',
        type: 'GATE',
        msg: 'gate b',
        data: { which: 'advisor', verdict: 'CORRECTION' },
      },
    ])

    const adapter = new NativeSpineAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    const gates = adapter.getGateEvents()

    expect(gates).toHaveLength(2)
    const verdicts = gates.map((g: GateEvent) => g.verdict).sort()
    expect(verdicts).toEqual(['APPROVE', 'CORRECTION'])
  })
})

// ---------------------------------------------------------------------------
// getCoverageMap — coverage.json merge seam (S6-COVERAGE-MAP-RESTORE)
// ---------------------------------------------------------------------------

describe('NativeSpineAdapter.getCoverageMap — _generated/coverage.json merge', () => {
  /**
   * Write a minimal requirements file with one requirement section.
   * Uses the RFC-0003 H3 format that parseRequirementsDocument expects.
   * Path placed under doc/specs/<concept>/requirements/ so isRequirementsDoc matches.
   */
  function writeRequirementFixture(projectDir: string, reqId: string, verification: string | null): void {
    const reqDir = path.join(projectDir, 'doc', 'specs', 'test-concept', 'requirements')
    mkdirSync(reqDir, { recursive: true })
    // Also create index.md so findNearestConceptId works (D-15 layout)
    writeFileSync(
      path.join(projectDir, 'doc', 'specs', 'test-concept', 'index.md'),
      `---\nid: TEST-CONCEPT\ntype: concept\ntitle: Test Concept\n---\n`,
      'utf8',
    )
    const anchor = reqId.toLowerCase().replace(/-/g, '-')
    const verLine = verification ? `- **Verification** ${verification} · **Criticality** must\n` : ''
    writeFileSync(
      path.join(reqDir, 'r001.md'),
      `### ${reqId} — Test requirement {#${anchor}}\n\n**When** a test runs **shall** pass.\n\n${verLine}`,
      'utf8',
    )
  }

  function writeCoverageJson(projectDir: string, byRequirement: Record<string, unknown>): void {
    const genDir = path.join(projectDir, 'doc', 'specs', '_generated')
    mkdirSync(genDir, { recursive: true })
    writeFileSync(
      path.join(genDir, 'coverage.json'),
      JSON.stringify({ by_requirement: byRequirement }, null, 2),
      'utf8',
    )
  }

  it('merges tests and verified from coverage.json when file exists', () => {
    const reqId = 'TEST-R-001'
    writeRequirementFixture(tmpDir, reqId, 'automated')
    writeCoverageJson(tmpDir, {
      [reqId]: { declared: 'automated', verified: true, tests: ['test/hooks/some.test.ts'] },
    })

    const adapter = new NativeSpineAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    const map = adapter.getCoverageMap()

    expect(map[reqId]).toBeDefined()
    expect(map[reqId].tests).toEqual(['test/hooks/some.test.ts'])
    expect(map[reqId].verified).toBe(true)
  })

  it('returns tests:[] verified:false when coverage.json is absent', () => {
    const reqId = 'TEST-R-001'
    writeRequirementFixture(tmpDir, reqId, 'automated')
    // No coverage.json written

    const adapter = new NativeSpineAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    const map = adapter.getCoverageMap()

    expect(map[reqId]).toBeDefined()
    expect(map[reqId].tests).toEqual([])
    expect(map[reqId].verified).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildTraceabilityGraph seam — getCoverageMap.tests flows through join
//
// The decision-mediated self-test path in traceability-join.mjs reads
// coverageMap[reqId].tests at ~line 287 to find test file paths.
// parseRequirementsDocument does not expose origin_decision_ref from H3 body
// sections (only verification/criticality/source are extracted from the
// attribute line), so the subclass below injects it for exactly one req while
// leaving getCoverageMap() real — exercising the coverage.json → join seam.
// ---------------------------------------------------------------------------

describe('buildTraceabilityGraph — getCoverageMap.tests seam (S6-COVERAGE-MAP-RESTORE)', () => {
  const TEST_PATH = 'test/hooks/some.test.ts'
  const REQ_ID = 'SEAM-R-001'
  const DEC_REF = 'D-7'
  const SLICE_ID = 'S1'

  /**
   * NativeSpineAdapter subclass that injects origin_decision_ref so the
   * decision-mediated self-test path in the join fires.  getCoverageMap is
   * inherited unchanged — it reads from the real coverage.json fixture.
   */
  class SeamTestAdapter extends NativeSpineAdapter {
    override getSpecRequirements() {
      return [{ id: REQ_ID, title: 'Seam req', verification: 'automated', criticality: 'must', origin_decision_ref: DEC_REF }]
    }
    override getObjective() { return 'seam test objective' }
    override getMotive()    { return 'test-motive' }
    override getSlices() {
      return [{
        id: SLICE_ID, status: 'complete', blocked_by: [], covers_ac: [], decisions: [DEC_REF],
        test_paths: [], wave: 1,
      }]
    }
    override getVerificationEvents() { return [] }
    override getGateEvents()         { return [] }
  }

  function writeCoverageJson(projectDir: string, byRequirement: Record<string, unknown>): void {
    const genDir = path.join(projectDir, 'doc', 'specs', '_generated')
    mkdirSync(genDir, { recursive: true })
    writeFileSync(path.join(genDir, 'coverage.json'), JSON.stringify({ by_requirement: byRequirement }), 'utf8')
  }

  it('self-test node and verifies edge appear when coverage.json lists the test path', () => {
    writeCoverageJson(tmpDir, {
      [REQ_ID]: { declared: 'automated', verified: true, tests: [TEST_PATH] },
    })

    const adapter = new SeamTestAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    const graph = buildTraceabilityGraph(adapter)

    const expectedNodeId = `self-test:${SLICE_ID}:${TEST_PATH}`
    const stNode = graph.nodes.find((n: { id: string }) => n.id === expectedNodeId)
    expect(stNode, `self-test node ${expectedNodeId} must exist in graph`).toBeDefined()

    const edge = graph.edges.find(
      (e: { source: string; target: string; kind: string }) =>
        e.source === expectedNodeId && e.target === `slice:${SLICE_ID}` && e.kind === 'verifies',
    )
    expect(edge, `verifies edge self-test:${SLICE_ID}:${TEST_PATH} → slice:${SLICE_ID} must exist`).toBeDefined()
  })

  it('self-test node and verifies edge are absent when coverage.json is absent', () => {
    // No coverage.json written — getCoverageMap returns tests:[] for all reqs

    const adapter = new SeamTestAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    const graph = buildTraceabilityGraph(adapter)

    const expectedNodeId = `self-test:${SLICE_ID}:${TEST_PATH}`
    const stNode = graph.nodes.find((n: { id: string }) => n.id === expectedNodeId)
    expect(stNode, `self-test node must be absent without coverage.json`).toBeUndefined()

    const edge = graph.edges.find(
      (e: { source: string; target: string; kind: string }) =>
        e.source === expectedNodeId && e.kind === 'verifies',
    )
    expect(edge, `verifies edge must be absent without coverage.json`).toBeUndefined()
  })
})
