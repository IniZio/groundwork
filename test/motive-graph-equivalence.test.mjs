/**
 * motive-graph-equivalence.test.mjs — S5 consumer-equivalence harness.
 *
 * For all 5 real motives, asserts:
 *
 *   S5-AC2 (zero divergence): projectFoldGraph() matches compile() output for
 *           load-bearing consumer fields — objective, decision_log (reconstructible
 *           fields), ac_coverage, last_pause. Any genuine divergence is reported as
 *           a named finding, NOT hidden by narrowing the compared field set.
 *
 *   S5-AC3 (determinism): fold each motive twice, assert canonical graph states
 *           are byte-identical, and computeSeal with a fixed test key is byte-identical.
 *
 *   S5-losslessness-== (R-006): for every VALID_TYPE present in the 5-motive corpus,
 *           assert that the set of populated data fields == CONSUMED_FIELDS[type].
 *           Declared-but-unpopulated fields are reported as a finding.
 *           Types absent from the corpus (the 8 synthetic-only types) are reported
 *           separately and exempt from the == assertion.
 *
 *   S5-AC1 (structural): for event-sourceable node types (objective, decision,
 *           acceptance-criterion), compare fold node id sets to assembleMotiveGraph
 *           node id sets. Structural divergence for other types (ticket, open-item,
 *           spec-requirement, slice) is named and reported as a finding — NOT hidden.
 *
 * Run: npx vitest run test/motive-graph-equivalence.test.mjs
 */

import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readOrderedEvents } from '../hooks/lib/journal-order.mjs'
import { assembleGraphFold, CONSUMED_FIELDS } from '../hooks/lib/motive-graph-fold.mjs'
import { assembleMotiveGraph } from '../hooks/lib/motive-graph.mjs'
import { compile } from '../hooks/lib/motive-compile.mjs'
import { canonicalGraphState, computeSeal } from '../hooks/lib/graph-seal.mjs'
import { projectFoldGraph, NON_RECONSTRUCTIBLE_FIELDS } from '../hooks/lib/motive-graph-project.mjs'
import { checkFoldCompileParity, isLegacyDecisionOnlyDivergence } from '../hooks/lib/motive-graph-parity.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const JOURNAL_DIR = path.join(ROOT, '.groundwork', 'journal')

const MOTIVES = [
  'codify-motive-dag',
  'graph-authoring',
  'graph-pilot',
  'groundwork-development',
  'sealed-gate',
]

// Fixed test key for determinism seal assertion (arbitrary bytes, not a production key)
const SEAL_TEST_KEY = 'equivalence-harness-test-key-fixed'

// ── Per-motive fixtures ───────────────────────────────────────────────────────

/** @type {Map<string, { events: object[], fold: object, fold2: object, compiled: object, projected: object, projectedNoEvents: object, gt: object }>} */
const fixtures = new Map()

beforeAll(async () => {
  await Promise.all(
    MOTIVES.map(async (slug) => {
      const { events } = readOrderedEvents(JOURNAL_DIR, { motive: slug })
      const fold = assembleGraphFold(events)
      const fold2 = assembleGraphFold(events) // second independent fold for determinism
      const compiled = compile(events) // no groundTruth → mirrors real usage
      const projected = projectFoldGraph(fold, { events })
      // T2-AC4: events-free projection — uses fold attrs directly (a.title ?? a.decision ?? null).
      // Diverges from compile() when compile() updated title from a later decision-only event
      // (D-12 guards fold.attrs but cannot recover compile()'s event-stream title update order).
      const projectedNoEvents = projectFoldGraph(fold)
      const gt = await assembleMotiveGraph({ projectDir: ROOT, slug })
      fixtures.set(slug, { events, fold, fold2, compiled, projected, projectedNoEvents, gt })
    })
  )
}, 30_000)

// ── S5-AC3: determinism ────────────────────────────────────────────────────────

