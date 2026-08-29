/**
 * pause-render.test.ts — S4-JOURNAL-PAUSE-RENDER regression tests.
 *
 * Verifies that pause.next_actions items render correctly for both shapes:
 *  (a) plain string  → `- <text>`
 *  (b) object {action, slice, wave, desc, …} → `- **<slice>** (w<wave>): <desc>`
 *
 * Also asserts --json (agent.last_pause) is unchanged by the renderer (structural).
 */

// @ts-nocheck — pure-JS .mjs target

import { describe, it, expect } from 'vitest'
import { buildHumanLayer } from '../../hooks/lib/motive-render.mjs'

// ── helpers ───────────────────────────────────────────────────────────────

function makeView(last_pause: unknown) {
  return {
    agent: {
      objective: null,
      objective_source: null,
      all_slices: [],
      open_slices: [],
      confidence: 'n/a',
      decisions: [],
      failures: [],
      last_gate: null,
      last_pause,
      sessions: [],
      drift: [],
      spec_changes: [],
      open_items_source: null,
      open_items: [],
      open_items_summary: null,
      ac_coverage: null,
    },
    provenance: { motive: 'test-motive' },
    divergence: null,
    human: null,
  }
}

function pauseSection(last_pause: unknown) {
  const view = makeView(last_pause)
  const human = buildHumanLayer(view)
  return human.narrative_sections.find((s: { title: string }) => s.title === 'Pause')
}

// ── tests ─────────────────────────────────────────────────────────────────

describe('pause next_actions rendering', () => {
  it('string item renders as plain bullet (no "undefined")', () => {
    const section = pauseSection({
      pointer: null,
      summary: null,
      next_actions: ['S4-SPEC-DOCS: spec SKILL.md and related'],
    })
    expect(section).not.toBeUndefined()
    expect(section.content).toContain('- S4-SPEC-DOCS: spec SKILL.md and related')
    expect(section.content).not.toContain('undefined')
  })

  it('object item renders as **slice** (wN): desc bullet', () => {
    const section = pauseSection({
      pointer: null,
      summary: null,
      next_actions: [
        { action: 'implement_slice', slice: 'S5-IMPL', wave: 5, desc: 'implement the feature', acceptance: [], why: 'needed' },
      ],
    })
    expect(section).not.toBeUndefined()
    expect(section.content).toContain('- **S5-IMPL** (w5): implement the feature')
    expect(section.content).not.toContain('undefined')
  })

  it('mixed array renders both shapes correctly', () => {
    const section = pauseSection({
      pointer: 'hooks/lib/foo.mjs:42',
      summary: 'Paused before wave 5.',
      next_actions: [
        'S4-SPEC-DOCS: spec SKILL.md …',
        { action: 'implement_slice', slice: 'S5-IMPL', wave: 5, desc: 'implement the feature' },
      ],
    })
    expect(section).not.toBeUndefined()
    expect(section.content).toContain('- S4-SPEC-DOCS: spec SKILL.md …')
    expect(section.content).toContain('- **S5-IMPL** (w5): implement the feature')
    expect(section.content).not.toContain('undefined')
  })

  it('object without wave omits (wN)', () => {
    const section = pauseSection({
      next_actions: [
        { action: 'review', slice: 'S3-REVIEW', desc: 'review changes' },
      ],
    })
    expect(section.content).toContain('- **S3-REVIEW**: review changes')
    expect(section.content).not.toContain('(w')
  })

  it('absent next_actions → no Pause section', () => {
    const section = pauseSection(null)
    expect(section).toBeUndefined()
  })

  it('--json: agent.last_pause structure is preserved unchanged by renderer', () => {
    const last_pause = {
      pointer: 'hooks/lib/foo.mjs:42',
      summary: 'Paused.',
      next_actions: [
        'plain string',
        { action: 'implement_slice', slice: 'S5', wave: 5, desc: 'desc', acceptance: [], why: 'why' },
      ],
    }
    const view = makeView(last_pause)
    // Render must not mutate agent.last_pause
    buildHumanLayer(view)
    expect(view.agent.last_pause).toEqual(last_pause)
    expect(view.agent.last_pause.next_actions[0]).toBe('plain string')
    expect(view.agent.last_pause.next_actions[1]).toMatchObject({ action: 'implement_slice', slice: 'S5', wave: 5 })
  })
})
