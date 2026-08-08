/**
 * motive-graph-parity-corpus.test.mjs — CI parity harness across all motives.
 *
 * Enumerates every motive under .groundwork/motives/ dynamically and asserts
 * fold-vs-compile parity for each via assertFoldCompileParity().
 *
 * Hard failures from any motive block the gate — do NOT soften the assertion
 * or add motives to a skip-list to go green. A failing motive is a T2 finding
 * that blocks consumer cutovers (T3/T4/T5).
 *
 * Named findings (superseded_by forward-ref, legacy title) are logged but do
 * NOT cause test failure — they are expected structural behaviour.
 *
 * Run: npx vitest run test/motive-graph-parity-corpus.test.mjs
 */

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { assertFoldCompileParity, checkFoldCompileParity } from '../hooks/lib/motive-graph-parity.mjs'
import { compile } from '../hooks/lib/motive-compile.mjs'
import { readCharter } from '../hooks/lib/motive-charter.mjs'
import { readOrderedEvents } from '../hooks/lib/journal-order.mjs'
import { assembleGraphFold } from '../hooks/lib/motive-graph-fold.mjs'
import { projectFoldGraph } from '../hooks/lib/motive-graph-project.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const JOURNAL_DIR = path.join(ROOT, '.groundwork', 'journal')
const MOTIVES_DIR = path.join(ROOT, '.groundwork', 'motives')

