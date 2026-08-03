/**
 * test/hooks/motive-html.test.ts
 *
 * Unit + integration tests for renderHtml (S6).
 *
 * Unit tests work with literal view objects (no filesystem).
 * Integration test spawns `node hooks/journal.mjs compile <motive> --html`
 * inside a mkdtemp fixture dir.
 */

import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmp(): string {
  return mkdtempSync(path.join(tmpdir(), 'motive-html-'))
}

/** Minimal compiled view with empty agent layer */
function emptyView(): Record<string, unknown> {
  return {
    compiler_version: 'motive-compile/1.1.0',
    agent: {
      objective: null,
      objective_source: 'absent',
      decision_log: [],
      baselines: [],
      open_items: [],
      open_items_summary: { total: 0, open: 0, resolved: 0 },
      open_items_source: null,
      open_slices: [],
      blocked: [],
      last_gate: null,
      gates: {},
      failures: [],
      drift: [],
      waivers: [],
      resume: { next_actions: [] },
      confidence: 'hook-only',
      confidence_notes: [],
      sessions: [],
      decisions: [],
      last_handoff: null,
      verifications: [],
      milestones: [],
      spec_changes: [],
      all_slices: [],
    },
    human: null,
    provenance: { compiler_version: 'motive-compile/1.1.0', at_ord: 0, events_folded: 0, malformed_lines: 0, unknown_type_events: 0, at_marker: null },
    divergence: { checked: false, findings: [], banner: 'NOT CHECKED' },
  }
}

// ---------------------------------------------------------------------------
// S6-AC1 — no http(s):// asset references
// ---------------------------------------------------------------------------

