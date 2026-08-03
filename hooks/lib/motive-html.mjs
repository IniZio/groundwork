/**
 * motive-html.mjs — Pure HTML dashboard renderer.
 *
 * PURITY CONTRACT: Zero imports. No filesystem access, no Date.now(), no
 * process.*, no require(). This module MUST remain import-free; the purity
 * guard test (S0-AC5) will fail if any import is added.
 *
 * Exported signatures (frozen in S0):
 *
 *   renderHtml(view) → string
 *     Accepts the compiled view object produced by compile() and returns a
 *     self-contained HTML string. Pure function — same input always yields
 *     the same output.
 */

// ---------------------------------------------------------------------------
// Helpers — no imports allowed, all utilities defined inline
// ---------------------------------------------------------------------------

/** Escape HTML special characters in a user-provided string. */
function esc(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Format an ISO timestamp to a compact readable date (YYYY-MM-DD). */
function fmtDate(ts) {
  if (!ts) return ''
  return String(ts).slice(0, 10)
}

// ---------------------------------------------------------------------------
// CSS — inline, light + dark via prefers-color-scheme
// ---------------------------------------------------------------------------

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;padding:24px;max-width:960px;margin:0 auto}
h1{font-size:1.5rem;margin-bottom:4px}
h2{font-size:1.1rem;margin:24px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--border)}
p{margin-bottom:8px}
ul{margin:0 0 8px 20px}
li{margin-bottom:2px}
a{color:var(--link)}
code{font-size:.85em;padding:1px 4px;border-radius:3px;background:var(--code-bg)}
.badge{display:inline-block;font-size:.75em;padding:1px 6px;border-radius:10px;background:var(--badge-bg);color:var(--badge-fg);white-space:nowrap}
.banner{padding:12px 16px;border-radius:6px;margin-bottom:20px;border-left:4px solid var(--banner-border)}
.banner.high{background:var(--banner-high-bg);border-color:var(--banner-high-border)}
.banner.low{background:var(--banner-low-bg);border-color:var(--banner-low-border)}
.banner-title{font-weight:600;margin-bottom:4px}
.finding{font-size:.85em;padding:2px 0}
.empty{color:var(--muted);font-style:italic}
.decision{padding:8px 12px;border-radius:4px;margin-bottom:8px;border:1px solid var(--border)}
.decision.superseded{opacity:.6}
.decision-header{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px}
.decision-title{font-weight:600}
.status-accepted{color:var(--green)}
.status-rejected{color:var(--red)}
.status-superseded{color:var(--muted)}
.status-proposed{color:var(--orange)}
.slice-row{display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-light)}
.slice-row:last-child{border-bottom:none}
.slice-id{font-family:monospace;font-size:.85em;min-width:80px;flex-shrink:0}
.slice-desc{flex:1}
.burn{display:flex;gap:16px;padding:8px 0;margin-bottom:8px}
.burn-stat{text-align:center}
.burn-num{font-size:1.6rem;font-weight:700;line-height:1}
.burn-label{font-size:.75em;color:var(--muted)}
.open-item{padding:4px 0;border-bottom:1px solid var(--border-light)}
.open-item:last-child{border-bottom:none}
.baseline{padding:4px 0;border-bottom:1px solid var(--border-light)}
.baseline:last-child{border-bottom:none}
@media(prefers-color-scheme:light),:root[data-theme="light"]{
  --bg:#fff;--fg:#1a1a1a;--border:#e0e0e0;--border-light:#f0f0f0;
  --link:#0969da;--code-bg:#f6f8fa;--muted:#666;
  --badge-bg:#e8edf2;--badge-fg:#444;
  --banner-high-bg:#fff3cd;--banner-high-border:#e6a817;
  --banner-low-bg:#e8f4fd;--banner-low-border:#4a9fd4;
  --green:#1a7f37;--red:#cf222e;--orange:#9a6700;
}
@media(prefers-color-scheme:dark),:root[data-theme="dark"]{
  --bg:#0d1117;--fg:#e6edf3;--border:#30363d;--border-light:#21262d;
  --link:#58a6ff;--code-bg:#161b22;--muted:#8b949e;
  --badge-bg:#21262d;--badge-fg:#c9d1d9;
  --banner-high-bg:#2d1f00;--banner-high-border:#d29922;
  --banner-low-bg:#0d2233;--banner-low-border:#388bfd;
  --green:#3fb950;--red:#f85149;--orange:#d29922;
}
body{background:var(--bg);color:var(--fg)}
`

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderDivergenceBanner(divergence) {
  if (!divergence || !Array.isArray(divergence.findings) || divergence.findings.length === 0) {
    return ''
  }
  const hasHigh = divergence.findings.some((f) => f.severity === 'high')
  const cls = hasHigh ? 'high' : 'low'
  const findings = divergence.findings
    .map((f) => {
      const loc = f.id ? ` [${esc(f.id)}]` : f.path ? ` ${esc(f.path)}` : ''
      return `<div class="finding">&#9679; <strong>${esc(f.severity)}</strong> · ${esc(f.kind)}${loc}: ${esc(f.detail)}</div>`
    })
    .join('\n')
  return `<div class="banner ${cls}" role="alert">
  <div class="banner-title">${esc(divergence.banner)}</div>
  ${findings}
</div>
`
}

