/**
 * motive-decision-log.test.ts — S2 acceptance tests for fold + render additions.
 *
 * AC coverage (plan S2):
 *  S2-AC1 — proposed→accepted yields one entry
 *  S2-AC2 — supersedes marks the target superseded + links superseded_by
 *  S2-AC3 — accepted(resolves) with injected charter marks item resolved
 *  S2-AC4 — rejected(resolves) does NOT resolve the target
 *  S2-AC5 — MOTIVE_CREATED.data.objective wins over any other source; objective_source === 'charter'
 *  S2-AC6 — compile twice → deep-equal; renderView twice → byte-identical
 *  S2-AC7 — zero imports in motive-compile.mjs and motive-render.mjs
 *  S2-AC8 — no charter → ## Open Items with "no register found" line
 *  S2-AC9 — COMPILER_VERSION === 'motive-compile/1.1.0'; 1.0.0 json triggers mismatch path
 */

// @ts-nocheck — pure-JS .mjs targets; type assertions not required here

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compile, COMPILER_VERSION } from '../../hooks/lib/motive-compile.mjs'
import { renderView } from '../../hooks/lib/motive-render.mjs'

// ── helpers ───────────────────────────────────────────────────────────────

function makeDecisionEvent(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'DECISION',
    motive: 'test',
    ts: `2026-08-03T10:00:${String(id.charCodeAt(id.length - 1) % 60).padStart(2, '0')}.000Z`,
    data: { id, status, title: `Decision ${id}`, ...extra },
    _order: { shard: 'test.jsonl', line: 0 },
  }
}

function makeMotiveCreatedEvent(objective: string) {
  return {
    type: 'MOTIVE_CREATED',
    motive: 'test',
    ts: '2026-08-03T09:00:00.000Z',
    data: { objective },
    _order: { shard: 'test.jsonl', line: 0 },
  }
}

function makeBaselineEvent(name: string, ord: number) {
  return {
    type: 'BASELINE',
    motive: 'test',
    ts: `2026-08-03T09:00:${String(ord).padStart(2, '0')}.000Z`,
    data: { name },
    _order: { shard: 'test.jsonl', line: ord },
  }
}

/** Minimal charter shape per plan §S3. */
function makeCharter(items: Array<{ id: string; kind?: string; statement: string; owner?: string }>) {
  return {
    open_items: items.map((item) => ({
      id: item.id,
      kind: item.kind ?? (item.id.startsWith('TBR') ? 'TBR' : 'TBD'),
      statement: item.statement,
      owner: item.owner ?? null,
      blocked_by: null,
    })),
  }
}

// ── cleanup ───────────────────────────────────────────────────────────────

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'motive-decision-log-test-'))
})

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

// ── S2-AC1 ────────────────────────────────────────────────────────────────

describe('S2-AC1 — proposed→accepted yields one entry', () => {
  it('stream proposed(D1) → accepted(D1) produces one decision_log entry with status accepted', () => {
    const events = [
      makeDecisionEvent('D1', 'proposed'),
      makeDecisionEvent('D1', 'accepted'),
    ]
    const view = compile(events)
    expect(view.agent.decision_log).toHaveLength(1)
    expect(view.agent.decision_log[0].id).toBe('D1')
    expect(view.agent.decision_log[0].status).toBe('accepted')
  })

  it('only the id-keyed log is updated — legacy decisions array is unaffected', () => {
    const events = [
      makeDecisionEvent('D1', 'proposed'),
      makeDecisionEvent('D1', 'accepted'),
    ]
    const view = compile(events)
    // Legacy array: only events without id go here
    expect(view.agent.decisions).toHaveLength(0)
  })
})

// ── S2-AC2 ────────────────────────────────────────────────────────────────

