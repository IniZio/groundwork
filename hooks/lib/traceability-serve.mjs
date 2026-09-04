#!/usr/bin/env node
/**
 * traceability-serve.mjs — S6/S7 of motive tracking-viz (AC-1, AC-2, AC-3, AC-5, D-2, D-3, D-6, D-8, D-9)
 *
 * CLI: node hooks/lib/traceability-serve.mjs <slug> [--port N]
 *
 * Starts a LOCAL HTTP server (Node built-in http only) serving:
 *   GET /        → self-contained interactive HTML (pan/zoom, hover, expand, Needs-You sidebar)
 *   GET /graph   → classified graph JSON (nodes + edges with classification field)
 *   POST /rejudge → S7: explicit on-demand re-judge for a single link (D-8, AC-5)
 *                  Body: { link_id: string, verdict?: string, which?: string }
 *                  Appends a scoped GATE event keyed by D-8 link_id and rebuilds graph.
 *                  MUST NOT be called by buildClassifiedGraph or any regen-hot-path code.
 *
 * Approach — no build chain (D-2, D-6):
 *   All HTML, CSS, and JavaScript are inlined into a single response. The graph
 *   is rendered using SVG with a vanilla-JS force simulation for layout and
 *   pointer events for pan/zoom/hover. No React, no bundler, no npm UI deps are
 *   added — the only imports here are Node built-ins and the existing pipeline modules.
 *
 * Exit codes: 0 success · 1 operational failure · 2 usage error
 */

import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { NativeSpineAdapter } from './traceability-adapter.mjs'
import { buildTraceabilityGraph } from './traceability-join.mjs'
import { classifyTraceabilityGraph } from './traceability-classify.mjs'
import { readEvidence, markStaleness } from './traceability-evidence.mjs'
import { appendEvent, resolveShardPath } from './journal-io.mjs'
import { topoLayers, frontier, transitiveBlockers, hasCycle } from './dag-utils.mjs'

// ---------------------------------------------------------------------------
// V4 — Wave-band computation (shared semantics; consumed by /graph JSON + HTML)
// ---------------------------------------------------------------------------

/**
 * Compute wave-band assignments, frontier set, and transitive blocker maps
 * for a set of slices. Uses dag-utils for all graph operations — never
 * reimplements them. Both the JSON surface and the HTML surface call this
 * function so they are guaranteed to agree on every result.
 *
 * @param {import('./lib/dag-utils.mjs').DagSlice[]} slices
 * @returns {{
 *   waveBySliceId: Map<string, number|null>,
 *   frontierIds: Set<string>,
 *   blockersBySliceId: Map<string, string[]>,
 * }}
 */
export function computeWaveBands(slices) {
  // Guard cycles — hasCycle() returns true when present; topoLayers() still
  // runs but cycle members get no layer assignment.
  const cyclePresent = hasCycle(slices)
  const layers = topoLayers(slices) // string[][]

  // Build topoDepth map: sliceId → layer index
  const topoDepth = new Map()
  layers.forEach((layer, depth) => {
    layer.forEach((id) => topoDepth.set(id, depth))
  })

  // Wave band: prefer explicit ledger `wave` (non-null), fall back to topo depth.
  // Cycle members (no topo layer) get null — layout must handle gracefully.
  const waveBySliceId = new Map()
  for (const slice of slices) {
    const explicit = slice.wave != null ? slice.wave : null
    if (explicit !== null) {
      waveBySliceId.set(slice.id, explicit)
    } else if (topoDepth.has(slice.id)) {
      waveBySliceId.set(slice.id, topoDepth.get(slice.id))
    } else {
      // Cycle member — assign null so layout can skip or clamp
      waveBySliceId.set(slice.id, cyclePresent ? null : 0)
    }
  }

  // Frontier: pending slices with all blockers complete
  const frontierSlices = frontier(slices)
  const frontierIds = new Set(frontierSlices.map((s) => s.id))

  // Transitive blockers for each slice
  const blockersBySliceId = new Map()
  for (const slice of slices) {
    blockersBySliceId.set(slice.id, transitiveBlockers(slices, slice.id))
  }

  return { waveBySliceId, frontierIds, blockersBySliceId }
}

// ---------------------------------------------------------------------------
// Pipeline assembly
// ---------------------------------------------------------------------------

/**
 * Load motive data and run the full classify pipeline.
 * Augments each slice node with wave-band data: waveBand, isFrontier,
 * transitiveBlockers. These fields drive both the /graph JSON response and
 * the interactive HTML layout — computed once here, never re-derived.
 *
 * @param {string} slug        - Motive slug
 * @param {string} projectDir  - Absolute project root
 * @returns {{ nodes: object[], edges: object[], artifactEvidence: object[], slug: string }}
 */