// Enumerate motives dynamically — never hardcode this list.
// A hardcoded list silently ignores newly-created motives; the harness goes vacuous.
const allMotives = fs.readdirSync(MOTIVES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

describe('motive-graph-parity-corpus — fold ≡ compile for all motives', () => {
  it('discovers at least one motive (guards against vacuous glob)', () => {
    expect(allMotives.length, 'No motives found — harness would pass vacuously').toBeGreaterThan(0)
  })

  for (const slug of allMotives) {
    it(`${slug}: assertFoldCompileParity — no hard divergences`, () => {
      // assertFoldCompileParity throws on hard divergences with slug + field in message.
      // Named findings (forward-ref superseded_by, legacy title) do NOT throw.
      const result = assertFoldCompileParity(slug, JOURNAL_DIR)

      // Zero hard divergences
      expect(result.divergences, `${slug}: hard divergence(s) detected`).toEqual([])

      // Log named findings for visibility but do not fail on them
      if (result.findings.length > 0) {
        console.log(`[parity-corpus] ${slug}: ${result.findings.length} named finding(s)`, result.findings)
      }
    })
  }
})

// ── AC-6: fold-synthesized agent ≡ compile-with-charter on consumed fields ────
//
// assembleMotiveGraph builds the DAG surface from the fold (not compile()).
// This test proves the fold-synthesized agent is equivalent to compile-with-charter
// on the four fields the graph actually consumes: objective, decision_log ids,
// ac_coverage id sets (both directions), open_items ids.
//
// A BITING guarantee: if charter-seeded ACs are dropped, if decisions are lost,
// or if the open_items resolution is wrong, this test fails — not the parity oracle.
// The parity oracle (assertFoldCompileParity) calls compile WITHOUT charter and
// cannot catch charter-delta regressions.

describe('fold-synthesized agent ≡ compile-with-charter on consumed fields (AC-6)', () => {
  it('discovers at least one motive (guards against vacuous glob)', () => {
    expect(allMotives.length, 'No motives found — harness would pass vacuously').toBeGreaterThan(0)
  })

  for (const slug of allMotives) {
    it(`${slug}: fold-synthesized agent matches compile-with-charter`, () => {
      const { events, malformed_lines } = readOrderedEvents(JOURNAL_DIR, { motive: slug })
      const charter = readCharter({ projectDir: ROOT, motive: slug })

      // ── Reference: compile-with-charter (old code path) ──────────────────
      const compileView = compile(events, { charter, malformedLines: malformed_lines })
      const compileAgent = compileView.agent

      // ── Fold-synthesized agent (new code path — mirrors assembleMotiveGraph) ──
      const fold = assembleGraphFold(events)
      const projected = projectFoldGraph(fold, { events })

      // Build resolvedByDecisions from events (compile-exact semantics):
      // supersession by another decision does NOT retroactively un-resolve an open item.
      const resolvedByDecisions = new Map()
      const _decisionMerged = new Map()
      for (const evt of events) {
        if (evt.type !== 'DECISION') continue
        const d = evt.data ?? {}
        if (!d.id) continue
        const prior = _decisionMerged.get(d.id)
        if (!prior) {
          _decisionMerged.set(d.id, { status: d.status ?? null, resolves: d.resolves ?? null })
        } else {
          if (d.status != null) prior.status = d.status
          if (d.resolves != null) prior.resolves = d.resolves
        }
        const entry = _decisionMerged.get(d.id)
        if (entry.status === 'accepted' && entry.resolves != null) {
          resolvedByDecisions.set(entry.resolves, d.id)
        } else if (entry.status !== 'accepted' && entry.resolves != null) {
          if (resolvedByDecisions.get(entry.resolves) === d.id) {
            resolvedByDecisions.delete(entry.resolves)
          }
        }
      }
      const openItems = (charter?.open_items ?? []).map((item) => ({
        id: item.id,
        kind: item.kind ?? null,
        statement: item.statement ?? null,
        body: item.body ?? null,
        owner: item.owner ?? null,
        blocked_by: item.blocked_by ?? null,
        resolved_by: resolvedByDecisions.get(item.id) ?? null,
        graduated_to: item.graduated_to ?? null,
      }))
      const projectedAcIds = new Set([
        ...(projected.ac_coverage?.met ?? []).map((a) => a.id),
        ...(projected.ac_coverage?.unmet ?? []).map((a) => a.id),
      ])
      const charterOnlyUnmet = (charter?.acceptance_criteria ?? [])
        .filter((ac) => ac?.id != null && !projectedAcIds.has(String(ac.id)))
        .map((ac) => ({ id: String(ac.id), covering: [], missing: [], met: false, status_unknown: false }))
      const foldAgent = {
        objective: projected.objective,
        decision_log: projected.decision_log,
        open_items: openItems,
        ac_coverage: {
          met: projected.ac_coverage?.met ?? [],
          unmet: [...(projected.ac_coverage?.unmet ?? []), ...charterOnlyUnmet],
        },
      }

      // ── Assertions ────────────────────────────────────────────────────────

      // objective: both null or both non-null
      if (compileAgent.objective != null) {
        expect(foldAgent.objective, `${slug}: fold objective is null but compile has one`).not.toBeNull()
      } else {
        expect(foldAgent.objective, `${slug}: fold has objective but compile does not`).toBeNull()
      }

      // decision_log: id sets must match in both directions
      const compileDecisionIds = new Set((compileAgent.decision_log ?? []).map((d) => d.id))
      const foldDecisionIds = new Set((foldAgent.decision_log ?? []).map((d) => d.id))
      for (const id of compileDecisionIds) {
        expect(foldDecisionIds.has(id), `${slug}: fold missing decision ${id}`).toBe(true)
      }
      for (const id of foldDecisionIds) {
        expect(compileDecisionIds.has(id), `${slug}: fold has extra decision ${id} absent from compile`).toBe(true)
      }

      // ac_coverage: id sets must match in both directions (met+unmet merged)
      const compileAllAcIds = new Set([
        ...(compileAgent.ac_coverage?.met ?? []).map((a) => a.id),
        ...(compileAgent.ac_coverage?.unmet ?? []).map((a) => a.id),
      ])
      const foldAllAcIds = new Set([
        ...(foldAgent.ac_coverage?.met ?? []).map((a) => a.id),
        ...(foldAgent.ac_coverage?.unmet ?? []).map((a) => a.id),
      ])
      for (const id of compileAllAcIds) {
        expect(foldAllAcIds.has(id), `${slug}: fold missing AC ${id}`).toBe(true)
      }
      for (const id of foldAllAcIds) {
        expect(compileAllAcIds.has(id), `${slug}: fold has extra AC ${id} absent from compile`).toBe(true)
      }

      // open_items: id sets must match in both directions
      const compileOpenIds = new Set((compileAgent.open_items ?? []).map((i) => i.id))
      const foldOpenIds = new Set((foldAgent.open_items ?? []).map((i) => i.id))
      for (const id of compileOpenIds) {
        expect(foldOpenIds.has(id), `${slug}: fold missing open item ${id}`).toBe(true)
      }
      for (const id of foldOpenIds) {
        expect(compileOpenIds.has(id), `${slug}: fold has extra open item ${id} absent from compile`).toBe(true)
      }

      // open_items: per-id value assertions — resolved_by and graduated_to must match.
      // This pins the _decisionMerged logic: the TBD-12/D-55 class of bug (superseded
      // decision still resolves an open item) would silently pass the id-set check above.
      for (const id of compileOpenIds) {
        const c = (compileAgent.open_items ?? []).find((i) => i.id === id)
        const f = (foldAgent.open_items ?? []).find((i) => i.id === id)
        if (!f) continue // already caught above
        expect(f.resolved_by ?? null, `${slug}: ${id} resolved_by divergence (compile=${c?.resolved_by ?? null}, fold=${f.resolved_by ?? null})`).toBe(c?.resolved_by ?? null)
        expect(f.graduated_to ?? null, `${slug}: ${id} graduated_to divergence`).toBe(c?.graduated_to ?? null)
      }

      // ac_coverage: met value must match compile on every shared AC id
      const allAcIds = new Set([...compileAllAcIds, ...foldAllAcIds])
      for (const id of allAcIds) {
        const cAc = [...(compileAgent.ac_coverage?.met ?? []), ...(compileAgent.ac_coverage?.unmet ?? [])].find((a) => a.id === id)
        const fAc = [...(foldAgent.ac_coverage?.met ?? []), ...(foldAgent.ac_coverage?.unmet ?? [])].find((a) => a.id === id)
        if (!cAc || !fAc) continue // id-set mismatch already caught above
        expect(fAc.met, `${slug}: AC ${id} met divergence (compile=${cAc.met}, fold=${fAc.met})`).toBe(cAc.met)
      }
    })
  }
})

// ── FIX 2: pin the REQUIRE-EVENTS contract ───────────────────────────────────

describe('checkFoldCompileParity contract — events required (D-7)', () => {
  // Minimal valid-shape stubs — no motive data needed for the contract test.
  const projStub = { objective: null, decision_log: [], ac_coverage: { met: [], unmet: [] }, last_pause: null, baselines: [] }
  const compStub = { agent: { objective: null, decision_log: [], ac_coverage: { met: [], unmet: [] }, last_pause: null, baselines: [] } }

  it('throws when called without events (pinning REQUIRE-EVENTS contract)', () => {
    // This test MUST fail (not throw) if the guard is removed — removing the throw
    // causes checkFoldCompileParity to return normally, making .toThrow() fail red.
    expect(() => checkFoldCompileParity(projStub, compStub)).toThrow(
      'checkFoldCompileParity requires `events`',
    )
  })

  it('does NOT throw when events array is provided (even empty)', () => {
    expect(() => checkFoldCompileParity(projStub, compStub, { events: [] })).not.toThrow()
  })
})
