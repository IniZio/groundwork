/**
 * traceability-ambient.mjs — S5 of motive tracking-viz (AC-1, AC-2, AC-3, D-2, D-9)
 *
 * Exports:
 *   renderTraceHtml(classifiedGraph, slug?)  → string   (pure, no I/O)
 *   regenerateMotiveTraceHtml(projectDir, slug)  → void (reads store, writes TRACE.html)
 *
 * OFFLINE CONTRACT: zero external URLs. All CSS/JS/data inlined.
 *
 * D-9 patterns rendered:
 *   1. WAVE-BAND TOPOLOGICAL LAYOUT — six tiers as horizontal swimlanes
 *   2. SEMANTIC EDGE STYLING — proven=green, unproven=amber, stale=red-hatch, missing=dashed-red
 *   3. NEEDS YOU list — unproven+stale+missing links surfaced as a visible action list
 *
 * NEVER throws — warns to stderr on error; exit code is unaffected (mirrors motive-map.mjs).
 */

import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
// NOTE: traceability-adapter.mjs has a static import of parseSpecRequirements from spec-io.mjs
// which may be absent in some build states. Use a dynamic import so the broken chain only
// fires inside _generate (already wrapped in try/catch) rather than at ledger module load time.
import { buildTraceabilityGraph } from './traceability-join.mjs'
import { classifyTraceabilityGraph } from './traceability-classify.mjs'

// ---------------------------------------------------------------------------
// Tier layout constants
// ---------------------------------------------------------------------------

/** Canonical tier order — top (objective) to bottom (gate + artifact-evidence). */
const TIER_ORDER = [
  'objective',
  'spec-requirement',
  'slice',
  'self-test',
  'live-verify',
  'gate',
  'artifact-evidence',
]

const TIER_LABELS = {
  'objective':         'Objective',
  'spec-requirement':  'Spec Requirements',
  'slice':             'Slices',
  'self-test':         'Self-Tests',
  'live-verify':       'Live Verifications',
  'gate':              'Gate Verdicts',
  'artifact-evidence': 'Artifact Evidence',
}

const SVG_W        = 1100  // total SVG width
const TIER_H       = 110   // height per swimlane
const NODE_W       = 150   // node box width
const NODE_H       = 38    // node box height
const PAD_X        = 60    // left/right padding for node placement
const PAD_TOP      = 20    // top padding before first tier

// ---------------------------------------------------------------------------
// Edge rendering constants
// ---------------------------------------------------------------------------