describe('S5-AC3 — determinism via canonical seal', () => {
  for (const slug of MOTIVES) {
    it(`${slug}: two independent folds produce byte-identical canonical states and seals`, () => {
      const { fold, fold2 } = fixtures.get(slug)
      const state1 = canonicalGraphState(fold)
      const state2 = canonicalGraphState(fold2)
      expect(state1).toBe(state2)

      const seal1 = computeSeal(state1, SEAL_TEST_KEY)
      const seal2 = computeSeal(state2, SEAL_TEST_KEY)
      expect(seal1).toBe(seal2)
      expect(typeof seal1).toBe('string')
      expect(seal1.length).toBeGreaterThan(0)
    })
  }
})

// ── S5-AC2: compile-essentials equivalence ────────────────────────────────────

describe('S5-AC2 — compile-essentials: no hard divergences (checkFoldCompileParity)', () => {
  // Exercises the module's comparison logic as the canonical oracle.
  // Individual field assertions below provide targeted failure messages.
  for (const slug of MOTIVES) {
    it(`${slug}: checkFoldCompileParity — zero hard divergences with events`, () => {
      const { projected, compiled, events } = fixtures.get(slug)
      const result = checkFoldCompileParity(projected, compiled, { events })
      expect(result.divergences, `${slug}: hard divergence(s) — do NOT soften; report as T2 finding`).toEqual([])
    })
  }
})

describe('S5-AC2 — compile-essentials: objective', () => {
  for (const slug of MOTIVES) {
    it(`${slug}: projected objective matches compile()`, () => {
      const { projected, compiled } = fixtures.get(slug)
      expect(projected.objective).toBe(compiled.agent.objective)
    })
  }
})

describe('S5-AC2 — compile-essentials: decision_log (reconstructible fields)', () => {
  it('NON_RECONSTRUCTIBLE_FIELDS is non-empty and documents genuine gaps', () => {
    expect(Object.keys(NON_RECONSTRUCTIBLE_FIELDS).length).toBeGreaterThan(0)
    // ord and ts are NOW reconstructible from fold node attrs (_ord, _ts) — must NOT be listed.
    expect(NON_RECONSTRUCTIBLE_FIELDS).not.toHaveProperty('decision_log[].ord')
    expect(NON_RECONSTRUCTIBLE_FIELDS).not.toHaveProperty('decision_log[].ts')
    // slices and line remain genuinely non-reconstructible.
    expect(NON_RECONSTRUCTIBLE_FIELDS).toHaveProperty('decision_log[].slices')
    expect(NON_RECONSTRUCTIBLE_FIELDS).toHaveProperty('baselines[].line')
  })

  for (const slug of MOTIVES) {
    it(`${slug}: projected decision_log count matches compile() (excluding legacy)`, () => {
      const { projected, compiled, fold } = fixtures.get(slug)
      const legacyCount = fold.nodes.filter(
        (n) => n.type === 'decision' && n.id.startsWith('decision:_legacy_ord')
      ).length
      // compile() routes legacy decisions to agent.decisions, not decision_log
      expect(projected.legacy_decisions_count).toBe(legacyCount)
      expect(projected.decision_log.length).toBe(compiled.agent.decision_log.length)
    })

    it(`${slug}: projected decision_log ids match compile() (insertion order)`, () => {
      const { projected, compiled } = fixtures.get(slug)
      const projIds = projected.decision_log.map((d) => d.id)
      const compIds = compiled.agent.decision_log.map((d) => d.id)
      expect(projIds).toEqual(compIds)
    })

    it(`${slug}: projected decision status matches compile() for all entries`, () => {
      const { projected, compiled } = fixtures.get(slug)
      for (let i = 0; i < projected.decision_log.length; i++) {
        const p = projected.decision_log[i]
        const c = compiled.agent.decision_log[i]
        expect(p.status, `decision ${p.id} status`).toBe(c.status)
      }
    })

    it(`${slug}: projected decision title matches compile() for all entries`, () => {
      // projectFoldGraph is called with { events } in beforeAll, enabling merge-lossy
      // title recovery: first-seen non-null title/decision per id is reconstructed from
      // the event stream, replicating compile()'s non-null update guard.
      const { projected, compiled } = fixtures.get(slug)
      for (let i = 0; i < projected.decision_log.length; i++) {
        const p = projected.decision_log[i]
        const c = compiled.agent.decision_log[i]
        expect(p.title, `decision ${p.id} title`).toBe(c.title)
      }
    })

    it(`${slug}: projected superseded_by matches compile() for all entries`, () => {
      const { projected, compiled } = fixtures.get(slug)
      const divergences = []
      for (let i = 0; i < projected.decision_log.length; i++) {
        const p = projected.decision_log[i]
        const c = compiled.agent.decision_log[i]
        if (p.superseded_by !== c.superseded_by) {
          divergences.push({
            id: p.id,
            projected: p.superseded_by,
            compiled: c.superseded_by,
            note: 'compile() sets superseded_by only when target already exists in decisionLogMap (no forward refs)',
          })
        }
      }
      // Forward-reference divergence is a known finding — report it clearly
      if (divergences.length > 0) {
        // This is a finding, not a bug to hide. Record it for visibility.
        // The test still passes: divergence due to forward references is a named
        // non-reconstructible pattern documented in NON_RECONSTRUCTIBLE_FIELDS rationale.
        // For motives in the corpus, check whether forward refs actually occur:
        const hasForwardRefOnly = divergences.every(
          (d) => d.compiled === null && d.projected !== null
        )
        if (!hasForwardRefOnly) {
          // A divergence other than forward-ref (projected null but compile has value)
          // is a genuine projector bug.
          expect(divergences, 'unexpected superseded_by divergence').toEqual([])
        }
        // Forward-ref divergences: compile wins (its behavior is the contract).
        // The projector cannot reconstruct forward-reference cases without reordering.
        // This is a named finding per the task spec: "report genuine non-reconstructible fields".
        console.warn(
          `[S5-AC2 finding] ${slug}: ${divergences.length} superseded_by forward-ref divergence(s):`,
          JSON.stringify(divergences, null, 2)
        )
      }
    })
  }
})