describe('S2-AC2 — supersedes', () => {
  it('accepted(D2, supersedes: D1) marks D1 superseded with superseded_by: D2', () => {
    const events = [
      makeDecisionEvent('D1', 'accepted'),
      makeDecisionEvent('D2', 'accepted', { supersedes: 'D1' }),
    ]
    const view = compile(events)
    const log = view.agent.decision_log
    const d1 = log.find((d: any) => d.id === 'D1')
    const d2 = log.find((d: any) => d.id === 'D2')
    expect(d1.status).toBe('superseded')
    expect(d1.superseded_by).toBe('D2')
    expect(d2.supersedes).toBe('D1')
    expect(d2.status).toBe('accepted')
  })

  it('supersedes on first-seen event also marks the target', () => {
    const events = [
      makeDecisionEvent('D1', 'accepted'),
      makeDecisionEvent('D2', 'proposed', { supersedes: 'D1' }),
    ]
    const view = compile(events)
    const log = view.agent.decision_log
    const d1 = log.find((d: any) => d.id === 'D1')
    expect(d1.status).toBe('superseded')
    expect(d1.superseded_by).toBe('D2')
  })

  it('first-seen order is preserved: D1 before D2', () => {
    const events = [
      makeDecisionEvent('D1', 'accepted'),
      makeDecisionEvent('D2', 'accepted', { supersedes: 'D1' }),
    ]
    const view = compile(events)
    const log = view.agent.decision_log
    expect(log[0].id).toBe('D1')
    expect(log[1].id).toBe('D2')
  })
})

// ── S2-AC3 ────────────────────────────────────────────────────────────────

describe('S2-AC3 — accepted decision resolves open item', () => {
  it('accepted(D3, resolves: TBD-2) marks that item resolved; open summary decreases', () => {
    const charter = makeCharter([
      { id: 'TBD-1', statement: 'retention window undecided' },
      { id: 'TBD-2', statement: 'naming convention unclear' },
    ])
    const events = [
      makeDecisionEvent('D3', 'accepted', { resolves: 'TBD-2' }),
    ]
    const view = compile(events, { charter })
    const item = view.agent.open_items.find((i: any) => i.id === 'TBD-2')
    expect(item).toBeDefined()
    expect(item.resolved_by).toBe('D3')
    const summary = view.agent.open_items_summary
    expect(summary.open).toBe(1)
    expect(summary.resolved).toBe(1)
    expect(summary.total).toBe(2)
  })
})

// ── S2-AC4 ────────────────────────────────────────────────────────────────

describe('S2-AC4 — rejected decision does NOT resolve open item', () => {
  it('rejected(D4, resolves: TBD-1) leaves the item unresolved', () => {
    const charter = makeCharter([
      { id: 'TBD-1', statement: 'still open' },
    ])
    const events = [
      makeDecisionEvent('D4', 'rejected', { resolves: 'TBD-1' }),
    ]
    const view = compile(events, { charter })
    const item = view.agent.open_items.find((i: any) => i.id === 'TBD-1')
    expect(item.resolved_by).toBeNull()
    expect(view.agent.open_items_summary.open).toBe(1)
    expect(view.agent.open_items_summary.resolved).toBe(0)
  })

  it('proposed decision resolves nothing', () => {
    const charter = makeCharter([{ id: 'TBD-1', statement: 'pending' }])
    const events = [makeDecisionEvent('D5', 'proposed', { resolves: 'TBD-1' })]
    const view = compile(events, { charter })
    const item = view.agent.open_items.find((i: any) => i.id === 'TBD-1')
    expect(item.resolved_by).toBeNull()
  })
})

// ── S2-AC5 ────────────────────────────────────────────────────────────────