describe('S6-AC1 — no external asset references', () => {
  it('empty view produces no http:// or https:// URLs', async () => {
    const { renderHtml } = await import('../../hooks/lib/motive-html.mjs')
    const html = renderHtml(emptyView())
    expect(html).not.toMatch(/https?:\/\//)
  })
})

// ---------------------------------------------------------------------------
// S6-AC2 — divergence banner is first visible element when findings exist
// ---------------------------------------------------------------------------

describe('S6-AC2 — divergence banner first', () => {
  it('banner appears before objective when divergence findings exist', async () => {
    const { renderHtml } = await import('../../hooks/lib/motive-html.mjs')
    const view = emptyView()
    ;(view as Record<string, unknown>).divergence = {
      checked: true,
      findings: [{ severity: 'high', kind: 'slice_state_mismatch', id: 'S1', detail: 'fold says complete but ledger says open' }],
      banner: '⚠ DIVERGENCE',
    }
    ;((view as Record<string, unknown>).agent as Record<string, unknown>).objective = 'My objective'
    const html = renderHtml(view)
    const bannerIdx = html.indexOf('class="banner')
    const objectiveIdx = html.indexOf('<h1>')
    expect(bannerIdx).toBeGreaterThanOrEqual(0)
    expect(objectiveIdx).toBeGreaterThan(bannerIdx)
  })

  it('no banner rendered when divergence findings are empty', async () => {
    const { renderHtml } = await import('../../hooks/lib/motive-html.mjs')
    const html = renderHtml(emptyView())
    expect(html).not.toContain('class="banner')
  })

  it('banner contains the divergence finding detail', async () => {
    const { renderHtml } = await import('../../hooks/lib/motive-html.mjs')
    const view = emptyView()
    ;(view as Record<string, unknown>).divergence = {
      checked: true,
      findings: [{ severity: 'medium', kind: 'no_ledger', detail: 'events exist but no ledger' }],
      banner: '⚠ divergence',
    }
    const html = renderHtml(view)
    expect(html).toContain('no_ledger')
    expect(html).toContain('events exist but no ledger')
  })
})

// ---------------------------------------------------------------------------
// S6-AC3 — burn-down counts match open_items_summary
// ---------------------------------------------------------------------------

describe('S6-AC3 — burn-down counts', () => {
  it('renders total/open/resolved from open_items_summary', async () => {
    const { renderHtml } = await import('../../hooks/lib/motive-html.mjs')
    const view = emptyView()
    const agent = (view as Record<string, unknown>).agent as Record<string, unknown>
    agent.open_items_source = 'charter'
    agent.open_items_summary = { total: 5, open: 3, resolved: 2 }
    agent.open_items = []
    const html = renderHtml(view)
    expect(html).toContain('>5<')
    expect(html).toContain('>3<')
    expect(html).toContain('>2<')
  })

  it('shows "no open items register" when source is null', async () => {
    const { renderHtml } = await import('../../hooks/lib/motive-html.mjs')
    const html = renderHtml(emptyView())
    expect(html).toContain('No open items register found')
  })
})

// ---------------------------------------------------------------------------
// S6-AC4 — supersession links
// ---------------------------------------------------------------------------

describe('S6-AC4 — supersession links', () => {
  it('superseded decision has link to successor', async () => {
    const { renderHtml } = await import('../../hooks/lib/motive-html.mjs')
    const view = emptyView()
    const agent = (view as Record<string, unknown>).agent as Record<string, unknown>
    agent.decision_log = [
      { id: 'D1', status: 'superseded', title: 'Old approach', rationale: null, ord: 1, ts: '2024-01-01T00:00:00Z', supersedes: null, superseded_by: 'D2', resolves: null },
      { id: 'D2', status: 'accepted', title: 'New approach', rationale: 'Better', ord: 2, ts: '2024-01-02T00:00:00Z', supersedes: 'D1', superseded_by: null, resolves: null },
    ]
    const html = renderHtml(view)
    // D1 should link to D2
    expect(html).toContain('href="#decision-D2"')
    // D2 should link back to D1
    expect(html).toContain('href="#decision-D1"')
    // Both anchors exist
    expect(html).toContain('id="decision-D1"')
    expect(html).toContain('id="decision-D2"')
  })
})

// ---------------------------------------------------------------------------
// S6-AC5 — ready set
// ---------------------------------------------------------------------------

describe('S6-AC5 — ready set', () => {
  it('lists only slices with ready===true and status!==complete', async () => {
    const { renderHtml } = await import('../../hooks/lib/motive-html.mjs')
    const view = emptyView()
    const agent = (view as Record<string, unknown>).agent as Record<string, unknown>
    agent.open_slices = [
      { id: 'S1', desc: 'Slice one', status: 'open', ready: true, blocked_by: [] },
      { id: 'S2', desc: 'Slice two', status: 'complete', ready: true, blocked_by: [] },
      { id: 'S3', desc: 'Slice three', status: 'open', ready: false, blocked_by: ['S1'] },
    ]
    const html = renderHtml(view)
    // S1 is ready and not complete — should appear
    expect(html).toContain('S1')
    // S2 is complete — should NOT appear in ready set
    const readySetIdx = html.indexOf('<h2>Ready Set</h2>')
    const baselinesIdx = html.indexOf('<h2>Baselines</h2>')
    const readySection = html.slice(readySetIdx, baselinesIdx)
    expect(readySection).not.toContain('Slice two')
    // S3 is not ready — should not appear
    expect(readySection).not.toContain('S3')
  })

  it('shows claimed_by badge when claimed_by is present', async () => {
    const { renderHtml } = await import('../../hooks/lib/motive-html.mjs')
    const view = emptyView()
    const agent = (view as Record<string, unknown>).agent as Record<string, unknown>
    agent.open_slices = [
      { id: 'S1', desc: 'Slice one', status: 'open', ready: true, blocked_by: [], claimed_by: 'session-abc' },
    ]
    const html = renderHtml(view)
    expect(html).toContain('claimed by session-abc')
  })
})

// ---------------------------------------------------------------------------
// S6-AC6 — deterministic, zero imports
// ---------------------------------------------------------------------------

describe('S6-AC6 — determinism and purity', () => {
  it('same view produces identical output across calls', async () => {
    const { renderHtml } = await import('../../hooks/lib/motive-html.mjs')
    const view = emptyView()
    const a = renderHtml(view)
    const b = renderHtml(view)
    expect(a).toBe(b)
  })

  it('motive-html.mjs contains zero import/require statements', () => {
    const src = readFileSync(path.join(ROOT, 'hooks/lib/motive-html.mjs'), 'utf8')
    const lines = src.split('\n').filter((l) => /^\s*(import|const\s+\{.*\}\s*=\s*require)/.test(l))
    expect(lines).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// S6-AC7 — empty-state text, no crash on missing data
// ---------------------------------------------------------------------------

describe('S6-AC7 — empty states', () => {
  it('renders valid HTML with explicit empty-state text when nothing is present', async () => {
    const { renderHtml } = await import('../../hooks/lib/motive-html.mjs')
    const html = renderHtml(emptyView())
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('No decisions recorded')
    expect(html).toContain('No baselines recorded')
    expect(html).toContain('No ready slices')
    expect(html).toContain('No open items register found')
  })

  it('does not throw on a null/undefined view', async () => {
    const { renderHtml } = await import('../../hooks/lib/motive-html.mjs')
    expect(() => renderHtml(null)).not.toThrow()
    expect(() => renderHtml(undefined)).not.toThrow()
  })

  it('escapes HTML in objective', async () => {
    const { renderHtml } = await import('../../hooks/lib/motive-html.mjs')
    const view = emptyView()
    ;((view as Record<string, unknown>).agent as Record<string, unknown>).objective = '<script>alert(1)</script>'
    const html = renderHtml(view)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes HTML in decision titles', async () => {
    const { renderHtml } = await import('../../hooks/lib/motive-html.mjs')
    const view = emptyView()
    const agent = (view as Record<string, unknown>).agent as Record<string, unknown>
    agent.decision_log = [
      { id: 'D1', status: 'accepted', title: '<img src=x onerror=alert(1)>', rationale: null, ord: 1, ts: null, supersedes: null, superseded_by: null, resolves: null },
    ]
    const html = renderHtml(view)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })
})

// ---------------------------------------------------------------------------
// S6-AC8 — end-to-end integration: journal compile --html
// ---------------------------------------------------------------------------

describe('S6-AC8 — end-to-end integration', () => {
  it('journal compile --html writes a non-empty .html whose burn-down matches .json', () => {
    const tmp = mkTmp()
    try {
      // Set up a minimal project dir with a motive shard
      const journalDir = path.join(tmp, '.groundwork', 'journal')
      mkdirSync(journalDir, { recursive: true })
      const compiledDir = path.join(tmp, '.groundwork', 'compiled')
      mkdirSync(compiledDir, { recursive: true })

      // Write a minimal journal shard — flat in journalDir, filtered by motive field
      const now = new Date().toISOString()
      const shard = [
        JSON.stringify({ type: 'MOTIVE_CREATED', motive: 'test-motive', ts: now, session: 's1', data: { objective: 'Test objective for HTML' } }),
      ].join('\n') + '\n'
      writeFileSync(path.join(journalDir, '001.jsonl'), shard)

      // Write a minimal motive.md charter with open_items
      const charterDir = path.join(tmp, '.groundwork', 'motives', 'test-motive')
      mkdirSync(charterDir, { recursive: true })
      writeFileSync(path.join(charterDir, 'motive.md'), [
        '---',
        'motive: test-motive',
        'objective: Test objective for HTML',
        'open_items:',
        '  - id: TBD-1',
        '    kind: TBD',
        '    statement: Some open question',
        '---',
        '',
        '# Test motive',
      ].join('\n'))

      // Run journal compile --html --no-ground-truth
      execSync(
        `node ${path.join(ROOT, 'hooks/journal.mjs')} compile test-motive --html --no-ground-truth --force`,
        { env: { ...process.env, CLAUDE_PROJECT_DIR: tmp }, cwd: tmp, stdio: 'pipe' },
      )

      const htmlPath = path.join(compiledDir, 'test-motive.html')
      const jsonPath = path.join(compiledDir, 'test-motive.json')

      // HTML file exists and is non-empty
      expect(existsSync(htmlPath)).toBe(true)
      const htmlContent = readFileSync(htmlPath, 'utf8')
      expect(htmlContent.length).toBeGreaterThan(0)
      expect(htmlContent).toContain('<!DOCTYPE html>')

      // Burn-down counts in HTML match the .json open_items_summary
      const jsonView = JSON.parse(readFileSync(jsonPath, 'utf8'))
      const summary = jsonView.agent?.open_items_summary
      if (summary != null) {
        expect(htmlContent).toContain(`>${summary.total}<`)
        expect(htmlContent).toContain(`>${summary.open}<`)
        expect(htmlContent).toContain(`>${summary.resolved}<`)
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