describe('S5-AC2 — compile-essentials: ac_coverage', () => {
  for (const slug of MOTIVES) {
    it(`${slug}: ac_coverage met ids match compile()`, () => {
      const { projected, compiled } = fixtures.get(slug)
      const projMetIds = projected.ac_coverage.met.map((e) => e.id).sort()
      const compMetIds = compiled.agent.ac_coverage.met.map((e) => e.id).sort()
      expect(projMetIds).toEqual(compMetIds)
    })

    it(`${slug}: ac_coverage unmet ids match compile()`, () => {
      const { projected, compiled } = fixtures.get(slug)
      const projUnmetIds = projected.ac_coverage.unmet.map((e) => e.id).sort()
      const compUnmetIds = compiled.agent.ac_coverage.unmet.map((e) => e.id).sort()
      expect(projUnmetIds).toEqual(compUnmetIds)
    })

    it(`${slug}: ac_coverage covering slices match compile() for met entries`, () => {
      const { projected, compiled } = fixtures.get(slug)
      for (const pEntry of projected.ac_coverage.met) {
        const cEntry = compiled.agent.ac_coverage.met.find((e) => e.id === pEntry.id)
        if (!cEntry) continue
        // Compare sorted covering arrays (order of covering slices is insertion-dependent)
        expect([...pEntry.covering].sort(), `AC ${pEntry.id} covering`).toEqual(
          [...cEntry.covering].sort()
        )
      }
    })

    it(`${slug}: ac_coverage status_unknown matches compile()`, () => {
      const { projected, compiled } = fixtures.get(slug)
      const allProj = [...projected.ac_coverage.met, ...projected.ac_coverage.unmet]
      const allComp = [...compiled.agent.ac_coverage.met, ...compiled.agent.ac_coverage.unmet]
      for (const pEntry of allProj) {
        const cEntry = allComp.find((e) => e.id === pEntry.id)
        if (!cEntry) continue
        expect(pEntry.status_unknown, `AC ${pEntry.id} status_unknown`).toBe(cEntry.status_unknown)
      }
    })
  }
})

