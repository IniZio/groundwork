/**
 * S2 — motive-compile.mjs test suite
 * 13 ACs: S2-AC0 through S2-AC12
 */
// @ts-nocheck — motive-compile.mjs is pure JS; no type declarations needed for tests.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { compile, COMPILER_VERSION } from '../../hooks/lib/motive-compile.mjs'

// ── Helpers ───────────────────────────────────────────────────────────────

const FIXTURE_PATH = new URL('../../test/fixtures/hook-only-stream.jsonl', import.meta.url).pathname
const REPO_ROOT = new URL('../../', import.meta.url).pathname

/** Parse JSONL fixture and add synthetic _order provenance. */
function parseFixture(content: string) {
  return content
    .split('\n')
    .filter((l) => l.trim())
    .map((l, i) => {
      const ev = JSON.parse(l)
      ev._order = { shard: 'hook-only-stream.jsonl', line: i }
      return ev
    })
}

/** Filter events to a single motive; ords are assigned inside compile(). */
function motiveEvents(all: any[], motive: string) {
  return all.filter((e) => e.motive === motive)
}

/** Deep-equal comparison surface per D2b: remove provenance.ground_truth and provenance.collected_at. */
function foldSurface(view: any) {
  const { ground_truth: _gt, collected_at: _ca, ...prov } = view.provenance
  return { agent: view.agent, provenance: prov, divergence: view.divergence }
}

// ── Shared state ──────────────────────────────────────────────────────────

let tmpDir: string
let allEvents: any[]
let motiveA: any[] // test-motive-s6

/** Minimal injected ground truth. */
function makeGroundTruth(opts: { slices?: any[]; gate?: any } = {}) {
  return {
    head_sha: 'abc1234',
    branch: 'main',
    dirty_paths: [],
    existing_paths: {},
    ledger: {
      found: true,
      slices: opts.slices ?? [
        { id: 'S1', wave: 1, status: 'complete', desc: 'ordered reader', blocked_by: [] },
        { id: 'S2', wave: 1, status: 'pending', desc: 'the pure fold', blocked_by: [] },
      ],
      gate: opts.gate ?? { advisor: { verdict: 'APPROVE' } },
    },
    collected_at: '2026-08-03T09:00:00.000Z',
  }
}

beforeAll(() => {
  // S2-AC0: copy fixture to mkdtemp — never read in place
  tmpDir = mkdtempSync(join(tmpdir(), 'motive-compile-test-'))
  cpSync(FIXTURE_PATH, join(tmpDir, 'hook-only-stream.jsonl'))
  const content = readFileSync(join(tmpDir, 'hook-only-stream.jsonl'), 'utf8')
  allEvents = parseFixture(content)
  motiveA = motiveEvents(allEvents, 'test-motive-s6')
})

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

// ── S2-AC0 ────────────────────────────────────────────────────────────────

describe('S2-AC0 — input is stable', () => {
  it('fixture is committed to git', () => {
    const result = execSync(
      `git -C ${REPO_ROOT} ls-files --error-unmatch test/fixtures/hook-only-stream.jsonl`,
      { encoding: 'utf8' },
    )
    expect(result.trim()).toBeTruthy()
  })
})

// ── S2-AC1 ────────────────────────────────────────────────────────────────

describe('S2-AC1 — hook-only usefulness', () => {
  it('hook-only stream + injected ledger produces usable view', () => {
    const gt = makeGroundTruth()
    const view = compile(motiveA, { groundTruth: gt })
    expect(view.agent.all_slices.length).toBeGreaterThan(0)
    expect(view.agent.last_gate?.verdict).toBe('APPROVE')
    expect(view.agent.failures.length).toBeGreaterThanOrEqual(1)
    expect(view.agent.confidence).toBe('hook-only')
    expect(view.agent.resume.next_actions.length).toBeGreaterThanOrEqual(1)
  })
})

// ── S2-AC2 ────────────────────────────────────────────────────────────────

describe('S2-AC2 — honest degradation', () => {
  it('objective_source is reconstructed or absent, never recorded', () => {
    const gt = makeGroundTruth()
    const view = compile(motiveA, { groundTruth: gt })
    expect(view.agent.objective_source).toMatch(/^(reconstructed:|absent)/)
  })

  it('every decision rationale_source is absent (vacuously true when no decisions)', () => {
    const gt = makeGroundTruth()
    const view = compile(motiveA, { groundTruth: gt })
    for (const d of view.agent.decisions) {
      expect(d.rationale_source).toBe('absent')
    }
  })

  it('confidence_notes states that no rationale / hook-only', () => {
    const gt = makeGroundTruth()
    const view = compile(motiveA, { groundTruth: gt })
    expect(view.agent.confidence_notes.some((n: string) => /rationale|absent|hook-only/i.test(n))).toBe(true)
  })
})

