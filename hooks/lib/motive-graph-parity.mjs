/**
 * motive-graph-parity.mjs — Production-callable parity module for fold-vs-compile equivalence.
 *
 * The safety gate for consumer cutovers (T3/T4/T5): asserts that projectFoldGraph()
 * output matches compile() output for all load-bearing agent.* fields.
 *
 * compile() remains an INDEPENDENT second implementation (D-4) — this module
 * calls both sides and compares; it never routes one through the other.
 *
 * NON_RECONSTRUCTIBLE_FIELDS are excluded from comparison (decision_log[].slices,
 * baselines[].line) — they require ledger ground truth or shard line offset.
 *
 * Named findings (NOT hard failures):
 *   superseded_by_forward_ref  — compile() omits forward-reference superseded_by entries
 *   legacy_decision_only_title — events-free title divergence from compile()'s event-order
 *                                title authoring convention (only classifiable with events)
 *
 * Exports:
 *   checkFoldCompileParity(projected, compiled, opts)  — pure comparison, structured result
 *   assertFoldCompileParity(slug, journalDir)           — I/O wrapper, throws on hard divergence
 *   isLegacyDecisionOnlyDivergence(events, div)         — classify legacy title divergences (D-88/D-89)
 */

import { readOrderedEvents } from './journal-order.mjs'
import { assembleGraphFold } from './motive-graph-fold.mjs'
import { compile } from './motive-compile.mjs'
import { projectFoldGraph, NON_RECONSTRUCTIBLE_FIELDS } from './motive-graph-project.mjs'

export { NON_RECONSTRUCTIBLE_FIELDS }

/**
 * Returns true if the divergence fits the "legacy decision-only later event" shape:
 * compile() derived its final title from a same-id DECISION event carrying a non-null
 * `decision` field but no `title` field, while fold's events-free path returned the
 * earlier stored title via (a.title ?? a.decision) — field-precedence, not event order.
 *
 * This is compile()'s legacy authoring pattern: the SAME mechanism as the superseded_by
 * forward-reference finding.  It is NOT a fold correctness bug.
 *
 * Verification: simulates both compile() and fold events-free from the event stream and
 * checks that both simulations reproduce the observed values AND that the final compile()
 * title was set by a decision-only event (d.title == null, d.decision != null).
 *
 * @param {object[]} events - ordered journal events for the motive
 * @param {{ id: string, projected: string|null|undefined, compiled: string|null }} div
 * @returns {boolean}
 */
export function isLegacyDecisionOnlyDivergence(events, { id, projected: foldTitle, compiled: compileTitle }) {
  const decisionEvents = events.filter((ev) => ev.type === 'DECISION' && ev.data?.id === id)
  if (decisionEvents.length === 0) return false

  // Simulate compile()'s non-null title/decision guard in event-stream order.
  // Track whether the LAST mutation was from a decision-only event.
  let simulatedCompileTitle = null
  let lastUpdateWasDecisionOnly = false
  for (const ev of decisionEvents) {
    const d = ev.data ?? {}
    if (simulatedCompileTitle === null) {
      simulatedCompileTitle = d.title ?? d.decision ?? null
      lastUpdateWasDecisionOnly = (d.title == null && d.decision != null)
    } else {
      if (d.title != null) {
        simulatedCompileTitle = d.title
        lastUpdateWasDecisionOnly = false
      } else if (d.decision != null) {
        simulatedCompileTitle = d.decision
        lastUpdateWasDecisionOnly = true
      }
    }
  }

  // Simulate fold events-free: last-non-null write per field (D-12), then a.title ?? a.decision.
  let foldAttrTitle = null
  let foldAttrDecision = null
  for (const ev of decisionEvents) {
    const d = ev.data ?? {}
    if (d.title != null) foldAttrTitle = d.title
    if (d.decision != null) foldAttrDecision = d.decision
  }
  const simulatedEvFreeTitle = foldAttrTitle ?? foldAttrDecision ?? null

  // All three must hold:
  // 1. compile() simulation reproduces the observed compiled title.
  // 2. fold events-free simulation reproduces the observed projected title.
  // 3. The final compile() title came from a decision-only event (the legacy authoring class).
  return (
    simulatedCompileTitle === compileTitle &&
    simulatedEvFreeTitle === foldTitle &&
    lastUpdateWasDecisionOnly
  )
}