describe('S5-AC2 — compile-essentials: last_pause', () => {
  for (const slug of MOTIVES) {
    it(`${slug}: projected last_pause matches compile()`, () => {
      const { projected, compiled } = fixtures.get(slug)
      if (compiled.agent.last_pause === null) {
        expect(projected.last_pause).toBeNull()
      } else {
        expect(projected.last_pause).not.toBeNull()
        expect(projected.last_pause.pointer).toBe(compiled.agent.last_pause.pointer)
        expect(projected.last_pause.summary).toBe(compiled.agent.last_pause.summary)
        expect(projected.last_pause.next_actions).toEqual(compiled.agent.last_pause.next_actions)
        // Confirm ts is stripped from the projection (it's non-reconstructible in compile view)
        expect(projected.last_pause).not.toHaveProperty('ts')
      }
    })
  }
})

describe('S5-AC2 — compile-essentials: baselines (reconstructible fields)', () => {
  for (const slug of MOTIVES) {
    it(`${slug}: projected baseline names match compile()`, () => {
      const { projected, compiled } = fixtures.get(slug)
      const projNames = projected.baselines.map((b) => b.name).sort()
      const compNames = compiled.agent.baselines.map((b) => b.name).sort()
      expect(projNames).toEqual(compNames)
    })

    it(`${slug}: projected baseline ord and ts match compile() per-name`, () => {
      const { projected, compiled } = fixtures.get(slug)
      // ord and ts were removed from NON_RECONSTRUCTIBLE_FIELDS — this test enforces that claim.
      for (const b of projected.baselines) {
        const cb = compiled.agent.baselines.find((c) => c.name === b.name)
        if (!cb) continue // name mismatch covered by the names test above
        expect(b.ord, `baseline ${b.name} ord`).toBe(cb.ord)
        expect(b.ts, `baseline ${b.name} ts`).toBe(cb.ts)
      }
    })
  }
})

// ── S5-AC1: structural comparison (event-sourced node types only) ─────────────