// ── S2-AC3 ────────────────────────────────────────────────────────────────

describe('S2-AC3 — purity, mechanically checked', () => {
  it('motive-compile.mjs has zero import/require statements', () => {
    const src = readFileSync(
      new URL('../../hooks/lib/motive-compile.mjs', import.meta.url).pathname,
      'utf8',
    )
    const lines = src.split('\n').filter((l) => /^\s*(import|require)\s/.test(l))
    expect(lines).toHaveLength(0)
  })

  it('motive-compile.mjs has no forbidden globals in non-comment code lines', () => {
    const src = readFileSync(
      new URL('../../hooks/lib/motive-compile.mjs', import.meta.url).pathname,
      'utf8',
    )
    // Strip comment lines before checking, so docs in the file header don't trip the guard.
    const codeLines = src.split('\n').filter((l) => !/^\s*\*/.test(l))
    const code = codeLines.join('\n')
    const forbidden = ['Date.now(', 'new Date(', 'Math.random(']
    for (const f of forbidden) {
      expect(code).not.toContain(f)
    }
    // No import of node: builtins or process access in code lines
    const importLines = codeLines.filter((l) => /^\s*(import|require)\s/.test(l))
    for (const l of importLines) {
      expect(l).not.toMatch(/node:fs|node:child_process|node:os|node:path/)
    }
    // No process.* access in code lines (process. appearing only in comments is OK)
    const processLines = codeLines.filter((l) => !/^\s*\/\//.test(l) && /process\./.test(l))
    expect(processLines).toHaveLength(0)
  })
})

// ── S2-AC4 ────────────────────────────────────────────────────────────────

describe('S2-AC4 — field contract', () => {
  it('TASK_COMPLETE reads d.slice (present in fixture)', () => {
    const tcEvent = motiveA.find((e: any) => e.type === 'TASK_COMPLETE')
    expect(tcEvent).toBeDefined()
    expect(tcEvent.data?.slice).toBe('S1')
  })

  it('GATE reads d.which and d.verdict (present in fixture)', () => {
    const gateEvent = motiveA.find((e: any) => e.type === 'GATE')
    expect(gateEvent?.data?.which).toBe('advisor')
    expect(gateEvent?.data?.verdict).toBe('APPROVE')
  })

  it('FAILURE reads d.fingerprint, d.cmd, d.count; fold maps count→attempts', () => {
    const fEvent = motiveA.find((e: any) => e.type === 'FAILURE')
    expect(fEvent?.data?.fingerprint).toBeTruthy()
    expect(fEvent?.data?.cmd).toBeTruthy()
    expect(fEvent?.data?.count).toBeTypeOf('number')
    const view = compile(motiveA)
    expect(view.agent.failures[0]?.attempts).toBe(fEvent.data.count)
  })

  it('TASK_COMPLETE carries only {slice} — fold does not fabricate wave or paths', () => {
    const gt = makeGroundTruth({ slices: [{ id: 'S1', status: 'complete', blocked_by: [] }] })
    const v = compile(motiveA, { groundTruth: gt })
    // S1 completed: open_slices should be empty (only S1 in ledger)
    expect(v.agent.open_slices).toHaveLength(0)
  })
})

// ── S2-AC5 ────────────────────────────────────────────────────────────────

describe('S2-AC5 — no msg dependence', () => {
  it('stripping msg leaves structural fold surface byte-identical (failures.msg is the only expected diff)', () => {
    // S2-AC5 verifies that event-level `msg` does not seep into *structural* fold
    // outputs (objective, decisions, open_slices, etc.).  FAILURE events are the
    // deliberate exception — they now capture ev.msg so the clobber narrative is
    // preserved.  We strip failures[].msg from both sides before comparing.
    function structuralSurface(view: any) {
      const surface = foldSurface(view)
      return {
        ...surface,
        agent: {
          ...surface.agent,
          failures: (surface.agent.failures ?? []).map(({ msg: _msg, ...f }: any) => f),
        },
      }
    }
    const gt = makeGroundTruth()
    const withMsg = compile(motiveA, { groundTruth: gt })
    const stripped = motiveA.map(({ msg: _m, ...e }: any) => e)
    const withoutMsg = compile(stripped, { groundTruth: gt })
    expect(JSON.stringify(structuralSurface(withoutMsg))).toBe(JSON.stringify(structuralSurface(withMsg)))
  })
})

// ── S2-AC6 ────────────────────────────────────────────────────────────────

describe('S2-AC6 — truncation equivalence', () => {
  it('compile(events, {at:N}) === compile(events.slice(0,N)) for N in 1..5', () => {
    const gt = makeGroundTruth()
    for (let n = 1; n <= 5; n++) {
      const vAt = compile(motiveA, { at: n, groundTruth: gt })
      const vSlice = compile(motiveA.slice(0, n), { groundTruth: gt })
      expect(JSON.stringify(foldSurface(vAt))).toBe(JSON.stringify(foldSurface(vSlice)))
    }
  })
})

// ── S2-AC7 ────────────────────────────────────────────────────────────────

describe('S2-AC7 — every VALID_TYPES member folds somewhere', () => {
  const ALL_TYPES = [
    'DECISION', 'SPEC_CHANGE', 'LINT_DRIFT', 'PROTOTYPE_RESULT', 'FAILURE',
    'MILESTONE', 'TASK_COMPLETE', 'GATE', 'VERIFICATION', 'WAIVER',
    'HANDOFF', 'SESSION_START', 'SPEC_DRIFT', 'SESSION_END',
  ]

  it('14 types total, zero unknown_type_events with one of each', () => {
    expect(ALL_TYPES).toHaveLength(14)
    const synthetic = ALL_TYPES.map((type, i) => ({
      ts: `2026-08-03T09:00:${String(i).padStart(2, '0')}.000Z`,
      session: 'sess-test',
      motive: 'test-motive',
      type,
      data: {
        // multi-use fields
        which: 'advisor', verdict: 'APPROVE',
        slice: 'S1',
        kind: 'rfc-status', path: 'doc/specs/test.md', rfc_uid: 'rfc-1',
        fingerprint: 'fp1', cmd: 'echo test', count: 2,
        decision: 'test decision', rationale: 'test rationale', alternatives: [],
        pointer: 'handoff.md', summary: 'summary', next_actions: [],
        claim: 'claim', evidence: 'ev', result: 'pass',
        objective: 'test objective',
        spec_ref: 'rfc-1', change: 'added section', reason: 'needed',
        outcome: 'complete',
      },
      _order: { shard: 'test.jsonl', line: i },
    }))
    const view = compile(synthetic)
    expect(view.provenance.unknown_type_events).toBe(0)
  })

  it('LINT_DRIFT folds into drift with kind=lint', () => {
    const ev = [{ ts: '2026-08-03T09:00:00.000Z', session: 'sess', motive: 'm', type: 'LINT_DRIFT', data: { path: 'src/foo.ts', kind: 'lint' }, _order: { shard: 's', line: 0 } }]
    const view = compile(ev)
    expect(view.agent.drift.some((d: any) => d.kind === 'lint')).toBe(true)
    expect(view.provenance.unknown_type_events).toBe(0)
  })

  it('PROTOTYPE_RESULT folds into verifications with result_kind=prototype', () => {
    const ev = [{ ts: '2026-08-03T09:00:00.000Z', session: 'sess', motive: 'm', type: 'PROTOTYPE_RESULT', data: { claim: 'c', evidence: 'e', result: 'pass' }, _order: { shard: 's', line: 0 } }]
    const view = compile(ev)
    expect(view.agent.verifications.some((v: any) => v.result_kind === 'prototype')).toBe(true)
    expect(view.provenance.unknown_type_events).toBe(0)
  })

  it('WAIVER folds into waivers', () => {
    const ev = [{ ts: '2026-08-03T09:00:00.000Z', session: 'sess', motive: 'm', type: 'WAIVER', data: { risk: 'low' }, _order: { shard: 's', line: 0 } }]
    const view = compile(ev)
    expect(view.agent.waivers.length).toBeGreaterThan(0)
    expect(view.provenance.unknown_type_events).toBe(0)
  })
})

// ── S2-AC8 ────────────────────────────────────────────────────────────────

describe('S2-AC8 — FAILURE aggregation', () => {
  it('three FAILUREs sharing one fingerprint (count 2,3,4) → one entry with attempts=4', () => {
    const base = { session: 'sess', motive: 'm', type: 'FAILURE', data: { kind: 'repeat-command', fingerprint: 'fp-agg', cmd: 'echo test' } }
    const events = [
      { ...base, ts: '2026-08-03T09:00:01.000Z', data: { ...base.data, count: 2 }, _order: { shard: 's', line: 0 } },
      { ...base, ts: '2026-08-03T09:00:02.000Z', data: { ...base.data, count: 3 }, _order: { shard: 's', line: 1 } },
      { ...base, ts: '2026-08-03T09:00:03.000Z', data: { ...base.data, count: 4 }, _order: { shard: 's', line: 2 } },
    ]
    const view = compile(events)
    expect(view.agent.failures).toHaveLength(1)
    expect(view.agent.failures[0].attempts).toBe(4)
    expect(view.agent.failures[0].fingerprint).toBe('fp-agg')
  })
})

// ── S2-AC9 ────────────────────────────────────────────────────────────────

describe('S2-AC9 — GATE keyed by which', () => {
  it('two gates with different which both survive; last_gate is the advisor one', () => {
    const events = [
      { ts: '2026-08-03T09:00:01.000Z', session: 'sess', motive: 'm', type: 'GATE', data: { which: 'security', verdict: 'PASS' }, _order: { shard: 's', line: 0 } },
      { ts: '2026-08-03T09:00:02.000Z', session: 'sess', motive: 'm', type: 'GATE', data: { which: 'advisor', verdict: 'APPROVE' }, _order: { shard: 's', line: 1 } },
    ]
    const view = compile(events)
    expect(view.agent.gates['security']?.verdict).toBe('PASS')
    expect(view.agent.gates['advisor']?.verdict).toBe('APPROVE')
    expect(view.agent.last_gate?.which).toBe('advisor')
    expect(view.agent.last_gate?.verdict).toBe('APPROVE')
  })

  it('reads d.which not d.gate', () => {
    const events = [
      { ts: '2026-08-03T09:00:01.000Z', session: 'sess', motive: 'm', type: 'GATE', data: { which: 'advisor', verdict: 'APPROVE', gate: 'wrong' }, _order: { shard: 's', line: 0 } },
    ]
    const view = compile(events)
    expect(Object.keys(view.agent.gates)).toEqual(['advisor'])
  })
})

// ── S2-AC10 ───────────────────────────────────────────────────────────────

describe('S2-AC10 — divergence is pure', () => {
  it('findings and banner byte-identical across 20 calls', () => {
    const gt = makeGroundTruth()
    const first = compile(motiveA, { groundTruth: gt })
    const refFindings = JSON.stringify(first.divergence.findings)
    const refBanner = first.divergence.banner
    for (let i = 0; i < 20; i++) {
      const v = compile(motiveA, { groundTruth: gt })
      expect(JSON.stringify(v.divergence.findings)).toBe(refFindings)
      expect(v.divergence.banner).toBe(refBanner)
    }
  })

  it('findings sorted severity→kind→id', () => {
    // S1 completed in stream but ledger says pending → high mismatch
    const gt = makeGroundTruth({ slices: [{ id: 'S1', status: 'pending', blocked_by: [] }] })
    const events = [
      { ts: '2026-08-03T09:00:01.000Z', session: 'sess', motive: 'm', type: 'TASK_COMPLETE', data: { slice: 'S1' }, _order: { shard: 's', line: 0 } },
    ]
    const view = compile(events, { groundTruth: gt })
    expect(view.divergence.findings[0]?.severity).toBe('high')
  })
})

// ── S2-AC11 ───────────────────────────────────────────────────────────────

describe('S2-AC11 — motive scoping', () => {
  it('compiling test-motive-s6 yields events_folded === 4', () => {
    const view = compile(motiveA)
    expect(view.provenance.events_folded).toBe(4)
  })

  it('no field in view mentions the other motive', () => {
    const view = compile(motiveA)
    const str = JSON.stringify(view)
    expect(str).not.toContain('.groundwork/rfcs/test-rfc-s6')
  })
})

// ── S2-AC12 ───────────────────────────────────────────────────────────────

describe('S2-AC12 — COMPILER_VERSION', () => {
  it('COMPILER_VERSION matches /^motive-compile\\/\\d+\\.\\d+\\.\\d+$/', () => {
    expect(COMPILER_VERSION).toMatch(/^motive-compile\/\d+\.\d+\.\d+$/)
  })

  it('compiler_version is present in emitted view at both top-level and provenance', () => {
    const view = compile(motiveA)
    expect(view.compiler_version).toBe(COMPILER_VERSION)
    expect(view.provenance.compiler_version).toBe(COMPILER_VERSION)
  })
})

// ── session_completed_ids regression ─────────────────────────────────────
//
// Scenario: TASK_COMPLETE events were emitted before the ledger's motive field
// was set, so they carry a synthetic motive ("session:<id>") and are absent from
// the motive-filtered fold stream.  The divergence checker should NOT flag these
// as slice_state_mismatch when session_completed_ids supplies them.

describe('slice_state_mismatch — session_completed_ids suppresses false positive', () => {
  /** Ground truth where the ledger has two complete slices but the
   *  motive-filtered stream has ZERO TASK_COMPLETE events.           */
  function makeGtWithSessionIds(sessionCompletedIds: string[]) {
    return {
      head_sha: 'abc1234',
      branch: 'main',
      dirty_paths: [],
      existing_paths: {},
      ledger: {
        found: true,
        slices: [
          { id: 'S1', wave: 1, status: 'complete', desc: 'a', blocked_by: [] },
          { id: 'S2', wave: 1, status: 'complete', desc: 'b', blocked_by: [] },
        ],
        gate: {},
      },
      session_completed_ids: sessionCompletedIds,
      collected_at: '2026-08-03T09:00:00.000Z',
    }
  }

  it('no false positive when session_completed_ids covers all ledger-complete slices', () => {
    // Events have no TASK_COMPLETE for S1/S2 (they were emitted under a synthetic motive).
    const events: any[] = []
    const gt = makeGtWithSessionIds(['S1', 'S2'])
    const view = compile(events, { groundTruth: gt })
    const mismatches = view.divergence.findings.filter((f: any) => f.kind === 'slice_state_mismatch')
    expect(mismatches).toHaveLength(0)
    expect(view.divergence.banner).toBe('✓ No divergence')
  })

  it('true positive still fires when a slice is complete in ledger but absent from both streams', () => {
    // S2 is complete in ledger but NOT in fold stream and NOT in session_completed_ids.
    const events: any[] = []
    const gt = makeGtWithSessionIds(['S1']) // only S1 witnessed
    const view = compile(events, { groundTruth: gt })
    const mismatches = view.divergence.findings.filter((f: any) => f.kind === 'slice_state_mismatch')
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0].id).toBe('S2')
    expect(mismatches[0].detail).toMatch(/ledger says complete but no TASK_COMPLETE/)
  })

  it('session_completed_ids absent → legacy behaviour (no suppression)', () => {
    // When groundTruth lacks session_completed_ids (e.g. old run), the original
    // mismatch detection still fires.
    const gt = makeGroundTruth({ slices: [{ id: 'S99', status: 'complete', blocked_by: [] }] })
    // No TASK_COMPLETE in stream, no session_completed_ids → should fire
    const view = compile([], { groundTruth: gt })
    const mismatches = view.divergence.findings.filter((f: any) => f.kind === 'slice_state_mismatch')
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0].id).toBe('S99')
  })
})