export function buildClassifiedGraph(slug, projectDir) {
  const adapter = new NativeSpineAdapter({ projectDir, slug })
  const slices = adapter.getSlices()
  const baseGraph = buildTraceabilityGraph(adapter)

  // Load stamped evidence refs and mark staleness
  const rawRefs = readEvidence(slug, { groundworkDir: path.join(projectDir, '.groundwork') })
  const stampedRefs = markStaleness(rawRefs, null) // null = no current hash → all stale-check deferred

  const classified = classifyTraceabilityGraph(baseGraph, stampedRefs)

  // Augment slice nodes with wave-band data (V4)
  const { waveBySliceId, frontierIds, blockersBySliceId } = computeWaveBands(slices)
  const nodes = classified.nodes.map((node) => {
    if (node.type !== 'slice') return node
    const sid = /** @type {string} */ (node.sliceId)
    return {
      ...node,
      waveBand: waveBySliceId.has(sid) ? waveBySliceId.get(sid) : null,
      isFrontier: frontierIds.has(sid),
      transitiveBlockers: blockersBySliceId.get(sid) ?? [],
    }
  })

  return { ...classified, nodes, slug }
}

// ---------------------------------------------------------------------------
// S7 — On-demand single-link re-judge (D-3, D-8, AC-5)
// ---------------------------------------------------------------------------

/**
 * Append a scoped GATE verdict event for a single link (S7, D-8, AC-5).
 *
 * This function is an EXPLICIT on-demand action invoked only from the
 * POST /rejudge handler. It MUST NOT be called by buildClassifiedGraph or
 * any regen-hot-path function — that separation is the load-bearing invariant
 * for D-3 (classification never recomputed in the hot path).
 *
 * The event is keyed by the D-8 `link_id` field so the classifier can scope
 * the verdict to a single link when the graph is rebuilt.
 *
 * @param {string} linkId      - D-8 link identifier (typically a slice ID)
 * @param {string} verdict     - 'APPROVE' | 'CORRECTION' | 'REPLAN' | 'STOP'
 * @param {string} which       - Gate name stored as GATE.which (e.g. 'manual-rejudge')
 * @param {string} projectDir  - Absolute project root
 * @param {string} slug        - Motive slug
 */
export function rejudgeLink(linkId, verdict, which, projectDir, slug) {
  const ts = new Date().toISOString()
  const shardPath = resolveShardPath(projectDir, 'traceability-serve', ts.slice(0, 10))
  const event = {
    ts,
    session: 'traceability-serve',
    motive: slug,
    type: 'GATE',
    msg: `re-judge link ${linkId}: ${verdict}`,
    source: 'traceability-serve:rejudge',
    data: {
      which,
      verdict,
      link_id: linkId,
    },
  }
  appendEvent(shardPath, event)
}

// ---------------------------------------------------------------------------
// HTML page builder
// ---------------------------------------------------------------------------

/**
 * Build a self-contained interactive HTML page for the classified graph.
 * All CSS and JS are inlined; no external URLs are referenced.
 *
 * @param {{ nodes: object[], edges: object[], slug: string }} graph
 * @returns {string}
 */
export function buildHtml(graph) {
  const slug = graph.slug ?? 'motive'
  // Escape </script> sequences that could break the embedded JSON
  const graphJson = JSON.stringify(graph).replace(/<\/script/gi, '<\\/script')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Traceability — ${slug}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif;font-size:13px}