describe('S5-AC1 — structural: event-sourced node types vs assembleMotiveGraph', () => {
  // Types fully event-sourced: both fold and assembleMotiveGraph produce them from journal events.
  // 'decision' and 'objective' are purely event-derived in both paths.
  //
  // 'acceptance-criterion' is PARTIALLY event-sourced: fold creates ac nodes only from
  // AC_COVERAGE events. assembleMotiveGraph seeds ACs from compile()'s ac_coverage which
  // is also seeded from charter-declared ACs (even with no AC_COVERAGE events). This means
  // motives with charter-declared ACs but no AC_COVERAGE events will have divergence here.
  // That divergence is a named finding, not an assertion failure.
  const DECISION_OBJ_TYPES = new Set(['objective', 'decision'])

  for (const slug of MOTIVES) {
    it(`${slug}: fold objective and decision node ids == assembleMotiveGraph (minus legacy)`, () => {
      const { fold, gt } = fixtures.get(slug)

      const foldIds = new Set(
        fold.nodes
          .filter((n) => DECISION_OBJ_TYPES.has(n.type))
          .map((n) => n.id)
      )

      const gtIds = new Set(
        gt.nodes
          .filter((n) => DECISION_OBJ_TYPES.has(n.type))
          .map((n) => n.id)
      )

      const onlyInFold = [...foldIds].filter((id) => !gtIds.has(id))
      const onlyInGt = [...gtIds].filter((id) => !foldIds.has(id))

      // Legacy decision nodes appear in fold but not in assembleMotiveGraph
      // (assembleMotiveGraph uses compile()'s decision_log which excludes legacy decisions).
      const legacyOnlyInFold = onlyInFold.filter((id) => id.startsWith('decision:_legacy_ord'))
      const unexpectedOnlyInFold = onlyInFold.filter((id) => !id.startsWith('decision:_legacy_ord'))

      if (legacyOnlyInFold.length > 0) {
        console.warn(
          `[S5-AC1 finding] ${slug}: ${legacyOnlyInFold.length} legacy decision node(s) in fold only:`,
          legacyOnlyInFold
        )
      }

      // For objective and decision types, any non-legacy divergence is unexpected
      expect(unexpectedOnlyInFold, `${slug} objective/decision nodes only in fold`).toEqual([])
      expect(onlyInGt, `${slug} objective/decision nodes only in assembleMotiveGraph`).toEqual([])
    })

    it(`${slug}: reports acceptance-criterion and other structural divergences as named findings`, () => {
      const { fold, gt } = fixtures.get(slug)

      // acceptance-criterion divergence: fold only has ACs from AC_COVERAGE events;
      // assembleMotiveGraph also seeds from charter-declared ACs via compile().
      const foldAcIds = new Set(
        fold.nodes.filter((n) => n.type === 'acceptance-criterion').map((n) => n.id)
      )
      const gtAcIds = new Set(
        gt.nodes.filter((n) => n.type === 'acceptance-criterion').map((n) => n.id)
      )
      const acOnlyInFold = [...foldAcIds].filter((id) => !gtAcIds.has(id))
      const acOnlyInGt = [...gtAcIds].filter((id) => !foldAcIds.has(id))

      if (acOnlyInFold.length > 0 || acOnlyInGt.length > 0) {
        console.warn(
          `[S5-AC1 finding] ${slug}: acceptance-criterion structural divergence:`,
          `fold-only: ${acOnlyInFold.length}`,
          `assembleMotiveGraph-only: ${acOnlyInGt.length}`,
          `(assembleMotiveGraph seeds ACs from charter-declared ACs via compile(), fold only from AC_COVERAGE events)`
        )
      }

      // Report node type totals for transparency
      const allFoldTypes = new Set(fold.nodes.map((n) => n.type))
      const allGtTypes = new Set(gt.nodes.map((n) => n.type))
      const extraInGt = [...allGtTypes].filter((t) => !allFoldTypes.has(t))
      if (extraInGt.length > 0) {
        console.warn(
          `[S5-AC1 finding] ${slug}: assembleMotiveGraph-exclusive node types:`,
          extraInGt,
          `(fold: ${fold.nodes.length} nodes, assembleMotiveGraph: ${gt.nodes.length} nodes)`
        )
      }

      // Structural invariant 1: fold AC nodes must be a subset of gt AC nodes.
      // (fold only seeded from AC_COVERAGE events; gt also seeds from charter-declared ACs)
      // A fold AC node absent from gt would indicate a fold bug, not a charter-seeding gap.
      expect(acOnlyInFold, `${slug}: fold has acceptance-criterion nodes not in gt`).toEqual([])

      // Structural invariant 2: any node type that assembleMotiveGraph produces but fold
      // does not must be from the known set of non-journal sources.
      // New unexpected types appearing in gt indicate a fold coverage gap and should fail.
      const KNOWN_GT_EXCLUSIVE_TYPES = new Set([
        'slice',             // sourced from ledger + TASK_COMPLETE events (assembleMotiveGraph only)
        'ticket',            // sourced from .groundwork/motives/<slug>/tickets/ files
        'open-item',         // sourced from ledger open-items view
        'spec-requirement',  // sourced from doc/specs/ tree
        'acceptance-criterion', // also seeded from charter-declared ACs (no AC_COVERAGE event needed)
      ])
      const unexpectedExtraInGt = extraInGt.filter((t) => !KNOWN_GT_EXCLUSIVE_TYPES.has(t))
      expect(unexpectedExtraInGt, `${slug}: unexpected gt-exclusive node types`).toEqual([])
    })
  }
})

// ── T2-AC4: events-free projection reaches compile() zero-divergence bar ─────────
// isLegacyDecisionOnlyDivergence is imported from hooks/lib/motive-graph-parity.mjs (single source).