function renderObjective(agent) {
  const obj = agent?.objective
  if (obj == null) {
    return `<h1>Motive Dashboard</h1>
<p class="empty">No objective recorded.</p>
`
  }
  return `<h1>${esc(obj)}</h1>
`
}

function renderBurnDown(agent) {
  const summary = agent?.open_items_summary ?? { total: 0, open: 0, resolved: 0 }
  const items = Array.isArray(agent?.open_items) ? agent.open_items : []
  const source = agent?.open_items_source ?? null

  let body
  if (source == null) {
    body = `<p class="empty">No open items register found.</p>`
  } else {
    const stats = `<div class="burn">
  <div class="burn-stat"><div class="burn-num">${esc(String(summary.total))}</div><div class="burn-label">total</div></div>
  <div class="burn-stat"><div class="burn-num">${esc(String(summary.open))}</div><div class="burn-label">open</div></div>
  <div class="burn-stat"><div class="burn-num">${esc(String(summary.resolved))}</div><div class="burn-label">resolved</div></div>
</div>`
    if (items.length === 0) {
      body = stats + `\n<p class="empty">Register is empty.</p>`
    } else {
      const rows = items
        .map((item) => {
          const resolvedMark = item.resolved_by
            ? ` <span class="badge">resolved by ${esc(item.resolved_by)}</span>`
            : ''
          const kind = item.kind ? ` <code>${esc(item.kind)}</code>` : ''
          return `<div class="open-item">${esc(item.id)}${kind} — ${esc(item.statement)}${resolvedMark}</div>`
        })
        .join('\n')
      body = stats + '\n' + rows
    }
  }
  return `<h2>TBD/TBR Burn-Down</h2>
${body}
`
}

function renderDecisionTimeline(agent) {
  const log = Array.isArray(agent?.decision_log) ? agent.decision_log : []
  if (log.length === 0) {
    return `<h2>Decision Timeline</h2>
<p class="empty">No decisions recorded.</p>
`
  }

  const rows = log
    .map((d) => {
      const cls = d.status === 'superseded' ? ' superseded' : ''
      const statusCls = `status-${String(d.status ?? 'proposed').replace(/[^a-z0-9-]/g, '')}`
      const title = d.title ?? d.id ?? '(untitled)'

      let supersessionLinks = ''
      if (d.supersedes != null) {
        supersessionLinks += ` <span>supersedes <a href="#decision-${esc(d.supersedes)}">${esc(d.supersedes)}</a></span>`
      }
      if (d.superseded_by != null) {
        supersessionLinks += ` <span>superseded by <a href="#decision-${esc(d.superseded_by)}">${esc(d.superseded_by)}</a></span>`
      }

      const rationale = d.rationale ? `<div>${esc(d.rationale)}</div>\n` : ''
      const resolves = d.resolves ? `<div>Resolves: <code>${esc(d.resolves)}</code></div>\n` : ''
      const date = d.ts ? ` <span class="badge">${fmtDate(d.ts)}</span>` : ''

      return `<div class="decision${cls}" id="decision-${esc(d.id)}">
  <div class="decision-header"><span class="decision-title">${esc(title)}</span> <span class="${statusCls}">${esc(d.status ?? 'proposed')}</span>${date}${supersessionLinks}</div>
  ${rationale}${resolves}</div>`
    })
    .join('\n')

  return `<h2>Decision Timeline</h2>
${rows}
`
}