#app{display:flex;height:100vh}
/* Sidebar */
#sidebar{width:268px;flex-shrink:0;background:#1e293b;border-right:1px solid #334155;display:flex;flex-direction:column;overflow:hidden}
#sidebar-header{padding:12px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;border-bottom:1px solid #334155;flex-shrink:0}
#needs-list{flex:1;overflow-y:auto;list-style:none;padding:4px 0}
.needs-item{padding:8px 14px;border-bottom:1px solid rgba(51,65,85,.5);cursor:pointer;transition:background .1s}
.needs-item:hover{background:#0f172a}
.needs-item .ni-label{color:#f1f5f9;font-weight:500;font-size:12px;margin-bottom:2px}
.needs-item .ni-kind{color:#64748b;font-size:11px}
.needs-item .ni-tag{display:inline-block;padding:1px 7px;border-radius:3px;font-size:10px;margin-top:3px;font-weight:600}
.tag-unproven{background:#92400e;color:#fde68a}
.tag-stale{background:#7c2d12;color:#fed7aa}
.tag-missing{background:#4c0519;color:#fda4af}
.all-proven{padding:16px;color:#22c55e;font-size:12px;font-style:italic}
/* Canvas */
#canvas{flex:1;position:relative;overflow:hidden}
#graph-svg{width:100%;height:100%;cursor:grab;display:block}
#graph-svg.dragging{cursor:grabbing}
/* Tier separators (background) */
.tier-sep{stroke:#1e293b;stroke-width:1}
.tier-lbl{fill:#334155;font-size:10px;font-style:italic;dominant-baseline:hanging}
/* Wave-band sub-separators within slice tier */
.wave-sep{stroke:#1e3a5f;stroke-width:1;stroke-dasharray:4,4}
.wave-lbl{fill:#1e3a5f;font-size:9px;font-style:italic;dominant-baseline:hanging}
/* Frontier node ring */
.n-frontier .n-circle{stroke:#10b981 !important;stroke-width:3 !important;stroke-dasharray:6,2}
/* Edges */
.e-line{fill:none;stroke-width:1.5}
.ec-proven{stroke:#22c55e}
.ec-unproven{stroke:#f59e0b;stroke-dasharray:5,3}
.ec-stale{stroke:#ef4444;stroke-dasharray:3,2}
.ec-missing{stroke:#7f1d1d;stroke-dasharray:2,2}
/* Nodes */
.n-grp{cursor:pointer}
.n-circle{stroke-width:2;transition:filter .12s}
.n-grp:hover .n-circle{filter:brightness(1.35) drop-shadow(0 0 4px currentColor)}
.n-lbl{font-size:9px;fill:#cbd5e1;text-anchor:middle;dominant-baseline:hanging;pointer-events:none;user-select:none}
/* Popover */
#popover{position:fixed;background:#1e293b;border:1px solid #475569;border-radius:8px;padding:12px 16px;max-width:290px;font-size:12px;pointer-events:none;display:none;z-index:100;box-shadow:0 8px 32px rgba(0,0,0,.6)}
#popover h3{font-size:13px;font-weight:600;color:#f8fafc;margin-bottom:4px}
#popover .p-type{font-size:10px;color:#64748b;margin-bottom:6px}
.p-badge{display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:600;margin-bottom:8px}
.pb-proven{background:#14532d;color:#86efac}
.pb-unproven{background:#78350f;color:#fde68a}
.pb-stale{background:#7c2d12;color:#fed7aa}
.pb-missing{background:#4c0519;color:#fda4af}
#popover .p-ev{margin-top:8px;padding-top:8px;border-top:1px solid #334155;font-size:11px}
#popover .p-ev-title{color:#94a3b8;margin-bottom:4px}
.p-ev-path{color:#7dd3fc;word-break:break-all;display:block;margin:2px 0}
.p-ev-none{color:#475569;font-style:italic}
/* Re-judge button (S7) */
.rj-btn{margin-top:6px;padding:3px 10px;background:#1e3a5f;border:1px solid #3b82f6;border-radius:4px;color:#93c5fd;font-size:10px;cursor:pointer;font-family:inherit;width:100%}
.rj-btn:hover{background:#1d4ed8;color:#fff}
.rj-btn:disabled{opacity:.4;cursor:not-allowed}
/* Wave / frontier / blocker info in popover */
.p-wave{margin-top:4px;font-size:10px;color:#7dd3fc}
.p-frontier{margin-top:4px;font-size:10px;color:#10b981;font-weight:600}
.p-blockers{margin-top:4px;font-size:10px;color:#f87171;word-break:break-all}
</style>
</head>
<body>
<div id="app">
  <aside id="sidebar">
    <div id="sidebar-header">Needs You</div>
    <ul id="needs-list"></ul>
  </aside>
  <div id="canvas">
    <svg id="graph-svg">
      <defs>
        <marker id="mk-proven" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#22c55e"/></marker>
        <marker id="mk-unproven" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#f59e0b"/></marker>
        <marker id="mk-stale" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#ef4444"/></marker>
        <marker id="mk-missing" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#7f1d1d"/></marker>
      </defs>
      <g id="bg-layer"></g>
      <g id="scene">
        <g id="edge-layer"></g>
        <g id="node-layer"></g>
      </g>
    </svg>
    <div id="popover"></div>
  </div>
</div>
<script>
(function () {
'use strict';

// ── S7: On-demand single-link re-judge ────────────────────────────────────
/**
 * Send POST /rejudge for the given link_id and reload on success.
 * This is ONLY called from an explicit user action (button click) — never
 * from the graph render or regen path.
 *
 * @param {string} linkId   - D-8 link identifier (typically a slice ID)
 * @param {string} [verdict] - Gate verdict (default: 'APPROVE')
 */
function rejudge(linkId, verdict) {
  fetch('/rejudge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ link_id: linkId, verdict: verdict || 'APPROVE' })
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (data.ok) { window.location.reload(); }
    else { alert('Re-judge failed: ' + (data.error || 'unknown error')); }
  }).catch(function (err) { alert('Re-judge error: ' + String(err)); });
}

/**
 * Extract a D-8 link_id from an edge (prefer slice source, then slice target).
 * Returns null when neither endpoint is a slice and no fallback is applicable.
 *
 * @param {{ source: string, target: string, kind: string }} edge
 * @param {{ id: string, type: string, sliceId?: string }[]} nodes
 * @returns {string|null}
 */
function edgeLinkId(edge, nodes) {
  var nodeById = {};
  nodes.forEach(function (n) { nodeById[n.id] = n; });
  var src = nodeById[edge.source];
  var tgt = nodeById[edge.target];
  if (src && src.type === 'slice' && src.sliceId) return src.sliceId;
  if (tgt && tgt.type === 'slice' && tgt.sliceId) return tgt.sliceId;
  // Fallback: use the raw source id (the GATE event classifier accepts any string)
  return edge.source || null;
}

// ── Embedded graph data ────────────────────────────────────────────────────
var G = ${graphJson};

// ── Node type → layout tier (0 = top, 5 = bottom) ─────────────────────────
var TIER_MAP = {
  'objective': 0,
  'decision': 1,
  'acceptance-criterion': 2, 'open-item': 2, 'ticket': 2,
  'slice': 3, 'spec-requirement': 3,
  'self-test': 4, 'live-verify': 4, 'gate': 4,
  'artifact-evidence': 5
};

var TIER_LABELS = [
  'Tier 1 — Objective',
  'Tier 2 — Decisions',
  'Tier 3 — Criteria / Items',
  'Tier 4 — Slices / Specs',
  'Tier 5 — Tests / Gates',
  'Tier 6 — Evidence'
];

var NUM_TIERS = 6;

// ── V4: Wave-band layout for slice nodes ──────────────────────────────────────
// Compute the number of distinct wave bands present in the graph data.
var maxWaveBand = -1;
G.nodes.forEach(function (n) {
  if (n.type === 'slice' && n.waveBand != null && n.waveBand > maxWaveBand) {
    maxWaveBand = n.waveBand;
  }
});
var NUM_WAVE_BANDS = maxWaveBand >= 0 ? maxWaveBand + 1 : 1;

// ── Node type → fill color ──────────────────────────────────────────────────
var NODE_FILL = {
  'objective':              '#4c1d95',
  'decision':               '#1e3a5f',
  'acceptance-criterion':   '#064e3b',
  'open-item':              '#7f1d1d',
  'ticket':                 '#78350f',
  'slice':                  '#0c4a6e',
  'spec-requirement':       '#134e4a',
  'self-test':              '#312e81',
  'live-verify':            '#4a1d96',
  'gate':                   '#1c3557',
  'artifact-evidence':      '#1f2937'
};

// ── Classification stroke colors (for node ring and edge) ───────────────────
var CLASS_COLOR = {
  proven:   '#22c55e',
  unproven: '#f59e0b',
  stale:    '#ef4444',
  missing:  '#7f1d1d'
};

// ── SVG namespace helper ─────────────────────────────────────────────────────
var NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  var el = document.createElementNS(NS, tag);
  for (var k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// ── Canvas dimensions ────────────────────────────────────────────────────────
var svg = document.getElementById('graph-svg');
var W = svg.clientWidth || (window.innerWidth - 268);
var H = svg.clientHeight || window.innerHeight;
var TIER_H = H / NUM_TIERS;

// ── Build initial node positions ─────────────────────────────────────────────
// Slice nodes are grouped by wave band; other nodes by tier.
var SLICE_TIER_TOP = TIER_MAP['slice'] * TIER_H;
var WAVE_BAND_H = TIER_H / NUM_WAVE_BANDS;

function nodeTargetY(type, waveBand) {
  var t = TIER_MAP[type] != null ? TIER_MAP[type] : 2;
  if (type === 'slice' && waveBand != null) {
    return SLICE_TIER_TOP + (waveBand + 0.5) * WAVE_BAND_H;
  }
  return (t + 0.5) * TIER_H;
}

// Count nodes per tier/wave-band for horizontal spacing
var tierCount = {};
var waveBandCount = {};
G.nodes.forEach(function (n) {
  if (n.type === 'slice') {
    var wb = n.waveBand != null ? n.waveBand : 0;
    waveBandCount[wb] = (waveBandCount[wb] || 0) + 1;
  } else {
    var t = TIER_MAP[n.type] != null ? TIER_MAP[n.type] : 2;
    tierCount[t] = (tierCount[t] || 0) + 1;
  }
});

var tierIdx = {};
var waveBandIdx = {};
var simNodes = G.nodes.map(function (n) {
  var idx, total;
  if (n.type === 'slice') {
    var wb = n.waveBand != null ? n.waveBand : 0;
    idx = waveBandIdx[wb] || 0;
    waveBandIdx[wb] = idx + 1;
    total = waveBandCount[wb] || 1;
  } else {
    var t = TIER_MAP[n.type] != null ? TIER_MAP[n.type] : 2;
    idx = tierIdx[t] || 0;
    tierIdx[t] = idx + 1;
    total = tierCount[t] || 1;
  }
  var r = n.type === 'objective' ? 22 : (n.type === 'slice' || n.type === 'spec-requirement') ? 16 : 12;
  return {
    id: n.id,
    type: n.type,
    label: n.label || n.id,
    waveBand: n.waveBand != null ? n.waveBand : null,
    isFrontier: n.isFrontier || false,
    transitiveBlockers: n.transitiveBlockers || [],
    x: (idx + 1) * W / (total + 1),
    y: nodeTargetY(n.type, n.waveBand),
    vx: 0, vy: 0,
    r: r,
    ref: n  // original node data
  };
});

var nodeMap = {};
simNodes.forEach(function (n) { nodeMap[n.id] = n; });

var simEdges = G.edges.map(function (e) {
  return {
    source: e.source,
    target: e.target,
    kind: e.kind,
    classification: e.classification || 'unproven',
    src: nodeMap[e.source],
    tgt: nodeMap[e.target]
  };
}).filter(function (e) { return e.src && e.tgt; });

// ── Force simulation (runs synchronously before first render) ─────────────────
function nodeY(type) {
  var t = TIER_MAP[type] != null ? TIER_MAP[type] : 2;
  return (t + 0.5) * TIER_H;
}

(function simulate(steps) {
  for (var s = 0; s < steps; s++) {
    var alpha = Math.pow(0.985, s);

    // Repulsion between nodes
    for (var i = 0; i < simNodes.length; i++) {
      for (var j = i + 1; j < simNodes.length; j++) {
        var a = simNodes[i], b = simNodes[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var d2 = dx * dx + dy * dy + 1;
        var d = Math.sqrt(d2);
        var f = 4000 / d2 * alpha;
        var fx = dx / d * f, fy = dy / d * f;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // Spring attraction along edges
    simEdges.forEach(function (e) {
      var a = e.src, b = e.tgt;
      var dx = b.x - a.x, dy = b.y - a.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var target = 110;
      var f = (d - target) * 0.04 * alpha;
      var fx = dx / d * f, fy = dy / d * f;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    });

    // Band gravity — pull each node toward its tier/wave-band Y
    simNodes.forEach(function (n) {
      var ty = nodeTargetY(n.type, n.waveBand);
      n.vy += (ty - n.y) * 0.18 * alpha;
      // Weak horizontal centering
      n.vx += (W / 2 - n.x) * 0.004 * alpha;
    });

    // Integrate + dampen + clamp
    simNodes.forEach(function (n) {
      n.x += n.vx; n.y += n.vy;
      n.vx *= 0.65; n.vy *= 0.65;
      n.x = Math.max(n.r + 6, Math.min(W - n.r - 6, n.x));
      n.y = Math.max(n.r + 6, Math.min(H - n.r - 6, n.y));
    });
  }
}(400));

// ── Pan / zoom state ──────────────────────────────────────────────────────────
var tx = 0, ty = 0, scale = 1;
var scene = document.getElementById('scene');

function applyTransform() {
  scene.setAttribute('transform',
    'translate(' + tx + ',' + ty + ') scale(' + scale + ')');
}
applyTransform();

// ── Background tier bands ─────────────────────────────────────────────────────
var bgLayer = document.getElementById('bg-layer');
for (var ti = 0; ti < NUM_TIERS; ti++) {
  var bandY = ti * TIER_H;
  var lbl = svgEl('text', {
    x: 6, y: bandY + 4,
    'class': 'tier-lbl'
  });
  lbl.textContent = TIER_LABELS[ti];
  bgLayer.appendChild(lbl);

  if (ti > 0) {
    var sep = svgEl('line', {
      x1: 0, y1: bandY, x2: W, y2: bandY,
      'class': 'tier-sep'
    });
    bgLayer.appendChild(sep);
  }
}

// ── V4: Wave-band sub-separators within the slice tier ────────────────────────
var SLICE_TIER_INDEX = TIER_MAP['slice']; // 3
for (var wb = 0; wb < NUM_WAVE_BANDS; wb++) {
  var wbY = SLICE_TIER_INDEX * TIER_H + wb * WAVE_BAND_H;
  if (wb > 0) {
    var wbSep = svgEl('line', { x1: 0, y1: wbY, x2: W, y2: wbY, 'class': 'wave-sep' });
    bgLayer.appendChild(wbSep);
  }
  var wbLbl = svgEl('text', { x: W - 70, y: wbY + 4, 'class': 'wave-lbl' });
  wbLbl.textContent = 'Wave ' + wb;
  bgLayer.appendChild(wbLbl);
}

// ── Compute per-node status from incoming classified edges ────────────────────
var nodeStatus = {};
simNodes.forEach(function (n) { nodeStatus[n.id] = 'unproven'; });
// "proven" seals edges on target → mark target proven
G.edges.forEach(function (e) {
  if (e.kind === 'seals' && e.classification === 'proven') {
    nodeStatus[e.target] = 'proven';
  }
});

// ── Build evidence map: nodeId → [filePaths] ──────────────────────────────────
var evidenceMap = {};
G.nodes.forEach(function (n) {
  if (n.type === 'artifact-evidence' && n.ref) {
    // Find all evidences edges from this node
    G.edges.forEach(function (e) {
      if (e.source === n.id && e.kind === 'evidences') {
        if (!evidenceMap[e.target]) evidenceMap[e.target] = [];
        evidenceMap[e.target].push(n.ref);
      }
    });
  }
});

// ── Render edges ──────────────────────────────────────────────────────────────
var edgeLayer = document.getElementById('edge-layer');
var edgeEls = []; // { edge, el }

simEdges.forEach(function (e) {
  var cls = e.classification || 'unproven';
  var a = e.src, b = e.tgt;
  var dx = b.x - a.x, dy = b.y - a.y;
  var d = Math.sqrt(dx * dx + dy * dy) || 1;
  var ex = b.x - dx / d * (b.r + 5);
  var ey = b.y - dy / d * (b.r + 5);

  var line = svgEl('line', {
    x1: a.x, y1: a.y, x2: ex, y2: ey,
    'class': 'e-line ec-' + cls,
    'marker-end': 'url(#mk-' + cls + ')'
  });
  edgeLayer.appendChild(line);
  edgeEls.push({ edge: e, el: line });
});

// ── Render nodes ──────────────────────────────────────────────────────────────
var nodeLayer = document.getElementById('node-layer');
var nodeEls = {}; // id → { grp, circle }

simNodes.forEach(function (n) {
  var status = nodeStatus[n.id] || 'unproven';
  var strokeColor = CLASS_COLOR[status] || '#475569';
  var fillColor = NODE_FILL[n.type] || '#1f2937';
  // V4: frontier nodes get a distinct class for CSS styling
  var grpClass = 'n-grp' + (n.isFrontier ? ' n-frontier' : '');

  var grp = svgEl('g', {
    'class': grpClass,
    'transform': 'translate(' + n.x + ',' + n.y + ')',
    'data-id': n.id,
    'data-wave': n.waveBand != null ? String(n.waveBand) : '',
    'data-frontier': n.isFrontier ? '1' : '0'
  });

  var circle = svgEl('circle', {
    r: n.r,
    fill: fillColor,
    stroke: strokeColor,
    'class': 'n-circle'
  });
  grp.appendChild(circle);

  // Short label below node
  var shortLabel = (n.label || n.id);
  if (shortLabel.length > 20) shortLabel = shortLabel.slice(0, 18) + '…';
  var lbl = svgEl('text', {
    'class': 'n-lbl',
    y: n.r + 3
  });
  lbl.textContent = shortLabel;
  grp.appendChild(lbl);

  nodeLayer.appendChild(grp);
  nodeEls[n.id] = { grp: grp, circle: circle, node: n };
});

// ── Popover ───────────────────────────────────────────────────────────────────
var popover = document.getElementById('popover');

function showPopover(n, screenX, screenY) {
  var status = nodeStatus[n.id] || 'unproven';
  var ev = evidenceMap[n.id] || [];
  var badgeText = status === 'proven' ? '✓ Verified'
    : status === 'stale' ? '⚠ Stale'
    : status === 'missing' ? '× Missing' : '? Unproven';

  var evHtml;
  if (ev.length > 0) {
    evHtml = '<div class="p-ev-title">Artifact evidence:</div>';
    ev.forEach(function (p) {
      evHtml += '<a class="p-ev-path">' + p + '</a>';
    });
  } else {
    evHtml = '<span class="p-ev-none">No artifact evidence recorded</span>';
  }

  // V4: wave-band, frontier, and blocked-chain info for slice nodes
  var waveHtml = '';
  if (n.type === 'slice') {
    if (n.waveBand != null) {
      waveHtml += '<div class="p-wave">Wave ' + n.waveBand + '</div>';
    }
    if (n.isFrontier) {
      waveHtml += '<div class="p-frontier">▶ Ready to start (frontier)</div>';
    }
    if (n.transitiveBlockers && n.transitiveBlockers.length > 0) {
      waveHtml += '<div class="p-blockers">Blocked by: ' + n.transitiveBlockers.join(', ') + '</div>';
    }
  }

  popover.innerHTML =
    '<h3>' + (n.label || n.id).slice(0, 50) + '</h3>' +
    '<div class="p-type">' + n.type + '</div>' +
    '<span class="p-badge pb-' + status + '">' + badgeText + '</span>' +
    waveHtml +
    '<div class="p-ev">' + evHtml + '</div>';

  var pw = 290, ph = 160;
  var px = Math.min(screenX + 12, window.innerWidth - pw - 8);
  var py = Math.min(screenY + 12, window.innerHeight - ph - 8);
  popover.style.left = px + 'px';
  popover.style.top = py + 'px';
  popover.style.display = 'block';
}

function hidePopover() { popover.style.display = 'none'; }

// Attach hover events
Object.keys(nodeEls).forEach(function (id) {
  var entry = nodeEls[id];
  var n = entry.node;

  entry.grp.addEventListener('mouseenter', function (ev) {
    // Convert SVG local coords to screen coords
    var rect = svg.getBoundingClientRect();
    var sx = n.x * scale + tx + rect.left;
    var sy = n.y * scale + ty + rect.top;
    showPopover(n, sx, sy);
  });
  entry.grp.addEventListener('mouseleave', hidePopover);

  // Click → highlight connected subgraph; click elsewhere to reset
  entry.grp.addEventListener('click', function (ev) {
    ev.stopPropagation();
    var connectedIds = {};
    connectedIds[id] = true;
    simEdges.forEach(function (e) {
      if (e.source === id || e.target === id) {
        connectedIds[e.source] = true;
        connectedIds[e.target] = true;
      }
    });
    Object.keys(nodeEls).forEach(function (nid) {
      nodeEls[nid].grp.style.opacity = connectedIds[nid] ? '1' : '0.2';
    });
    edgeEls.forEach(function (item) {
      var e = item.edge;
      item.el.style.opacity = (e.source === id || e.target === id) ? '1' : '0.1';
    });
  });
});

// Click on SVG background → reset opacity
svg.addEventListener('click', function () {
  Object.keys(nodeEls).forEach(function (id) {
    nodeEls[id].grp.style.opacity = '1';
  });
  edgeEls.forEach(function (item) { item.el.style.opacity = '1'; });
});

// ── Pan / zoom ────────────────────────────────────────────────────────────────
var dragging = false, mx0 = 0, my0 = 0, tx0 = 0, ty0 = 0;

svg.addEventListener('mousedown', function (ev) {
  if (ev.target.closest && ev.target.closest('.n-grp')) return;
  dragging = true; mx0 = ev.clientX; my0 = ev.clientY; tx0 = tx; ty0 = ty;
  svg.classList.add('dragging');
  ev.preventDefault();
});

window.addEventListener('mousemove', function (ev) {
  if (!dragging) return;
  tx = tx0 + (ev.clientX - mx0);
  ty = ty0 + (ev.clientY - my0);
  applyTransform();
});

window.addEventListener('mouseup', function () {
  dragging = false;
  svg.classList.remove('dragging');
});

svg.addEventListener('wheel', function (ev) {
  ev.preventDefault();
  var rect = svg.getBoundingClientRect();
  var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
  var factor = ev.deltaY < 0 ? 1.12 : 0.89;
  var ns = Math.max(0.15, Math.min(5, scale * factor));
  tx = mx - (mx - tx) * (ns / scale);
  ty = my - (my - ty) * (ns / scale);
  scale = ns;
  applyTransform();
}, { passive: false });

// ── Needs You sidebar ─────────────────────────────────────────────────────────
var needsList = document.getElementById('needs-list');
var nonProven = G.edges.filter(function (e) {
  return e.classification && e.classification !== 'proven';
});

if (nonProven.length === 0) {
  var allGood = document.createElement('li');
  allGood.className = 'all-proven';
  allGood.textContent = '✓ All links proven';
  needsList.appendChild(allGood);
} else {
  nonProven.forEach(function (e) {
    var srcNode = G.nodes.find(function (n) { return n.id === e.source; });
    var tgtNode = G.nodes.find(function (n) { return n.id === e.target; });
    var srcLbl = ((srcNode && srcNode.label) || e.source).slice(0, 24);
    var tgtLbl = ((tgtNode && tgtNode.label) || e.target).slice(0, 24);
    // S7: compute D-8 link_id for this edge so the button can scope the verdict
    var linkId = edgeLinkId(e, G.nodes);

    var li = document.createElement('li');
    li.className = 'needs-item';
    li.innerHTML =
      '<div class="ni-label">' + srcLbl + ' → ' + tgtLbl + '</div>' +
      '<div class="ni-kind">' + e.kind + '</div>' +
      '<span class="ni-tag tag-' + e.classification + '">' + e.classification + '</span>';

    // S7: Re-judge button — explicit on-demand action, never on the regen hot path
    if (linkId) {
      var btn = document.createElement('button');
      btn.className = 'rj-btn';
      btn.textContent = 'Re-judge → APPROVE';
      btn.title = 'Append a scoped APPROVE verdict for link ' + linkId;
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        btn.disabled = true;
        btn.textContent = 'Re-judging…';
        rejudge(linkId, 'APPROVE');
      });
      li.appendChild(btn);
    }

    // Hover on sidebar item → highlight that edge pair
    li.addEventListener('mouseenter', function () {
      Object.keys(nodeEls).forEach(function (id) {
        nodeEls[id].grp.style.opacity = (id === e.source || id === e.target) ? '1' : '0.2';
      });
      edgeEls.forEach(function (item) {
        item.el.style.opacity = (item.edge === e) ? '1' : '0.1';
      });
    });
    li.addEventListener('mouseleave', function () {
      Object.keys(nodeEls).forEach(function (id) { nodeEls[id].grp.style.opacity = '1'; });
      edgeEls.forEach(function (item) { item.el.style.opacity = '1'; });
    });

    needsList.appendChild(li);
  });
}

}());
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

/**
 * Start the HTTP server on the given port (0 = OS-assigned ephemeral port).
 *
 * @param {{ nodes: object[], edges: object[], slug?: string, artifactEvidence?: object[] }} classifiedGraph
 * @param {number} [port=0]
 * @param {{ slug?: string, projectDir?: string }} [opts]
 *   Options for S7 re-judge support. When provided, enables POST /rejudge:
 *   the handler appends a scoped GATE event and rebuilds the served graph.
 * @returns {Promise<{ server: import('node:http').Server, port: number, url: string }>}
 */
export function startServer(classifiedGraph, port = 0, opts = {}) {
  const { slug = classifiedGraph.slug ?? null, projectDir = null } = opts

  // Use `let` so POST /rejudge can atomically swap in a rebuilt graph.
  let currentHtml = buildHtml(classifiedGraph)
  let currentGraphJson = JSON.stringify(classifiedGraph)

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/'

    // ── S7: POST /rejudge — explicit on-demand single-link re-judge ──────────
    // INVARIANT: this block is the ONLY place rejudgeLink is called.
    // buildClassifiedGraph MUST NOT call rejudgeLink — separation is load-bearing.
    if (req.method === 'POST' && (url === '/rejudge' || url === '/rejudge?')) {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        try {
          const parsed = /** @type {Record<string,unknown>} */ (JSON.parse(body || '{}'))
          const linkId  = typeof parsed.link_id === 'string' ? parsed.link_id : null
          const verdict = typeof parsed.verdict  === 'string' ? parsed.verdict  : 'APPROVE'
          const which   = typeof parsed.which    === 'string' ? parsed.which    : 'manual-rejudge'

          if (!linkId) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: 'link_id is required' }))
            return
          }
          if (!projectDir || !slug) {
            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: 'server not configured for rejudge (missing opts.slug / opts.projectDir)' }))
            return
          }

          // Append the scoped verdict event — EXPLICIT action only, never in regen hot path
          rejudgeLink(linkId, verdict, which, projectDir, slug)

          // Rebuild classified graph so the updated verdict renders on next page load
          try {
            const rebuilt = buildClassifiedGraph(slug, projectDir)
            currentHtml = buildHtml(rebuilt)
            currentGraphJson = JSON.stringify(rebuilt)
          } catch (rebuildErr) {
            // Append succeeded but rebuild failed — report partial success with detail
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: true, regenError: String(rebuildErr) }))
            return
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true }))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: String(err) }))
        }
      })
      return
    }

    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET, POST' })
      res.end('Method Not Allowed')
      return
    }

    if (url === '/graph' || url === '/graph?') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(currentGraphJson)
    } else if (url === '/' || url === '') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(currentHtml)
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
    }
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const addr = /** @type {import('node:net').AddressInfo} */ (server.address())
      const resolvedPort = addr.port
      const url = 'http://127.0.0.1:' + resolvedPort
      resolve({ server, port: resolvedPort, url })
    })
  })
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function die(msg, code = 1) {
  process.stderr.write('traceability-serve: ' + msg + '\n')
  process.exit(code)
}

/** @param {string[]} args */
function parseArgs(args) {
  const positionals = []
  const flags = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positionals.push(a)
    }
  }
  return { positionals, flags }
}

const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] != null &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('/traceability-serve.mjs'))

if (isMain) {
  const { positionals, flags } = parseArgs(process.argv.slice(2))

  if (flags.help || flags.h) {
    process.stdout.write(
      'Usage: node hooks/lib/traceability-serve.mjs <slug> [--port N]\n' +
      '\n' +
      'Options:\n' +
      '  --port N   Port to listen on (default: 4242)\n' +
      '  --help     Show this message\n',
    )
    process.exit(0)
  }

  const slug = positionals[0]
  if (!slug) die('slug is required.\nUsage: node hooks/lib/traceability-serve.mjs <slug> [--port N]', 2)

  const port = flags.port ? parseInt(String(flags.port), 10) : 4242
  if (isNaN(port) || port < 0 || port > 65535) die('--port must be 0–65535', 2)

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()

  let graph
  try {
    graph = buildClassifiedGraph(slug, projectDir)
  } catch (err) {
    die('Failed to load motive "' + slug + '": ' + (err instanceof Error ? err.message : String(err)))
  }

  startServer(graph, port, { slug, projectDir })
    .then(({ url }) => {
      process.stdout.write('traceability-serve: listening on ' + url + '\n')
      process.stdout.write('  Graph JSON : ' + url + '/graph\n')
      process.stdout.write('  Interactive: ' + url + '/\n')
      process.stdout.write('  Re-judge   : POST ' + url + '/rejudge (body: { link_id, verdict?, which? })\n')
      // Keep the server running
    })
    .catch((err) => {
      die('Failed to start server: ' + (err instanceof Error ? err.message : String(err)))
    })
}