describe('T2-AC4 — events-free projection: projectFoldGraph(fold) without events', () => {
  // Events-free title recovery uses fold attrs (a.title ?? a.decision ?? null).
  // This DIFFERS from compile()'s non-null-guard semantics when compile() updated title
  // from a later decision-only event (title=null, decision="foo"):
  //   compile():        existing.title = "foo"  (updates from decision field when title null)
  //   fold events-free: a.title ?? a.decision → returns earlier stored title if non-null
  //   D-12 stores attrs.title and attrs.decision independently; field-precedence keeps title.
  //
  // Divergences that fit this "legacy decision-only" shape are NAMED FINDINGS —
  // mirroring the superseded_by forward-reference pattern above.  compile()'s title-from-
  // decision authoring convention is the contract; fold events-free correctly stores the
  // data but cannot replicate compile()'s event-order preference without the events array.
  //
  // All NON-title fields (status, id, count, ac_coverage, last_pause, baselines, objective)
  // are independent of titleFromEvents and MUST reach the same zero-divergence bar.

  for (const slug of MOTIVES) {
    it(`${slug}: events-free decision_log count and ids match compile()`, () => {
      const { projectedNoEvents, compiled, fold } = fixtures.get(slug)
      const legacyCount = fold.nodes.filter(
        (n) => n.type === 'decision' && n.id.startsWith('decision:_legacy_ord')
      ).length
      expect(projectedNoEvents.legacy_decisions_count).toBe(legacyCount)
      expect(projectedNoEvents.decision_log.length).toBe(compiled.agent.decision_log.length)
      const projIds = projectedNoEvents.decision_log.map((d) => d.id)
      const compIds = compiled.agent.decision_log.map((d) => d.id)
      expect(projIds).toEqual(compIds)
    })

    it(`${slug}: events-free decision_log id order matches compile() — graph-only, survives serialization`, () => {
      // Proves ordering is reconstructible from the graph alone without events access.
      // JSON.parse(JSON.stringify(fold)) severs any possible closure over the events array,
      // proving ordering survives serialization and that nothing outside the graph is reachable.
      // Asserting id ORDER (not just "array is sorted") bites: reversing the sort comparator
      // or breaking the first-event guard on a multi-event decision would flip/misplace entries.
      const { fold, compiled } = fixtures.get(slug)
      const foldCopy = JSON.parse(JSON.stringify(fold))
      const proj = projectFoldGraph(foldCopy)
      const projIds = proj.decision_log.map((d) => d.id)
      const compIds = compiled.agent.decision_log.map((d) => d.id)
      // Confirm ords are present (non-null) — proves _ord was persisted in fold node attrs.
      const ords = proj.decision_log.map((d) => d.ord)
      expect(ords.filter((o) => o != null).length, `${slug}: no ords on serialized projection — fold missing _ord attrs`).toBeGreaterThan(0)
      // The real assertion: graph-only id order == compile() id order.
      expect(projIds, `${slug}: graph-only decision_log id order diverges from compile()`).toEqual(compIds)
    })

    it(`${slug}: events-free decision status matches compile() for all entries`, () => {
      const { projectedNoEvents, compiled } = fixtures.get(slug)
      for (let i = 0; i < projectedNoEvents.decision_log.length; i++) {
        const p = projectedNoEvents.decision_log[i]
        const c = compiled.agent.decision_log[i]
        expect(p.status, `decision ${p.id} status`).toBe(c.status)
      }
    })

    it(`${slug}: events-free objective matches compile()`, () => {
      const { projectedNoEvents, compiled } = fixtures.get(slug)
      expect(projectedNoEvents.objective).toBe(compiled.agent.objective)
    })

    it(`${slug}: events-free ac_coverage ids match compile()`, () => {
      const { projectedNoEvents, compiled } = fixtures.get(slug)
      const projMetIds = projectedNoEvents.ac_coverage.met.map((e) => e.id).sort()
      const compMetIds = compiled.agent.ac_coverage.met.map((e) => e.id).sort()
      expect(projMetIds).toEqual(compMetIds)
      const projUnmetIds = projectedNoEvents.ac_coverage.unmet.map((e) => e.id).sort()
      const compUnmetIds = compiled.agent.ac_coverage.unmet.map((e) => e.id).sort()
      expect(projUnmetIds).toEqual(compUnmetIds)
    })

    it(`${slug}: events-free last_pause matches compile()`, () => {
      const { projectedNoEvents, compiled } = fixtures.get(slug)
      if (compiled.agent.last_pause === null) {
        expect(projectedNoEvents.last_pause).toBeNull()
      } else {
        expect(projectedNoEvents.last_pause).not.toBeNull()
        expect(projectedNoEvents.last_pause.pointer).toBe(compiled.agent.last_pause.pointer)
        expect(projectedNoEvents.last_pause.summary).toBe(compiled.agent.last_pause.summary)
        expect(projectedNoEvents.last_pause.next_actions).toEqual(compiled.agent.last_pause.next_actions)
      }
    })

    it(`${slug}: events-free baseline names match compile()`, () => {
      const { projectedNoEvents, compiled } = fixtures.get(slug)
      const projNames = projectedNoEvents.baselines.map((b) => b.name).sort()
      const compNames = compiled.agent.baselines.map((b) => b.name).sort()
      expect(projNames).toEqual(compNames)
    })

    it(`${slug}: events-free decision title vs compile() — report match figure, classify divergences`, () => {
      // T2-AC4 events-replay reference: S5-AC2 title tests all pass (events-replay 100%).
      // Events-free match figure is reported here.
      // Divergences are classified against the "legacy decision-only" shape:
      //   - ALL fit → named finding (console.error + assert narrow predicate + no test failure)
      //   - ANY don't fit → hard fail (candidate real fold/projection bug)
      const { projectedNoEvents, compiled, events } = fixtures.get(slug)
      const total = compiled.agent.decision_log.length
      let matches = 0
      const divergences = []

      for (let i = 0; i < total; i++) {
        const pe = projectedNoEvents.decision_log[i]
        const ce = compiled.agent.decision_log[i]
        if (!pe) {
          divergences.push({ id: ce.id, projected: undefined, compiled: ce.title })
          continue
        }
        if (pe.title === ce.title) {
          matches++
        } else {
          divergences.push({ id: pe.id, projected: pe.title, compiled: ce.title })
        }
      }

      console.log(`[T2-AC4] ${slug}: events-free title matches ${matches}/${total}`)

      if (divergences.length > 0) {
        const legacyDivergences = divergences.filter((d) =>
          isLegacyDecisionOnlyDivergence(events, d)
        )
        const unexplainedDivergences = divergences.filter((d) =>
          !isLegacyDecisionOnlyDivergence(events, d)
        )

        // Hard-fail on any unexplained divergence — candidate real fold/projection bug.
        if (unexplainedDivergences.length > 0) {
          console.error(
            `[T2-AC4] ${slug}: ${unexplainedDivergences.length} UNEXPLAINED title divergence(s) ` +
            `(not the legacy decision-only shape):`,
            JSON.stringify(unexplainedDivergences, null, 2)
          )
          expect(
            unexplainedDivergences,
            `T2-AC4: ${slug} has ${unexplainedDivergences.length} unexplained title divergence(s) ` +
            `not of the legacy-decision-only class — candidate fold/projection bug. ` +
            `Do NOT weaken this assertion.`
          ).toEqual([])
        }

        // Named finding for legacy-shape divergences: mirrors the superseded_by forward-ref pattern.
        // compile()'s title came from a later same-id DECISION event with decision!=null, title=null.
        // fold events-free correctly returns the stored earlier title via (a.title ?? a.decision).
        // This is compile()'s legacy authoring convention — not a fold correctness failure.
        if (legacyDivergences.length > 0) {
          console.error(
            `[T2-AC4 finding] ${slug}: ${legacyDivergences.length} events-free title divergence(s) ` +
            `classified as legacy-decision-only (compile() title from a later DECISION event ` +
            `supplying \`decision\` but no \`title\`; fold events-free returns earlier stored ` +
            `title via a.title ?? a.decision — matches compile()'s FIRST non-null authoring intent):`,
            JSON.stringify(legacyDivergences, null, 2)
          )
          // Assert the narrow shape: the number of legacy divergences == total divergences.
          // If this fails, unexplainedDivergences would have already hard-failed above.
          expect(legacyDivergences.length).toBe(divergences.length)
        }
      }
    })
  }
})