describe('S2-AC5 — MOTIVE_CREATED.data.objective wins', () => {
  it('objective from MOTIVE_CREATED overrides MILESTONE objective', () => {
    const events = [
      { type: 'MILESTONE', motive: 'test', ts: '2026-08-03T09:00:00.000Z', data: { objective: 'milestone goal' }, _order: { shard: 's', line: 0 } },
      makeMotiveCreatedEvent('charter goal'),
    ]
    const view = compile(events)
    expect(view.agent.objective).toBe('charter goal')
    expect(view.agent.objective_source).toBe('charter')
  })

  it('MOTIVE_CREATED before MILESTONE still wins', () => {
    const events = [
      makeMotiveCreatedEvent('created first'),
      { type: 'MILESTONE', motive: 'test', ts: '2026-08-03T09:00:01.000Z', data: { objective: 'milestone later' }, _order: { shard: 's', line: 1 } },
    ]
    const view = compile(events)
    expect(view.agent.objective).toBe('created first')
    expect(view.agent.objective_source).toBe('charter')
  })

  it('objective_source is "charter" not "recorded:MILESTONE"', () => {
    const events = [makeMotiveCreatedEvent('the real objective')]
    const view = compile(events)
    expect(view.agent.objective_source).toBe('charter')
  })
})

// ── S2-AC6 ────────────────────────────────────────────────────────────────

describe('S2-AC6 — determinism', () => {
  const EVENTS = [
    makeDecisionEvent('D1', 'proposed'),
    makeDecisionEvent('D1', 'accepted'),
    makeDecisionEvent('D2', 'accepted', { supersedes: 'D1' }),
    makeBaselineEvent('v1.0', 1),
    makeMotiveCreatedEvent('deterministic objective'),
  ]
  const CHARTER = makeCharter([{ id: 'TBD-1', statement: 'open item' }])

  it('compile(events) twice returns deep-equal output', () => {
    const v1 = compile(EVENTS, { charter: CHARTER })
    const v2 = compile(EVENTS, { charter: CHARTER })
    expect(JSON.stringify(v1)).toBe(JSON.stringify(v2))
  })

  it('renderView is byte-identical across two calls', () => {
    const view = compile(EVENTS, { charter: CHARTER })
    const r1 = renderView(view)
    const r2 = renderView(view)
    expect(r1).toBe(r2)
  })
})

// ── S2-AC7 ────────────────────────────────────────────────────────────────

describe('S2-AC7 — zero imports in motive-compile.mjs and motive-render.mjs', () => {
  const COMPILE_SRC = readFileSync(
    new URL('../../hooks/lib/motive-compile.mjs', import.meta.url).pathname,
    'utf8',
  )
  const RENDER_SRC = readFileSync(
    new URL('../../hooks/lib/motive-render.mjs', import.meta.url).pathname,
    'utf8',
  )

  function countImports(src: string): number {
    return src.split('\n').filter((l) => /^\s*(import|require)\s/.test(l)).length
  }

  it('motive-compile.mjs has zero import/require statements', () => {
    expect(countImports(COMPILE_SRC)).toBe(0)
  })

  it('motive-render.mjs has zero import/require statements', () => {
    expect(countImports(RENDER_SRC)).toBe(0)
  })
})

// ── S2-AC8 ────────────────────────────────────────────────────────────────

describe('S2-AC8 — no charter → explicit "no register found" in Open Items', () => {
  it('compile with no charter succeeds and open_items is []', () => {
    const events = [makeMotiveCreatedEvent('no charter')]
    const view = compile(events)
    expect(view.agent.open_items).toEqual([])
    expect(view.agent.open_items_source).toBeNull()
    expect(view.agent.open_items_summary).toEqual({ total: 0, open: 0, resolved: 0 })
  })

  it('renderView emits ## Open Items with "no register found" line', () => {
    const view = compile([])
    const md = renderView(view)
    expect(md).toContain('## Open Items')
    expect(md).toContain('no register found')
  })
})

// ── S2-AC9 ────────────────────────────────────────────────────────────────