// ── FAILURE msg rendering regression ─────────────────────────────────────
//
// The event-level `msg` field should appear in the compiled failures record
// and flow through to render output.

describe('FAILURE event — msg field propagation', () => {
  it('fold captures ev.msg into failure record', () => {
    const events = [
      {
        ts: '2026-08-03T09:00:01.000Z',
        session: 'sess',
        motive: 'm',
        type: 'FAILURE',
        msg: 'S6 clobbered S7 files',
        data: { fingerprint: 'fp1', kind: 'ownership-violation' },
        _order: { shard: 's', line: 0 },
      },
    ]
    const view = compile(events)
    const f = view.agent.failures.find((f: any) => f.fingerprint === 'fp1')
    expect(f).toBeDefined()
    expect(f?.msg).toBe('S6 clobbered S7 files')
  })

  it('fold prefers last_error over msg when both present', () => {
    // last_error (from struggle-detector) is the more precise field; msg is fallback
    const events = [
      {
        ts: '2026-08-03T09:00:01.000Z',
        session: 'sess',
        motive: 'm',
        type: 'FAILURE',
        msg: 'narrative text',
        data: { fingerprint: 'fp2', kind: 'test-fail', last_error: 'exit 1' },
        _order: { shard: 's', line: 0 },
      },
    ]
    const view = compile(events)
    const f = view.agent.failures.find((f: any) => f.fingerprint === 'fp2')
    expect(f?.last_error).toBe('exit 1')
    expect(f?.msg).toBe('narrative text')
  })
})

// ── Determinism check ─────────────────────────────────────────────────────

describe('determinism', () => {
  it('fold twice over same input → deep-equal fold surface', () => {
    const gt = makeGroundTruth()
    const v1 = compile(motiveA, { groundTruth: gt })
    const v2 = compile(motiveA, { groundTruth: gt })
    expect(JSON.stringify(foldSurface(v2))).toBe(JSON.stringify(foldSurface(v1)))
  })
})