/** Stroke style per classification. dasharray: null means solid. */
const EDGE_STYLE = {
  proven:   { stroke: '#22c55e', dasharray: null,       opacity: '0.85', width: '2' },
  unproven: { stroke: '#d97706', dasharray: '5,4',      opacity: '0.75', width: '1.5' },
  stale:    { stroke: '#ef4444', dasharray: '8,3,2,3',  opacity: '0.85', width: '2' },
  missing:  { stroke: '#dc2626', dasharray: '3,5',      opacity: '0.80', width: '1.5' },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Short display label from a node id like "slice:S5" → "S5" */
function shortLabel(node) {
  if (node.label && node.label !== node.id) return node.label
  const id = String(node.id ?? '')
  const colon = id.indexOf(':')
  return colon >= 0 ? id.slice(colon + 1) : id
}

/**
 * Compute layout: returns a Map<nodeId, {x, y, tier}> and an array of tier bands.
 * @param {object[]} nodes
 */
function computeLayout(nodes) {
  // Group nodes by tier
  /** @type {Map<string, object[]>} */
  const byTier = new Map()
  for (const t of TIER_ORDER) byTier.set(t, [])
  const unknownTier = []
  for (const n of nodes) {
    const t = String(n.type ?? '')
    if (byTier.has(t)) {
      byTier.get(t).push(n)
    } else {
      unknownTier.push(n)
    }
  }
  // Assign tiers (unknown types go at bottom)
  if (unknownTier.length) {
    byTier.set('unknown', unknownTier)
  }

  // Compute tier y positions
  const tierBands = []  // { tier, label, y, nodes }
  let y = PAD_TOP
  const activeTiers = TIER_ORDER.filter((t) => (byTier.get(t)?.length ?? 0) > 0)

  for (const tier of activeTiers) {
    const tierNodes = byTier.get(tier) ?? []
    tierBands.push({ tier, label: TIER_LABELS[tier] ?? tier, y, nodes: tierNodes })
    y += TIER_H
  }
  const svgH = y + PAD_TOP

  // Compute node positions within each tier
  /** @type {Map<string, {x: number, y: number, tier: string}>} */
  const positions = new Map()
  for (const band of tierBands) {
    const count = band.nodes.length
    if (count === 0) continue
    const usableW = SVG_W - 2 * PAD_X
    const spacing = count === 1 ? 0 : usableW / (count - 1)
    const startX = count === 1 ? SVG_W / 2 : PAD_X

    for (let i = 0; i < count; i++) {
      const n = band.nodes[i]
      const x = count === 1 ? startX : startX + i * spacing
      const nodeY = band.y + TIER_H / 2
      positions.set(String(n.id), { x, y: nodeY, tier: band.tier })
    }
  }

  return { positions, tierBands, svgH }
}

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------

function renderSvg(nodes, edges, positions, tierBands, svgH) {
  const lines = []
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${svgH}" width="${SVG_W}" height="${svgH}" role="img" aria-label="Traceability chain">`)
  lines.push(`  <defs>`)
  // Hatch pattern for stale edges (background texture)
  lines.push(`    <pattern id="stale-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">`)
  lines.push(`      <line x1="0" y1="0" x2="0" y2="6" stroke="#ef4444" stroke-width="2"/>`)
  lines.push(`    </pattern>`)
  lines.push(`  </defs>`)

  // ── Tier swimlane bands ────────────────────────────────────────────────
  for (let i = 0; i < tierBands.length; i++) {
    const band = tierBands[i]
    const fill = i % 2 === 0 ? 'var(--band-even)' : 'var(--band-odd)'
    lines.push(`  <rect data-tier="${esc(band.tier)}" x="0" y="${band.y}" width="${SVG_W}" height="${TIER_H}" fill="${fill}" rx="0"/>`)
    lines.push(`  <text x="8" y="${band.y + 18}" font-size="11" fill="var(--tier-label)" font-family="system-ui,sans-serif" font-weight="600">${esc(band.label)}</text>`)
  }

  // ── Edges (drawn before nodes so nodes appear on top) ─────────────────
  for (const edge of edges) {
    const src = positions.get(String(edge.source))
    const tgt = positions.get(String(edge.target))
    if (!src || !tgt) continue

    const cls = String(edge.classification ?? 'unproven')
    const style = EDGE_STYLE[cls] ?? EDGE_STYLE.unproven
    const sx = src.x, sy = src.y
    const tx = tgt.x, ty = tgt.y

    // Cubic bezier with vertical tangents — S-curve between tiers
    const midy = (sy + ty) / 2
    const pathD = `M ${sx},${sy} C ${sx},${midy} ${tx},${midy} ${tx},${ty}`

    const dashAttr = style.dasharray ? ` stroke-dasharray="${style.dasharray}"` : ''
    lines.push(
      `  <path class="edge edge-${esc(cls)}" data-classification="${esc(cls)}" ` +
      `data-kind="${esc(edge.kind)}" ` +
      `d="${pathD}" fill="none" stroke="${style.stroke}"${dashAttr} ` +
      `stroke-width="${style.width}" opacity="${style.opacity}">` +
      `<title>${esc(edge.kind)}: ${esc(edge.source)} → ${esc(edge.target)} [${esc(cls)}]</title>` +
      `</path>`,
    )
  }

  // ── Nodes ──────────────────────────────────────────────────────────────
  for (const node of nodes) {
    const pos = positions.get(String(node.id))
    if (!pos) continue
    const x = pos.x - NODE_W / 2
    const y = pos.y - NODE_H / 2
    const label = shortLabel(node)
    const nodeType = String(node.type ?? 'unknown')

    lines.push(
      `  <g class="node node-${esc(nodeType)}" data-type="${esc(nodeType)}" ` +
      `data-id="${esc(String(node.id))}">` +
      `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="6" ` +
      `fill="var(--node-fill)" stroke="var(--node-stroke-${esc(nodeType.replace('-', '_'))})" stroke-width="1.5"/>` +
      `<text x="${pos.x}" y="${pos.y + 4}" text-anchor="middle" font-size="11" font-family="system-ui,sans-serif" ` +
      `fill="var(--node-text)" clip-path="url(#clip-${esc(String(node.id).replace(/[^a-z0-9]/gi, '_'))})">${esc(label.length > 18 ? label.slice(0, 17) + '…' : label)}</text>` +
      `<title>${esc(nodeType)}: ${esc(String(node.id))}</title>` +
      `</g>`,
    )
  }

  lines.push(`</svg>`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Needs-You list
// ---------------------------------------------------------------------------

function renderNeedsYou(edges, nodes) {
  const needsYouClasses = new Set(['unproven', 'stale', 'missing'])
  const nodeById = new Map(nodes.map((n) => [String(n.id), n]))
  const items = edges.filter((e) => needsYouClasses.has(e.classification))

  if (items.length === 0) {
    return `<section class="needs-you">
<h2>Needs You</h2>
<p class="all-good">All traceability links are proven. No action required.</p>
</section>`
  }

  const rows = items.map((e) => {
    const srcNode = nodeById.get(String(e.source))
    const tgtNode = nodeById.get(String(e.target))
    const srcLabel = srcNode ? shortLabel(srcNode) : esc(String(e.source))
    const tgtLabel = tgtNode ? shortLabel(tgtNode) : esc(String(e.target))
    const cls = String(e.classification)
    return `  <li class="needs-item needs-${esc(cls)}">` +
      `<span class="badge-cls badge-${esc(cls)}">${esc(cls)}</span> ` +
      `<span class="edge-kind">${esc(e.kind)}</span> ` +
      `<span class="node-ref">${esc(srcLabel)}</span>` +
      ` → ` +
      `<span class="node-ref">${esc(tgtLabel)}</span>` +
      `</li>`
  })

  return `<section class="needs-you">
<h2>Needs You <span class="count">(${items.length})</span></h2>
<ul class="needs-list">
${rows.join('\n')}
</ul>
</section>`
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function renderLegend() {
  const items = [
    { cls: 'proven',   label: 'Proven — APPROVE gate or passing verify with fresh evidence', stroke: '#22c55e', dash: null },
    { cls: 'unproven', label: 'Unproven — no recorded verdict yet',                         stroke: '#d97706', dash: '5,4' },
    { cls: 'stale',    label: 'Stale — evidence build-hash mismatch (regen detected)',       stroke: '#ef4444', dash: '8,3,2,3' },
    { cls: 'missing',  label: 'Missing — required link absent (spec-req with no slice)',     stroke: '#dc2626', dash: '3,5' },
  ]

  const swatches = items.map((item) => {
    const svgLine = item.dash
      ? `<line x1="0" y1="8" x2="40" y2="8" stroke="${item.stroke}" stroke-width="2" stroke-dasharray="${item.dash}"/>`
      : `<line x1="0" y1="8" x2="40" y2="8" stroke="${item.stroke}" stroke-width="2"/>`
    return `<div class="legend-item">
  <svg width="40" height="16" viewBox="0 0 40 16" aria-hidden="true">${svgLine}</svg>
  <span>${esc(item.label)}</span>
</div>`
  }).join('\n')

  return `<section class="legend">
<h3>Legend</h3>
${swatches}
</section>`
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #ffffff;
  --surface: #f8fafc;
  --border: #e2e8f0;
  --text: #1e293b;
  --text-muted: #64748b;
  --tier-label: #475569;
  --band-even: rgba(241,245,249,0.8);
  --band-odd: rgba(248,250,252,0.6);
  --node-fill: #ffffff;
  --node-text: #1e293b;
  --node-stroke-objective: #6366f1;
  --node-stroke-spec_requirement: #8b5cf6;
  --node-stroke-slice: #3b82f6;
  --node-stroke-self_test: #06b6d4;
  --node-stroke-live_verify: #10b981;
  --node-stroke-gate: #f59e0b;
  --node-stroke-artifact_evidence: #94a3b8;
  --accent: #6366f1;
  --needs-bg: #fff7ed;
  --needs-border: #fed7aa;
  --proven-bg: #f0fdf4;
  --proven-border: #86efac;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f172a;
    --surface: #1e293b;
    --border: #334155;
    --text: #f1f5f9;
    --text-muted: #94a3b8;
    --tier-label: #94a3b8;
    --band-even: rgba(30,41,59,0.8);
    --band-odd: rgba(15,23,42,0.6);
    --node-fill: #1e293b;
    --node-text: #f1f5f9;
    --needs-bg: #1c1007;
    --needs-border: #92400e;
    --proven-bg: #052e16;
    --proven-border: #166534;
  }
}
:root[data-theme="dark"] {
  --bg: #0f172a;
  --surface: #1e293b;
  --border: #334155;
  --text: #f1f5f9;
  --text-muted: #94a3b8;
  --tier-label: #94a3b8;
  --band-even: rgba(30,41,59,0.8);
  --band-odd: rgba(15,23,42,0.6);
  --node-fill: #1e293b;
  --node-text: #f1f5f9;
  --needs-bg: #1c1007;
  --needs-border: #92400e;
  --proven-bg: #052e16;
  --proven-border: #166534;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  padding: 24px;
}

h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 4px; }
h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 12px; }
h3 { font-size: 0.9rem; font-weight: 600; margin-bottom: 8px; }

.subtitle { color: var(--text-muted); margin-bottom: 20px; font-size: 0.85rem; }

.chart-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  margin-bottom: 24px;
  padding: 8px;
}