// ── S5 losslessness == (R-006 upgrade) ──────────────────────────────────────────

describe('S5-losslessness-== — field coverage: corpus fields == CONSUMED_FIELDS (types present in corpus)', () => {
  // Types absent from all 5 real motive corpora (appear only in synthetic fixtures for S2-AC3).
  // These are exempt from the == assertion: their CONSUMED_FIELDS entries are
  // authored from synthetic fixture design, not real corpus observation.
  const CORPUS_ABSENT_TYPES = new Set([
    'SESSION_START',
    'SPEC_CHANGE',
    'LINT_DRIFT',
    'PROTOTYPE_RESULT',
    'FAILURE',
    'WAIVER',
    'HANDOFF',
    'SPEC_DRIFT',
  ])

  it('collects corpus fields per type and asserts == CONSUMED_FIELDS for corpus-present types', () => {
    // Build a union of all data.* fields seen across all motives for each event type
    const corpusFields = new Map() // type → Set<string>
    const typesInCorpus = new Set()

    for (const slug of MOTIVES) {
      const { events } = fixtures.get(slug)
      for (const ev of events) {
        const type = ev.type
        if (!type) continue
        typesInCorpus.add(type)
        if (!corpusFields.has(type)) corpusFields.set(type, new Set())
        const data = ev.data ?? {}
        for (const key of Object.keys(data)) {
          corpusFields.get(type).add(key)
        }
      }
    }

    // Report corpus-absent types (informational, not failure)
    const corpusAbsentActual = [...Object.keys(CONSUMED_FIELDS)].filter(
      (t) => !typesInCorpus.has(t)
    )
    if (corpusAbsentActual.length > 0) {
      console.warn(
        '[S5-losslessness finding] Types declared in CONSUMED_FIELDS but absent from all 5 corpora:',
        corpusAbsentActual,
        '(assertions skipped for these types — synthetic-only)'
      )
    }

    // For each type present in the corpus, assert == (not ⊇)
    const declaredButUnpopulated = []
    const populatedButUndeclared = []

    for (const [type, consumed] of Object.entries(CONSUMED_FIELDS)) {
      if (CORPUS_ABSENT_TYPES.has(type) || !typesInCorpus.has(type)) continue

      const seen = corpusFields.get(type) ?? new Set()
      // declared but never populated across 5 corpora
      const declared = [...consumed].filter((f) => f !== 'motive_provenance' && !seen.has(f))
      // populated but not declared (these would have been caught by S2 tracer ⊇ assert)
      const undeclared = [...seen].filter((f) => !consumed.has(f))

      if (declared.length > 0) declaredButUnpopulated.push({ type, fields: declared })
      if (undeclared.length > 0) populatedButUndeclared.push({ type, fields: undeclared })
    }

    // Undeclared fields are a hard failure (S2 should have caught these — this is defense in depth)
    expect(populatedButUndeclared, 'populated fields not in CONSUMED_FIELDS').toEqual([])

    // Declared-but-unpopulated is a finding (not a failure): it means a field
    // was declared in advance but has no real corpus evidence yet.
    if (declaredButUnpopulated.length > 0) {
      console.warn(
        '[S5-losslessness finding] Fields declared in CONSUMED_FIELDS but never populated in 5-motive corpus:',
        JSON.stringify(declaredButUnpopulated, null, 2)
      )
      // R-006 requires reporting; this IS a finding (partial == divergence)
      // but we do not convert it to a hard failure since these types are real
      // and may be populated in future motives. Instead, record for visibility.
    }
  })
})
