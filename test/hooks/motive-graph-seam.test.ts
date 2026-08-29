// @ts-nocheck
/**
 * motive-graph seam regression guard.
 *
 * Two seam defects are pinned here, both on SYNTHETIC fixtures so the assertions
 * cannot go vacuous when .groundwork/ runtime state rotates:
 *
 *   1. motive-graph-fold.mjs handleBaseline() keyed baseline nodes as
 *      `baseline:${name}`. A BASELINE event written without data.name produced the
 *      shared id `baseline:undefined`, collapsing every nameless pin in a motive into
 *      one node while compile() kept one record per event — a fold-vs-compile
 *      divergence on baselines.names.
 *
 *   2. motive-graph.mjs findLedger() matched only `ledger.motive_ref`. The run-ledger
 *      schema also allows `ledger.motive`, which is what `ledger init --motive <id>`
 *      writes, so CLI-created ledgers never matched and NO motive received slice nodes.
 */
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { assembleGraphFold } from '../../hooks/lib/motive-graph-fold.mjs'
import { projectFoldGraph } from '../../hooks/lib/motive-graph-project.mjs'
import { compile } from '../../hooks/lib/motive-compile.mjs'
import { checkFoldCompileParity } from '../../hooks/lib/motive-graph-parity.mjs'
import { assembleMotiveGraph } from '../../hooks/lib/motive-graph.mjs'

// ---------------------------------------------------------------------------
// 1 — nameless BASELINE events must not collapse into one fold node
// ---------------------------------------------------------------------------

const MOTIVE = 'seam-fixture'

// Three BASELINE events with NO data.name, plus one named — the exact shape that
// produced the corpus divergence.
const baselineEvents = [
  { ord: 1, ts: '2026-01-01T00:00:01.000Z', motive: MOTIVE, type: 'BASELINE', data: { signal: 'a' } },
  { ord: 2, ts: '2026-01-01T00:00:02.000Z', motive: MOTIVE, type: 'BASELINE', data: { signal: 'b' } },
  { ord: 3, ts: '2026-01-01T00:00:03.000Z', motive: MOTIVE, type: 'BASELINE', data: { signal: 'c' } },
  { ord: 4, ts: '2026-01-01T00:00:04.000Z', motive: MOTIVE, type: 'BASELINE', data: { name: 'pinned' } },
]