.legend {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 14px 18px;
  margin-bottom: 24px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
}

.legend h3 { width: 100%; margin-bottom: 4px; }

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.needs-you {
  border: 1px solid var(--needs-border);
  border-radius: 8px;
  background: var(--needs-bg);
  padding: 16px 20px;
  margin-bottom: 24px;
}

.needs-you.all-proven {
  border-color: var(--proven-border);
  background: var(--proven-bg);
}

.count {
  font-weight: 400;
  color: var(--text-muted);
  font-size: 0.9em;
}

.all-good { color: #16a34a; font-weight: 500; }

.needs-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }

.needs-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  padding: 5px 10px;
  border-radius: 5px;
  background: rgba(0,0,0,0.04);
}

.badge-cls {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  min-width: 64px;
  text-align: center;
}

.badge-unproven { background: #fef3c7; color: #92400e; }
.badge-stale    { background: #fee2e2; color: #991b1b; }
.badge-missing  { background: #fce7f3; color: #9d174d; }

.edge-kind {
  font-family: 'Menlo', 'Courier New', monospace;
  font-size: 0.75rem;
  color: var(--text-muted);
  background: rgba(0,0,0,0.06);
  padding: 1px 5px;
  border-radius: 3px;
}

.node-ref {
  font-family: 'Menlo', 'Courier New', monospace;
  font-size: 0.8rem;
}

.stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 24px;
}

.stat-card {
  flex: 1;
  min-width: 100px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 10px 14px;
  text-align: center;
}

.stat-card .num { font-size: 1.6rem; font-weight: 700; }
.stat-card .lbl { font-size: 0.75rem; color: var(--text-muted); }
.stat-proven  .num { color: #22c55e; }
.stat-unproven .num { color: #d97706; }
.stat-stale   .num { color: #ef4444; }
.stat-missing .num { color: #dc2626; }
`

// ---------------------------------------------------------------------------
// Public: pure renderer
// ---------------------------------------------------------------------------

/**
 * Render a self-contained HTML string from a classified traceability graph.
 *
 * Pure function — no I/O. Same inputs always yield the same output.
 *
 * @param {{ nodes: object[], edges: object[], artifactEvidence?: object[] }} classifiedGraph
 *   The graph returned by classifyTraceabilityGraph().
 * @param {string} [slug]
 *   Motive slug — used only for the page title.
 * @returns {string} Self-contained HTML (no external URLs).
 */
export function renderTraceHtml(classifiedGraph, slug = '') {
  const nodes = Array.isArray(classifiedGraph?.nodes) ? classifiedGraph.nodes : []
  const edges = Array.isArray(classifiedGraph?.edges) ? classifiedGraph.edges : []

  const { positions, tierBands, svgH } = computeLayout(nodes)
  const svgMarkup = renderSvg(nodes, edges, positions, tierBands, svgH)
  const needsYou = renderNeedsYou(edges, nodes)
  const legend = renderLegend()

  // ── Coverage stats ────────────────────────────────────────────────────
  const counts = { proven: 0, unproven: 0, stale: 0, missing: 0 }
  for (const e of edges) {
    const c = e.classification
    if (c in counts) counts[c]++
  }
  const total = edges.length
  const pct = total > 0 ? Math.round((counts.proven / total) * 100) : 0

  const statsHtml = `<div class="stat-row">
  <div class="stat-card stat-proven"><div class="num">${counts.proven}</div><div class="lbl">proven</div></div>
  <div class="stat-card stat-unproven"><div class="num">${counts.unproven}</div><div class="lbl">unproven</div></div>
  <div class="stat-card stat-stale"><div class="num">${counts.stale}</div><div class="lbl">stale</div></div>
  <div class="stat-card stat-missing"><div class="num">${counts.missing}</div><div class="lbl">missing</div></div>
  <div class="stat-card"><div class="num">${pct}%</div><div class="lbl">coverage</div></div>
</div>`

  const titleSlug = slug ? ` — ${slug}` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Traceability${titleSlug}</title>
<style>${CSS}</style>
</head>
<body>
<h1>Traceability Chain${titleSlug}</h1>
<p class="subtitle">${nodes.length} nodes &middot; ${edges.length} edges &middot; ${tierBands.length} active tiers</p>
${statsHtml}
${legend}
<div class="chart-wrap">
${svgMarkup}
</div>
${needsYou}
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Public: ambient regenerator (reads store, writes file)
// ---------------------------------------------------------------------------

/**
 * Regenerate TRACE.html for a given motive.
 *
 * Silent no-op when the motive directory doesn't exist.
 * Warns to stderr on any error — never throws, never changes the caller's exit code.
 *
 * @param {string} projectDir - Absolute path, same as CLAUDE_PROJECT_DIR.
 * @param {string} slug       - Motive slug (e.g. "tracking-viz").
 */
export function regenerateMotiveTraceHtml(projectDir, slug) {
  if (!projectDir || !slug) return
  // _generate uses a dynamic import for NativeSpineAdapter to avoid surfacing
  // a broken static-import chain in traceability-adapter.mjs at ledger module-load time.
  // The returned promise is fire-and-forget; errors are reported to stderr only.
  _generate(projectDir, slug).catch((err) => {
    process.stderr.write(
      `[traceability-ambient] warn: failed to regenerate TRACE.html for "${slug}": ${err?.message ?? err}\n`,
    )
  })
}

async function _generate(projectDir, slug) {
  const motiveDir = join(projectDir, '.groundwork', 'motives', slug)
  if (!existsSync(motiveDir)) return  // no charter directory yet — skip silently

  // Dynamic import isolates the traceability-adapter.mjs broken-chain from ledger's module graph.
  const { NativeSpineAdapter } = await import('./traceability-adapter.mjs')
  const adapter = new NativeSpineAdapter({ projectDir, slug })
  const graph = buildTraceabilityGraph(adapter)
  // Pass empty stampedRefs — evidence wiring is S4's concern; ambient regen uses basic pipeline.
  const classified = classifyTraceabilityGraph(graph, [])

  const html = renderTraceHtml(classified, slug)

  const outPath = join(motiveDir, 'TRACE.html')
  writeFileSync(outPath, html, 'utf8')
}
