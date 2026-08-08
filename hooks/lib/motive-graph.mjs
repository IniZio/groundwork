/**
 * motive-graph.mjs — Motive latent-graph assembler.
 *
 * Assembles a schema-stable graph document (nodes + edges) for a given motive
 * slug by drawing from the real data sources:
 *   1. Event-sourced fold (via assembleGraphFold + projectFoldGraph + readCharter)
 *   2. Tickets from .groundwork/motives/<slug>/tickets/
 *   3. Slices from .groundwork/runs/*.json (most-recently-modified matching motive_ref)
 *   4. Spec requirements from doc/specs/ ** /constraints.md (recursive)
 *
 * Public API:
 *   assembleMotiveGraph({ projectDir, slug }) → Promise<GraphDocument>
 *
 * Output schema (schema_version 1):
 *   { schema_version: 1, motive: string,
 *     nodes: Node[], edges: Edge[] }
 *
 * NodeType ∈ objective | decision | open-item | ticket | acceptance-criterion | slice | spec-requirement
 * EdgeKind ∈ anchors | resolved_by | graduated_to | blocked_by | covers_ac | slice_decision | spec_xref
 */

import path from 'node:path'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { readOrderedEvents } from './journal-order.mjs'
import { assembleGraphFold } from './motive-graph-fold.mjs'
import { projectFoldGraph } from './motive-graph-project.mjs'
import { readCharter } from './motive-charter.mjs'

const SCHEMA_VERSION = 1

/**
 * Vocabulary of every edge kind emitted by assembleMotiveGraph().
 *
 * Each entry declares three layout/rendering properties consumed by downstream
 * topology engines (e.g. the S2 layout engine):
 *
 *   drives_layering — true when this edge defines the parent→child hierarchy
 *                     used to assign topological layers.
 *   render          — how a canvas should draw the edge:
 *                       'primary' — solid line
 *                       'muted'   — faint / secondary line
 *                       'hidden'  — not drawn (kept for layering only)
 *   direction       — which way the topology flows for this edge:
 *                       'down'    — target sits below source (child below parent)
 *                       'up'      — target sits above source (source is the child)
 *                       'lateral' — peer relationship, no vertical ordering
 *
 * Goal topology: objective at apex → decisions → slices (ordered by blocked_by)
 *                → ACs as leaves.  spec_xref / resolved_by / graduated_to are
 *                cross-links that do not contribute to vertical layering.
 *
 * @type {Record<string, { drives_layering: boolean, render: 'primary'|'muted'|'hidden', direction: 'down'|'up'|'lateral' }>}
 */
export const EDGE_KINDS = {
  /** objective:root → decision:* — top of the hierarchy */
  anchors: { drives_layering: true, render: 'primary', direction: 'down' },

  /** openitem:* → decision:* — cross-link, not a hierarchy edge */
  resolved_by: { drives_layering: false, render: 'muted', direction: 'lateral' },

  /** openitem:* → ticket:* — cross-link, not a hierarchy edge */
  graduated_to: { drives_layering: false, render: 'muted', direction: 'lateral' },

  /** slice:* → slice:* — edge runs child→parent (blocked→blocker); blocker sits above */
  blocked_by: { drives_layering: true, render: 'primary', direction: 'up' },

  /** slice:* → ac:* — AC leaf sits below its parent slice */
  covers_ac: { drives_layering: true, render: 'primary', direction: 'down' },

  /**
   * slice:* → decision:* — places each slice under its decision in the
   * hierarchy; not drawn (diagonal noise) but kept for layering.
   * Edge flows child→parent so direction is 'up'.
   */
  slice_decision: { drives_layering: true, render: 'hidden', direction: 'up' },

  /** req:* → decision:* — cross-link, not a hierarchy edge */
  spec_xref: { drives_layering: false, render: 'muted', direction: 'lateral' },

  // ── Decision-lifecycle cross-links (D-2) ────────────────────────────────
  // None of these change layering or topology; all render muted as lateral
  // peer links.  Nothing emits them yet (fold wiring is a separate slice).

  /** decision:* → decision:* — this decision supersedes an older one */
  supersedes: { drives_layering: false, render: 'muted', direction: 'lateral' },

  /** decision:* → decision:* — this decision retires/closes another */
  retires: { drives_layering: false, render: 'muted', direction: 'lateral' },

  /** decision:* → decision:* — this decision revises (partially amends) another */
  revises: { drives_layering: false, render: 'muted', direction: 'lateral' },
}