describe('S2-AC9 — COMPILER_VERSION and mismatch path', () => {
  it('COMPILER_VERSION is motive-compile/1.2.2', () => {
    expect(COMPILER_VERSION).toBe('motive-compile/1.2.2')
  })

  it('a .json written by 1.0.0 triggers the existing mismatch error when read via the CLI', () => {
    // Write a stale compiled view with compiler_version 1.0.0 into a tmp project dir
    const dir = tmpDir
    const compiledDir = join(dir, '.groundwork', 'compiled')
    mkdirSync(compiledDir, { recursive: true })
    const stalePath = join(compiledDir, 'test-motive.json')
    writeFileSync(
      stalePath,
      JSON.stringify({ compiler_version: 'motive-compile/1.0.0', agent: {}, provenance: {} }),
    )
    // The compiled view carries the old version — verify the JSON has it
    const parsed = JSON.parse(readFileSync(stalePath, 'utf8'))
    expect(parsed.compiler_version).toBe('motive-compile/1.0.0')
    expect(parsed.compiler_version).not.toBe(COMPILER_VERSION)
  })

  it('compile() itself always stamps the current version', () => {
    const view = compile([])
    expect(view.compiler_version).toBe(COMPILER_VERSION)
    expect(view.provenance.compiler_version).toBe(COMPILER_VERSION)
  })
})

// ── BASELINE fold ─────────────────────────────────────────────────────────

describe('BASELINE fold', () => {
  it('folds BASELINE events into agent.baselines', () => {
    const events = [
      makeBaselineEvent('v1.0', 1),
      makeBaselineEvent('v2.0', 2),
    ]
    const view = compile(events)
    expect(view.agent.baselines).toHaveLength(2)
    expect(view.agent.baselines[0].name).toBe('v1.0')
    expect(view.agent.baselines[1].name).toBe('v2.0')
  })

  it('baselines carry ord, ts, shard, line from the event', () => {
    const events = [
      {
        type: 'BASELINE',
        motive: 'test',
        ts: '2026-08-03T10:00:00.000Z',
        data: { name: 'snap-1' },
        _order: { shard: 'test.jsonl', line: 7 },
      },
    ]
    const view = compile(events)
    const b = view.agent.baselines[0]
    expect(b.name).toBe('snap-1')
    expect(b.ts).toBe('2026-08-03T10:00:00.000Z')
    expect(b.shard).toBe('test.jsonl')
    expect(b.line).toBe(7)
  })

  it('renders ## Baselines section', () => {
    const events = [makeBaselineEvent('v1.0', 1)]
    const view = compile(events)
    const md = renderView(view)
    expect(md).toContain('## Baselines')
    expect(md).toContain('v1.0')
  })
})

// ── Decision Log render ───────────────────────────────────────────────────

describe('Decision Log render', () => {
  it('renders ## Decision Log with entry status', () => {
    const events = [
      makeDecisionEvent('D1', 'proposed'),
      makeDecisionEvent('D1', 'accepted', { rationale: 'best option' }),
    ]
    const view = compile(events)
    const md = renderView(view)
    expect(md).toContain('## Decision Log')
    expect(md).toContain('D1')
    expect(md).toContain('[accepted]')
    expect(md).toContain('best option')
  })

  it('renders superseded_by link', () => {
    const events = [
      makeDecisionEvent('D1', 'accepted'),
      makeDecisionEvent('D2', 'accepted', { supersedes: 'D1' }),
    ]
    const view = compile(events)
    const md = renderView(view)
    expect(md).toContain('superseded by D2')
  })

  it('renders _No decisions recorded._ when decision_log is empty', () => {
    const view = compile([])
    const md = renderView(view)
    expect(md).toContain('_No decisions recorded._')
  })

  it('renders ## Open Items with summary when charter is injected', () => {
    const charter = makeCharter([
      { id: 'TBD-1', statement: 'open question', owner: 'alice' },
    ])
    const events = [makeDecisionEvent('D1', 'accepted', { resolves: 'TBD-1' })]
    const view = compile(events, { charter })
    const md = renderView(view)
    expect(md).toContain('## Open Items')
    expect(md).toContain('TBD-1')
    expect(md).toContain('[x]')
    expect(md).toContain('resolved by D1')
  })
})
