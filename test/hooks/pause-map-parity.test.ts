/**
 * pause-map-parity.test.ts — seam guard: motive-compile ↔ motive-map
 *
 * Proves that motive-compile's compile() and motive-map's regenerateMotiveMap()
 * cannot disagree on how PAUSE next_actions are handled.
 *
 * The seam: both modules read the same PAUSE event data but process it
 * independently. This guard exercises BOTH real surfaces — no reimplementation
 * of the formatting logic inside the test.
 *
 * Mixed next_actions (the shape concept-over-harness exercises):
 *   (a) plain string  → MAP renders as `- <text>`
 *   (b) object {action, slice, wave, desc, …} → MAP renders as `- **<slice>** (w<N>): <desc>`
 *
 * RED→GREEN sensitive: fails if MAP.md contains "undefined" or if compile()
 * does not surface the items in last_pause.next_actions (positive control).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-ignore
import { compile } from '../../hooks/lib/motive-compile.mjs'
// @ts-ignore
import { regenerateMotiveMap } from '../../hooks/lib/motive-map.mjs'

// ---------------------------------------------------------------------------
// Fixture — mixed next_actions (string + object)
// ---------------------------------------------------------------------------

const MOTIVE = 'parity-test-motive'

const MIXED_NEXT_ACTIONS = [
  'S1-DOCS: update spec documentation',
  {
    action: 'implement_slice',
    slice: 'S2-IMPL',
    wave: 2,
    desc: 'implement the feature',
    acceptance: [],
    why: 'needed',
  },
]

const PAUSE_DATA = {
  pointer: 'handoff/pause.md',
  summary: 'Paused before wave 2.',
  next_actions: MIXED_NEXT_ACTIONS,
}

const PAUSE_EVENT = {
  ts: '2026-09-09T10:00:00.000Z',
  session: 'sess-parity-test',
  motive: MOTIVE,
  type: 'PAUSE',
  data: PAUSE_DATA,
}

// ---------------------------------------------------------------------------
// Filesystem setup for regenerateMotiveMap
// ---------------------------------------------------------------------------

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pause-map-parity-'))

  // Charter
  const motiveDir = join(tmpDir, '.groundwork', 'motives', MOTIVE)
  mkdirSync(motiveDir, { recursive: true })
  writeFileSync(join(motiveDir, 'motive.md'), `# motive: ${MOTIVE}\n\n## Objective\nParity test.\n`, 'utf8')

  // PAUSE event in the shared journal dir (_readAllMotiveEvents reads from here)
  const journalDir = join(tmpDir, '.groundwork', 'journal')
  mkdirSync(journalDir, { recursive: true })
  writeFileSync(join(journalDir, '2026-09-09-parity.jsonl'), JSON.stringify(PAUSE_EVENT) + '\n', 'utf8')

  // Generate MAP.md once; tests read it
  regenerateMotiveMap(tmpDir, MOTIVE)
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readMap(): string {
  return readFileSync(join(tmpDir, '.groundwork', 'motives', MOTIVE, 'MAP.md'), 'utf8')
}

function makeCompileEvent() {
  return {
    ts: PAUSE_EVENT.ts,
    session: PAUSE_EVENT.session,
    motive: MOTIVE,
    type: 'PAUSE',
    data: PAUSE_DATA,
    _order: { shard: 'test.jsonl', line: 0 },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PAUSE next_actions parity: compile() ↔ regenerateMotiveMap()', () => {
  // ── Positive controls: prove the harness can SEE the values ────────────

  it('positive control: compile() surfaces BOTH items in last_pause.next_actions', () => {
    const view = compile([makeCompileEvent()])
    const na = view.agent.last_pause?.next_actions as unknown[]
    // Prove present — not silently absent
    expect(Array.isArray(na)).toBe(true)
    expect(na).toHaveLength(2)
    expect(na[0] as unknown).toBe('S1-DOCS: update spec documentation')
    expect(na[1] as unknown).toMatchObject({ slice: 'S2-IMPL', wave: 2, desc: 'implement the feature' })
  })

  it('positive control: MAP.md has a Pause section', () => {
    const map = readMap()
    expect(map).toContain('## Pause')
  })

  // ── Seam: MAP must render both shapes without "undefined" ─────────────

  it('MAP.md renders string item as plain bullet (no "undefined")', () => {
    const map = readMap()
    expect(map).toContain('- S1-DOCS: update spec documentation')
    expect(map).not.toContain('undefined')
  })

  it('MAP.md renders object item as **slice** (wN): desc bullet', () => {
    const map = readMap()
    expect(map).toContain('- **S2-IMPL** (w2): implement the feature')
  })

  it('every compile() last_pause item has a non-undefined bullet in MAP.md (seam assertion)', () => {
    const view = compile([makeCompileEvent()])
    const naItems = (view.agent.last_pause?.next_actions ?? []) as unknown[]
    expect(naItems.length).toBeGreaterThan(0) // positive control

    const map = readMap()
    expect(map).not.toContain('undefined')

    for (const na of naItems) {
      if (typeof na === 'string') {
        expect(map).toContain(`- ${na}`)
      } else if (na != null && typeof na === 'object') {
        const obj = na as Record<string, unknown>
        if (obj.slice != null) {
          expect(map).toContain(`- **${obj.slice}**`)
        }
      }
    }
  })
})