/**
 * Compare a fold projection against a compile() result for all load-bearing agent.* fields.
 *
 * Excludes NON_RECONSTRUCTIBLE_FIELDS:
 *   decision_log[].slices  — requires ledger ground truth
 *   baselines[].line       — requires shard line offset
 *
 * events is REQUIRED (throws if omitted or null). The parity gate always runs with events
 * available; consumers reading graph-only (events-free) must not call this function.
 *
 * Title divergences are always hard failures. Legacy title divergence classification
 * (D-88/D-89) requires events and is handled by isLegacyDecisionOnlyDivergence, which
 * callers (e.g. T2-AC4) invoke directly when operating on events-free projections.
 *
 * superseded_by forward-reference divergence (compile() omits, fold reconstructs):
 *   Always classified as a named finding, not a hard failure.
 *   The narrow shape is: c.superseded_by === null && p.superseded_by !== null.
 *   The inverse (compile has a value but projected does not) is a hard failure.
 *
 * @param {object} projected  - result of projectFoldGraph(fold, opts)
 * @param {object} compiled   - result of compile(events)
 * @param {{ events: object[] }} opts  - events is REQUIRED; throws if omitted or null
 * @returns {{ ok: boolean, divergences: object[], findings: object[] }}
 */
export function checkFoldCompileParity(projected, compiled, { events } = {}) {
  if (events == null) {
    throw new Error(
      'checkFoldCompileParity requires `events` to classify legacy title divergences (D-7); ' +
      'the parity gate runs with events available. ' +
      'Consumers reading graph-only must not call this events-free.',
    )
  }
  const divergences = []
  const findings = []

  // 1. objective
  if (projected.objective !== compiled.agent.objective) {
    divergences.push({ field: 'objective', projected: projected.objective, compiled: compiled.agent.objective })
  }

  // 2. decision_log count
  if (projected.decision_log.length !== compiled.agent.decision_log.length) {
    divergences.push({
      field: 'decision_log.length',
      projected: projected.decision_log.length,
      compiled: compiled.agent.decision_log.length,
    })
    // Can't compare individual entries when counts differ — return early.
    return { ok: false, divergences, findings }
  }

  // 3. decision_log entries
  for (let i = 0; i < projected.decision_log.length; i++) {
    const p = projected.decision_log[i]
    const c = compiled.agent.decision_log[i]

    // id
    if (p.id !== c.id) {
      divergences.push({ field: `decision_log[${i}].id`, idx: i, projected: p.id, compiled: c.id })
    }

    // status
    if (p.status !== c.status) {
      divergences.push({ field: `decision_log[${i}].status`, idx: i, id: p.id, projected: p.status, compiled: c.status })
    }

    // title — divergence is always a hard failure (events are required, guard at top).
    if (p.title !== c.title) {
      divergences.push({ field: `decision_log[${i}].title`, idx: i, id: p.id, projected: p.title, compiled: c.title })
    }

    // superseded_by — narrow forward-ref shape is a named finding; inverse is hard failure.
    if (p.superseded_by !== c.superseded_by) {
      const isForwardRef = c.superseded_by === null && p.superseded_by !== null
      if (isForwardRef) {
        findings.push({ kind: 'superseded_by_forward_ref', id: p.id, projected: p.superseded_by, compiled: c.superseded_by })
      } else {
        divergences.push({ field: `decision_log[${i}].superseded_by`, idx: i, id: p.id, projected: p.superseded_by, compiled: c.superseded_by })
      }
    }

    // slices: NON_RECONSTRUCTIBLE_FIELDS['decision_log[].slices'] → skip comparison
  }

  // 4. ac_coverage met ids
  const projMetIds = projected.ac_coverage.met.map((e) => e.id).sort()
  const compMetIds = compiled.agent.ac_coverage.met.map((e) => e.id).sort()
  if (JSON.stringify(projMetIds) !== JSON.stringify(compMetIds)) {
    divergences.push({ field: 'ac_coverage.met.ids', projected: projMetIds, compiled: compMetIds })
  }

  // ac_coverage unmet ids
  const projUnmetIds = projected.ac_coverage.unmet.map((e) => e.id).sort()
  const compUnmetIds = compiled.agent.ac_coverage.unmet.map((e) => e.id).sort()
  if (JSON.stringify(projUnmetIds) !== JSON.stringify(compUnmetIds)) {
    divergences.push({ field: 'ac_coverage.unmet.ids', projected: projUnmetIds, compiled: compUnmetIds })
  }

  // ac_coverage covering slices per met entry
  for (const pEntry of projected.ac_coverage.met) {
    const cEntry = compiled.agent.ac_coverage.met.find((e) => e.id === pEntry.id)
    if (!cEntry) continue
    const pCovering = [...(pEntry.covering ?? [])].sort()
    const cCovering = [...(cEntry.covering ?? [])].sort()
    if (JSON.stringify(pCovering) !== JSON.stringify(cCovering)) {
      divergences.push({ field: `ac_coverage.met[${pEntry.id}].covering`, projected: pCovering, compiled: cCovering })
    }
  }

  // ac_coverage status_unknown per entry
  const allProj = [...projected.ac_coverage.met, ...projected.ac_coverage.unmet]
  const allComp = [...compiled.agent.ac_coverage.met, ...compiled.agent.ac_coverage.unmet]
  for (const pEntry of allProj) {
    const cEntry = allComp.find((e) => e.id === pEntry.id)
    if (!cEntry) continue
    if (pEntry.status_unknown !== cEntry.status_unknown) {
      divergences.push({
        field: `ac_coverage[${pEntry.id}].status_unknown`,
        projected: pEntry.status_unknown,
        compiled: cEntry.status_unknown,
      })
    }
  }

  // 5. last_pause
  const cp = compiled.agent.last_pause
  const pp = projected.last_pause
  if (cp === null) {
    if (pp !== null) {
      divergences.push({ field: 'last_pause', projected: pp, compiled: null })
    }
  } else if (pp === null) {
    divergences.push({ field: 'last_pause', projected: null, compiled: cp })
  } else {
    if (pp.pointer !== cp.pointer) {
      divergences.push({ field: 'last_pause.pointer', projected: pp.pointer, compiled: cp.pointer })
    }
    if (pp.summary !== cp.summary) {
      divergences.push({ field: 'last_pause.summary', projected: pp.summary, compiled: cp.summary })
    }
    if (JSON.stringify(pp.next_actions) !== JSON.stringify(cp.next_actions)) {
      divergences.push({ field: 'last_pause.next_actions', projected: pp.next_actions, compiled: cp.next_actions })
    }
  }

  // 6. baselines — excluding NON_RECONSTRUCTIBLE_FIELDS: baselines[].line
  const projBNames = projected.baselines.map((b) => b.name).sort()
  const compBNames = compiled.agent.baselines.map((b) => b.name).sort()
  if (JSON.stringify(projBNames) !== JSON.stringify(compBNames)) {
    divergences.push({ field: 'baselines.names', projected: projBNames, compiled: compBNames })
  }

  // Pair the two lists positionally after sorting by ord, NOT by name lookup.
  // A name lookup cannot pair records that share a name — a motive may hold several
  // BASELINE events with no data.name (name === null), and find() then matched every
  // projected record against the first compiled one, reporting spurious ord/ts
  // divergences. `ord` is the per-motive event ordinal and is unique per record, so
  // ord order is a total order on both lists. This also compares `name` per position,
  // which the previous find()-based pairing could not: it is strictly stricter than
  // the code it replaces, and it no longer skips an unpaired record silently.
  const byOrd = (a, b) => (a.ord ?? 0) - (b.ord ?? 0)
  const projBaselines = [...projected.baselines].sort(byOrd)
  const compBaselines = [...compiled.agent.baselines].sort(byOrd)
  // Length mismatch is already reported above as a baselines.names divergence.
  const pairCount = Math.min(projBaselines.length, compBaselines.length)
  for (let i = 0; i < pairCount; i++) {
    const b = projBaselines[i]
    const cb = compBaselines[i]
    if (b.name !== cb.name) {
      divergences.push({ field: `baselines[${i}].name`, projected: b.name, compiled: cb.name })
    }
    if (b.ord !== cb.ord) {
      divergences.push({ field: `baselines[${i}].ord`, projected: b.ord, compiled: cb.ord })
    }
    if (b.ts !== cb.ts) {
      divergences.push({ field: `baselines[${i}].ts`, projected: b.ts, compiled: cb.ts })
    }
    // b.line vs cb.line — NON_RECONSTRUCTIBLE_FIELDS['baselines[].line'] → skip
  }

  return { ok: divergences.length === 0, divergences, findings }
}

/**
 * Read events for a motive slug, build the fold, project, compile independently, and compare.
 *
 * Synchronous. Throws with structured detail on any hard divergence, including the slug
 * and the diverging field name in the message.
 *
 * @param {string} slug        - motive slug
 * @param {string} journalDir  - absolute path to .groundwork/journal
 * @returns {{ ok: boolean, divergences: object[], findings: object[] }}
 */
export function assertFoldCompileParity(slug, journalDir) {
  const { events } = readOrderedEvents(journalDir, { motive: slug })
  const fold = assembleGraphFold(events)
  const compiled = compile(events) // no groundTruth — mirrors real usage
  const projected = projectFoldGraph(fold, { events })

  const result = checkFoldCompileParity(projected, compiled, { events })

  if (!result.ok) {
    const detail = JSON.stringify(result.divergences, null, 2)
    throw new Error(
      `Parity check FAILED for motive "${slug}": ${result.divergences.length} hard divergence(s)\n${detail}`
    )
  }

  return result
}