function renderAcCoverage(agent) {
  const coverage = agent?.ac_coverage ?? { met: [], unmet: [] }
  const met = Array.isArray(coverage.met) ? coverage.met : []
  const unmet = Array.isArray(coverage.unmet) ? coverage.unmet : []
  if (met.length === 0 && unmet.length === 0) {
    return `<h2>AC Coverage</h2>
<p class="empty">No AC coverage recorded.</p>
`
  }
  const rows = [
    ...met.map((a) =>
      `<div class="ac-item ac-met"><span class="badge ac-met-badge">MET</span> <strong>${esc(a.id)}</strong> — covering: ${a.covering.map((s) => `<code>${esc(s)}</code>`).join(', ')}</div>`
    ),
    ...unmet.map((a) => {
      const why = a.covering.length === 0
        ? 'no covering slices assigned'
        : `missing: ${a.missing.map((s) => `<code>${esc(s)}</code>`).join(', ')}`
      return `<div class="ac-item ac-unmet"><span class="badge ac-unmet-badge">UNMET</span> <strong>${esc(a.id)}</strong> — covering: ${a.covering.map((s) => `<code>${esc(s)}</code>`).join(', ')} (${why})</div>`
    }),
  ].join('\n')
  return `<h2>AC Coverage</h2>
${rows}
`
}

function renderReadySet(agent) {
  const slices = Array.isArray(agent?.open_slices) ? agent.open_slices : []
  const ready = slices.filter((s) => s.ready === true && s.status !== 'complete')

  if (ready.length === 0) {
    return `<h2>Ready Set</h2>
<p class="empty">No ready slices.</p>
`
  }

  const rows = ready
    .map((s) => {
      const claimed = s.claimed_by
        ? ` <span class="badge">claimed by ${esc(s.claimed_by)}</span>`
        : ''
      const desc = s.desc ? esc(s.desc) : esc(s.id)
      return `<div class="slice-row">
  <span class="slice-id"><code>${esc(s.id)}</code></span>
  <span class="slice-desc">${desc}${claimed}</span>
</div>`
    })
    .join('\n')

  return `<h2>Ready Set</h2>
${rows}
`
}

function renderBaselines(agent) {
  const baselines = Array.isArray(agent?.baselines) ? agent.baselines : []
  if (baselines.length === 0) {
    return `<h2>Baselines</h2>
<p class="empty">No baselines recorded.</p>
`
  }

  const rows = baselines
    .map((b) => {
      const date = b.ts ? ` <span class="badge">${fmtDate(b.ts)}</span>` : ''
      return `<div class="baseline">${esc(b.name ?? '(unnamed)')}${date}</div>`
    })
    .join('\n')

  return `<h2>Baselines</h2>
${rows}
`
}

// ---------------------------------------------------------------------------
// Public API — frozen signature
// ---------------------------------------------------------------------------

/**
 * @param {object} view - Compiled view from motive-compile.mjs compile()
 * @returns {string}
 */
export function renderHtml(view) {
  const agent = view?.agent ?? {}
  const divergence = view?.divergence ?? null

  // Section order per plan S6:
  // 1. Divergence banner FIRST (when findings exist)
  // 2. Objective header
  // 3. Open items TBD/TBR burn-down
  // 4. Decision timeline
  // 5. Ready set
  // 6. Baseline markers
  const banner = renderDivergenceBanner(divergence)
  const objective = renderObjective(agent)
  const burnDown = renderBurnDown(agent)
  const acCoverage = renderAcCoverage(agent)
  const decisions = renderDecisionTimeline(agent)
  const readySet = renderReadySet(agent)
  const baselines = renderBaselines(agent)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Motive Dashboard</title>
<style>${CSS}</style>
</head>
<body>
${banner}${objective}
${burnDown}
${acCoverage}
${decisions}
${readySet}
${baselines}
</body>
</html>`
}