describe('1 — nameless BASELINE events keep distinct fold nodes', () => {
  it('fold emits one baseline node per BASELINE event when data.name is absent', () => {
    const fold = assembleGraphFold(baselineEvents)
    const nodes = fold.nodes.filter((n) => n.type === 'baseline')

    expect(nodes, 'nameless baselines collapsed into a single node').toHaveLength(4)
    // No node id may interpolate an undefined name.
    expect(nodes.map((n) => n.id)).not.toContain('baseline:undefined')
    // Each nameless pin keeps its own ordinal.
    expect(nodes.map((n) => n.attrs._ord).sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
  })

  it('a re-pinned NAMED baseline still updates one node (latest-wins identity preserved)', () => {
    const fold = assembleGraphFold([
      { ord: 1, ts: '2026-01-01T00:00:01.000Z', motive: MOTIVE, type: 'BASELINE', data: { name: 'pinned', shard: 'x' } },
      { ord: 2, ts: '2026-01-01T00:00:02.000Z', motive: MOTIVE, type: 'BASELINE', data: { name: 'pinned', shard: 'y' } },
    ])
    const nodes = fold.nodes.filter((n) => n.type === 'baseline')
    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe('baseline:pinned')
    // First-event semantics for _ord are unchanged by the id fallback.
    expect(nodes[0].attrs._ord).toBe(1)
  })

  it('fold ≡ compile on baselines for a stream carrying several nameless pins', () => {
    const projected = projectFoldGraph(assembleGraphFold(baselineEvents), { events: baselineEvents })
    const compiled = compile(baselineEvents)
    const result = checkFoldCompileParity(projected, compiled, { events: baselineEvents })

    const baselineDivergences = result.divergences.filter((d) => String(d.field).startsWith('baselines'))
    expect(baselineDivergences, JSON.stringify(baselineDivergences, null, 2)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2 — findLedger must honour BOTH schema keys: `motive` and `motive_ref`
// ---------------------------------------------------------------------------

const tmpDirs: string[] = []

afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true })
})

/** Build a throwaway project dir carrying one run ledger with two slices. */
function makeProject(ledgerFields: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-motive-graph-seam-'))
  tmpDirs.push(dir)
  fs.mkdirSync(path.join(dir, '.groundwork', 'runs'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.groundwork', 'journal'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.groundwork', 'motives', MOTIVE), { recursive: true })
  fs.writeFileSync(path.join(dir, '.groundwork', 'motives', MOTIVE, 'motive.md'), `# ${MOTIVE}\n`)
  fs.writeFileSync(
    path.join(dir, '.groundwork', 'runs', 'run-1.json'),
    JSON.stringify({
      active: true,
      schema_version: 1,
      session_id: 'sess-1',
      ...ledgerFields,
      slices: [
        { id: 'S1', wave: 0, status: 'complete', desc: 'first', blocked_by: [] },
        { id: 'S2', wave: 0, status: 'pending', desc: 'second', blocked_by: ['S1'] },
      ],
    }),
  )
  return dir
}

// ---------------------------------------------------------------------------
// 3 — parseSpecRequirements indexes D-15 requirements/*.md frontmatter
// ---------------------------------------------------------------------------

// Bite proof: comment out the parseRequirementFile() call in parseSpecRequirements()
// in hooks/lib/motive-graph.mjs; this test fails with "expected [] to include req:seam-r-001"
describe('3 — D-15 requirements/*.md files are indexed as req: nodes', () => {
  it('a requirement frontmatter file under doc/specs/<concept>/requirements/ yields a req: node', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-motive-graph-seam-'))
    tmpDirs.push(dir)
    // Wire up minimal project structure
    fs.mkdirSync(path.join(dir, '.groundwork', 'runs'), { recursive: true })
    // Journal with one DECISION event so the req's source#D-1 resolves
    const journalDir = path.join(dir, '.groundwork', 'journal')
    fs.mkdirSync(journalDir, { recursive: true })
    fs.writeFileSync(
      path.join(journalDir, `${MOTIVE}-001.jsonl`),
      JSON.stringify({
        ord: 1,
        ts: '2026-01-01T00:00:01.000Z',
        motive: MOTIVE,
        type: 'DECISION',
        data: { id: 'D-1', decision: 'seam test decision', status: 'accepted' },
      }) + '\n',
    )
    fs.mkdirSync(path.join(dir, '.groundwork', 'motives', MOTIVE), { recursive: true })
    fs.writeFileSync(path.join(dir, '.groundwork', 'motives', MOTIVE, 'motive.md'), `# ${MOTIVE}\n`)
    // D-15 requirement file — source includes #D-1 so the req is linked to the decision above
    fs.mkdirSync(path.join(dir, 'doc', 'specs', 'seam-concept', 'requirements'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'doc', 'specs', 'seam-concept', 'requirements', 'seam-r-001.md'),
      [
        '---',
        'id: "seam-r-001"',
        'title: "Seam requirement for positive control"',
        'concept: "[[seam-concept/index]]"',
        'criticality: must',
        'source: "groundwork-development#D-1"',
        '---',
        '',
        '## Statement',
        '',
        'This requirement exists only to verify that the D-15 walker indexes it.',
      ].join('\n'),
    )
    const graph = await assembleMotiveGraph({ projectDir: dir, slug: MOTIVE })
    const reqIds = graph.nodes.filter((n) => n.type === 'spec-requirement').map((n) => n.id)
    expect(reqIds, `expected nodes to include req:seam-r-001, got ${JSON.stringify(reqIds)}`).toContain('req:seam-r-001')
  })
})

describe('2 — findLedger honours both run-ledger motive keys', () => {
  it('a ledger stamped with `motive` (written by `ledger init --motive`) yields slice nodes', async () => {
    const dir = makeProject({ motive: MOTIVE })
    const graph = await assembleMotiveGraph({ projectDir: dir, slug: MOTIVE })
    const sliceIds = graph.nodes.filter((n) => n.type === 'slice').map((n) => n.id).sort()
    expect(sliceIds, 'ledger.motive was ignored — no slice nodes emitted').toEqual(['slice:S1', 'slice:S2'])
  })

  it('a ledger stamped with `motive_ref` still yields slice nodes (no regression)', async () => {
    const dir = makeProject({ motive_ref: MOTIVE })
    const graph = await assembleMotiveGraph({ projectDir: dir, slug: MOTIVE })
    const sliceIds = graph.nodes.filter((n) => n.type === 'slice').map((n) => n.id).sort()
    expect(sliceIds).toEqual(['slice:S1', 'slice:S2'])
  })

  it('a ledger stamped with a DIFFERENT motive yields no slice nodes (guard is not accept-all)', async () => {
    const dir = makeProject({ motive: 'some-other-motive' })
    const graph = await assembleMotiveGraph({ projectDir: dir, slug: MOTIVE })
    expect(graph.nodes.filter((n) => n.type === 'slice')).toHaveLength(0)
  })
})