/** Truncate a string to at most `max` characters (adds ellipsis). */
function trunc(str, max = 120) {
  if (str == null) return ''
  const s = String(str)
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/**
 * Find the most-recently-modified ledger JSON in .groundwork/runs/
 * whose motive_ref === slug. Returns the parsed ledger or null.
 */
function findLedger(projectDir, slug) {
  const runsDir = path.join(projectDir, '.groundwork', 'runs')
  let files = []
  try {
    files = readdirSync(runsDir).filter((f) => f.endsWith('.json'))
  } catch {
    return null
  }

  let best = null
  let bestMtime = 0
  for (const f of files) {
    const fp = path.join(runsDir, f)
    try {
      const raw = readFileSync(fp, 'utf8')
      const ledger = JSON.parse(raw)
      if (ledger.motive_ref !== slug) continue
      const mtime = statSync(fp).mtimeMs
      if (mtime > bestMtime) {
        bestMtime = mtime
        best = ledger
      }
    } catch {
      // ignore unreadable / non-JSON files
    }
  }
  return best
}

/**
 * Parse spec requirements from all doc/specs/ ** /constraints.md files.
 * Each H2 heading with a {#anchor} is one requirement.
 * Returns array of { id, label, file, originDecisionRef? }
 *
 * The canonical uppercase REQ-ID is extracted from the heading text before " — ".
 * originDecisionRef (OPTIONAL/sparse): parsed from "origin_decision_ref: <slug>#D-n"
 * in the requirement section body.
 */
function parseSpecRequirements(projectDir) {
  const specsDir = path.join(projectDir, 'doc', 'specs')
  const reqs = []

  function walkDir(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walkDir(full)
      } else if (e.name === 'constraints.md') {
        parseConstraintsFile(full)
      }
    }
  }

  function parseConstraintsFile(filePath) {
    let content
    try {
      content = readFileSync(filePath, 'utf8')
    } catch {
      return
    }

    const lines = content.split('\n')
    let currentHeading = null
    let currentBody = []

    function flushSection() {
      if (!currentHeading) return
      const { id, label } = currentHeading
      const bodyText = currentBody.join('\n')
      // Check for optional origin_decision_ref: <slug>#D-n
      const odrMatch = bodyText.match(/origin_decision_ref:\s*(\S+#D-\d+)/)
      const req = { id, label, file: filePath }
      if (odrMatch) req.originDecisionRef = odrMatch[1]
      reqs.push(req)
      currentBody = []
      currentHeading = null
    }

    for (const line of lines) {
      // H2 heading with {#anchor}: ## UPPER-ID — heading text {#anchor}
      const h2 = line.match(/^##\s+(.+?)\s+\{#[^}]+\}\s*$/)
      if (h2) {
        flushSection()
        const headingText = h2[1].trim()
        // Extract the canonical ID: everything before " — " (em-dash)
        const emdash = headingText.indexOf(' — ')
        const id = emdash !== -1 ? headingText.slice(0, emdash).trim() : headingText.trim()
        currentHeading = { id, label: headingText }
      } else if (currentHeading) {
        currentBody.push(line)
      }
    }
    flushSection()
  }

  walkDir(specsDir)
  return reqs
}

/**
 * assembleMotiveGraph({ projectDir, slug }) → Promise<GraphDocument>
 *
 * @param {{ projectDir: string, slug: string }} opts
 * @returns {Promise<{ schema_version: number, motive: string, nodes: object[], edges: object[] }>}
 */
export async function assembleMotiveGraph({ projectDir, slug }) {
  const journalDir = path.join(projectDir, '.groundwork', 'journal')

  // ── 1. Build motive graph surface from canonical event-sourced fold ───────
  const { events } = readOrderedEvents(journalDir, { motive: slug })
  const fold = assembleGraphFold(events)
  const projected = projectFoldGraph(fold, { events })

  // open_items: read from charter; resolve via events directly (compile-exact semantics).
  // Supersession by another decision mutates the target's status in compile's decisionLogMap
  // WITHOUT re-running the resolvedByDecisions check for that target.  Using projected
  // decision_log's final status would wrongly un-resolve items whose decision was later
  // superseded by a different one — only the decision's OWN subsequent event can remove it.
  const charter = readCharter({ projectDir, motive: slug })
  const resolvedByDecisions = new Map()
  const _decisionMerged = new Map() // id → { status, resolves } accumulated from own events
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

  // ac_coverage: merge charter-declared ACs as unmet when no events exist yet.
  // compile() seeds charter.acceptance_criteria so they appear as unmet even without events.
  // projectFoldGraph only sees ACs from fold nodes (AC_COVERAGE events) — no charter read.
  // We merge the gap here to preserve schema stability (D-4).
  const projectedAcIds = new Set([
    ...(projected.ac_coverage?.met ?? []).map((a) => a.id),
    ...(projected.ac_coverage?.unmet ?? []).map((a) => a.id),
  ])
  const charterOnlyUnmet = (charter?.acceptance_criteria ?? [])
    .filter((ac) => ac?.id != null && !projectedAcIds.has(String(ac.id)))
    .map((ac) => ({ id: String(ac.id), covering: [], missing: [], met: false, status_unknown: false }))

  const agent = {
    objective: projected.objective,
    decision_log: projected.decision_log,
    open_items: openItems,
    ac_coverage: {
      met: projected.ac_coverage?.met ?? [],
      unmet: [...(projected.ac_coverage?.unmet ?? []), ...charterOnlyUnmet],
    },
  }

  const nodes = []

  // ── NODE SOURCES ──────────────────────────────────────────────────────────

  // objective:root — one node from agent.objective
  if (agent.objective != null) {
    nodes.push({
      id: 'objective:root',
      type: 'objective',
      label: trunc(agent.objective, 120),
      detail: { text: agent.objective },
    })
  }

  // decision:<id> nodes
  for (const d of agent.decision_log ?? []) {
    const label = d.decision ?? d.title ?? d.id
    nodes.push({
      id: `decision:${d.id}`,
      type: 'decision',
      label: trunc(label, 120),
      detail: {
        status: d.status ?? null,
        rationale: d.rationale ?? null,
        supersedes: d.supersedes ?? null,
        superseded_by: d.superseded_by ?? null,
      },
    })
  }

  // openitem:<id> nodes — derive status from resolved_by / graduated_to
  for (const item of agent.open_items ?? []) {
    const derivedStatus = item.resolved_by
      ? 'resolved'
      : item.graduated_to
        ? 'graduated'
        : 'open'
    nodes.push({
      id: `openitem:${item.id}`,
      type: 'open-item',
      label: trunc(item.statement, 120),
      detail: {
        kind: item.kind ?? null,
        derivedStatus,
        owner: item.owner ?? null,
        resolved_by: item.resolved_by ?? null,
        graduated_to: item.graduated_to ?? null,
      },
    })
  }

  // ac:<id> nodes — from ac_coverage.met[] + ac_coverage.unmet[]
  const acCoverage = agent.ac_coverage ?? { met: [], unmet: [] }
  const acSeen = new Set()
  for (const ac of [...(acCoverage.met ?? []), ...(acCoverage.unmet ?? [])]) {
    if (acSeen.has(ac.id)) continue
    acSeen.add(ac.id)
    nodes.push({
      id: `ac:${ac.id}`,
      type: 'acceptance-criterion',
      label: ac.id,
      detail: { met: ac.met ?? false, covering: ac.covering ?? [] },
    })
  }

  // ticket:<stem> nodes — from .groundwork/motives/<slug>/tickets/
  const ticketsDir = path.join(projectDir, '.groundwork', 'motives', slug, 'tickets')
  let ticketFiles = []
  try {
    ticketFiles = readdirSync(ticketsDir).filter((f) => f.endsWith('.md'))
  } catch {
    // missing tickets dir is tolerated — zero ticket nodes
  }

  for (const f of ticketFiles) {
    const stem = f.replace(/\.md$/, '')
    let label = stem
    try {
      const content = readFileSync(path.join(ticketsDir, f), 'utf8')
      const h1 = content.match(/^#\s+(.+)/m)
      if (h1) label = h1[1].trim()
    } catch {
      // use stem as fallback
    }
    nodes.push({
      id: `ticket:${stem}`,
      type: 'ticket',
      label: trunc(label, 120),
      detail: {},
    })
  }

  // slice:<id> nodes — from most-recent ledger matching motive_ref === slug
  const ledger = findLedger(projectDir, slug)
  const slices = ledger?.slices ?? []
  for (const s of slices) {
    nodes.push({
      id: `slice:${s.id}`,
      type: 'slice',
      label: trunc(s.desc, 120),
      detail: { wave: s.wave ?? null, status: s.status ?? null, kind: s.kind ?? null },
    })
  }

  // req:<REQ-ID> nodes — from doc/specs/**/constraints.md
  // Only emit nodes for requirements that have a spec_xref edge into THIS motive.
  // Compute linked requirements first (before building nodeIds) so we can filter.
  const specReqs = parseSpecRequirements(projectDir)
  const decisionIdSet = new Set((agent.decision_log ?? []).map((d) => d.id))
  const linkedSpecReqs = specReqs.filter((req) => {
    if (!req.originDecisionRef) return false
    const m = req.originDecisionRef.match(/^[^#]+#(D-\d+)$/)
    return m && decisionIdSet.has(m[1])
  })
  for (const req of linkedSpecReqs) {
    nodes.push({
      id: `req:${req.id}`,
      type: 'spec-requirement',
      label: req.label,
      detail: { file: req.file },
    })
  }

  // ── BUILD NODE-ID SET (for dangling-edge filter) ──────────────────────────
  const nodeIds = new Set(nodes.map((n) => n.id))

  // ── EDGE ASSEMBLY ─────────────────────────────────────────────────────────
  const edges = []

  /** Safe push: drops edge if either endpoint is not in nodeIds. */
  function pushEdge(source, target, kind) {
    if (nodeIds.has(source) && nodeIds.has(target)) {
      edges.push({ source, target, kind })
    }
  }

  // anchors: objective:root → every decision:<id>
  if (nodeIds.has('objective:root')) {
    for (const d of agent.decision_log ?? []) {
      pushEdge('objective:root', `decision:${d.id}`, 'anchors')
    }
  }

  // resolved_by: openitem:<id> → decision:<resolved_by>
  for (const item of agent.open_items ?? []) {
    if (item.resolved_by) {
      pushEdge(`openitem:${item.id}`, `decision:${item.resolved_by}`, 'resolved_by')
    }
  }

  // graduated_to: openitem:<id> → ticket:<stem>
  // graduated_to value may be a stem or ticket id; match by exact stem or prefix
  const ticketStemSet = new Set(ticketFiles.map((f) => f.replace(/\.md$/, '')))
  for (const item of agent.open_items ?? []) {
    if (!item.graduated_to) continue
    const gradVal = item.graduated_to
    let matchedStem = null
    if (ticketStemSet.has(gradVal)) {
      matchedStem = gradVal
    } else {
      for (const stem of ticketStemSet) {
        if (stem.startsWith(gradVal) || gradVal.startsWith(stem)) {
          matchedStem = stem
          break
        }
      }
    }
    if (matchedStem) {
      pushEdge(`openitem:${item.id}`, `ticket:${matchedStem}`, 'graduated_to')
    }
  }

  // blocked_by: slice:<id> → slice:<blockerId>
  for (const s of slices) {
    for (const bId of s.blocked_by ?? []) {
      pushEdge(`slice:${s.id}`, `slice:${bId}`, 'blocked_by')
    }
  }

  // covers_ac: slice:<id> → ac:<acId>
  for (const s of slices) {
    const coversAc = Array.isArray(s.covers_ac)
      ? s.covers_ac
      : typeof s.covers_ac === 'string'
        ? [s.covers_ac]
        : []
    for (const acId of coversAc) {
      pushEdge(`slice:${s.id}`, `ac:${acId}`, 'covers_ac')
    }
  }

  // slice_decision: slice:<id> → decision:<dId>
  for (const s of slices) {
    for (const dId of s.decisions ?? []) {
      pushEdge(`slice:${s.id}`, `decision:${dId}`, 'slice_decision')
    }
  }

  // spec_xref: req:<REQ-ID> → decision:<D-n>
  // Only linkedSpecReqs have a valid origin_decision_ref targeting a decision in this motive.
  for (const req of linkedSpecReqs) {
    const match = req.originDecisionRef.match(/^[^#]+#(D-\d+)$/)
    if (!match) continue
    pushEdge(`req:${req.id}`, `decision:${match[1]}`, 'spec_xref')
  }

  // ── FINAL DANGLING-EDGE FILTER (defensive — pushEdge already guards) ──────
  const cleanEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

  return {
    schema_version: SCHEMA_VERSION,
    motive: slug,
    nodes,
    edges: cleanEdges,
  }
}
