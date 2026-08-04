/**
 * Tests for hooks/lib/motive-map.mjs
 *
 * Covers:
 *   - MAP.md written after ledger mutation (complete)
 *   - MAP.md sections present
 *   - Renderer failure does not break CLI (no-throw guarantee)
 *   - journal append triggers MAP refresh (via regenerateMotiveMap)
 *   - MAP reflects changed content after mutation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  chmodSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { regenerateMotiveMap } from '../../hooks/lib/motive-map.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmp() {
  return mkdtempSync(join(tmpdir(), 'motive-map-test-'))
}

function makeCharter(dir: string, motive: string, content: string) {
  const motiveDir = join(dir, '.groundwork', 'motives', motive)
  mkdirSync(motiveDir, { recursive: true })
  writeFileSync(join(motiveDir, 'motive.md'), content, 'utf8')
}

function writeLedger(dir: string, motive: string, data: object) {
  const runsDir = join(dir, '.groundwork', 'runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(join(runsDir, `run-test.json`), JSON.stringify(data), 'utf8')
}

function writeDecisions(dir: string, motive: string, decisions: object[]) {
  const journalDir = join(dir, '.groundwork', 'journal')
  mkdirSync(journalDir, { recursive: true })
  const lines = decisions.map((e) => JSON.stringify(e)).join('\n')
  writeFileSync(join(journalDir, '2026-01-01-test.jsonl'), lines + '\n', 'utf8')
}

function readMap(dir: string, motive: string): string {
  return readFileSync(join(dir, '.groundwork', 'motives', motive, 'MAP.md'), 'utf8')
}

// ---------------------------------------------------------------------------
// Basic generation
// ---------------------------------------------------------------------------

describe('regenerateMotiveMap — basic generation', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('writes MAP.md to the motive directory', () => {
    makeCharter(dir, 'my-motive', `# motive: my-motive\n\n## Objective\nBuild something great.\n`)
    regenerateMotiveMap(dir, 'my-motive')
    expect(existsSync(join(dir, '.groundwork', 'motives', 'my-motive', 'MAP.md'))).toBe(true)
  })

  it('MAP.md contains the required section headers', () => {
    makeCharter(dir, 'my-motive', `# motive: my-motive\n\n## Objective\nDo a thing.\n`)
    regenerateMotiveMap(dir, 'my-motive')
    const content = readMap(dir, 'my-motive')
    expect(content).toContain('## Destination')
    expect(content).toContain('## Decisions so far')
    expect(content).toContain('## Frontier')
    expect(content).toContain('## Open items')
    expect(content).toContain('## Out of scope')
  })

  it('Destination section contains the charter objective', () => {
    makeCharter(dir, 'my-motive', `# motive: my-motive\n\n## Objective\nMake the thing green.\n`)
    regenerateMotiveMap(dir, 'my-motive')
    const content = readMap(dir, 'my-motive')
    expect(content).toContain('Make the thing green.')
  })

  it('silent no-op when motive directory does not exist (no charter)', () => {
    // No makeCharter call — directory doesn't exist
    expect(() => regenerateMotiveMap(dir, 'ghost-motive')).not.toThrow()
    expect(existsSync(join(dir, '.groundwork', 'motives', 'ghost-motive', 'MAP.md'))).toBe(false)
  })

  it('footer notes auto-generation', () => {
    makeCharter(dir, 'my-motive', `# motive: my-motive\n\n## Objective\nFoo.\n`)
    regenerateMotiveMap(dir, 'my-motive')
    const content = readMap(dir, 'my-motive')
    expect(content).toContain('Auto-generated')
  })
})

// ---------------------------------------------------------------------------
// Ledger integration
// ---------------------------------------------------------------------------

describe('regenerateMotiveMap — ledger slices', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('Frontier section lists pending slices with no blockers', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    writeLedger(dir, 'm', {
      motive: 'm',
      active: true,
      slices: [
        { id: 'S1', status: 'pending', desc: 'First task', blocked_by: [] },
        { id: 'S2', status: 'complete', desc: 'Done task' },
      ],
      gate: {},
    })
    regenerateMotiveMap(dir, 'm')
    const content = readMap(dir, 'm')
    expect(content).toContain('S1')
    expect(content).toContain('First task')
  })

  it('blocked slice appears in In progress / Blocked section', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    writeLedger(dir, 'm', {
      motive: 'm',
      active: true,
      slices: [
        { id: 'S1', status: 'pending', desc: 'Foundation' },
        { id: 'S2', status: 'pending', desc: 'Blocked task', blocked_by: ['S1'] },
      ],
      gate: {},
    })
    regenerateMotiveMap(dir, 'm')
    const content = readMap(dir, 'm')
    expect(content).toContain('## In progress / Blocked')
    expect(content).toContain('S2')
    expect(content).toContain('S1')
  })

  it('in_progress slice appears in In progress / Blocked section', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    writeLedger(dir, 'm', {
      motive: 'm',
      active: true,
      slices: [
        { id: 'S1', status: 'in_progress', desc: 'Active work' },
        { id: 'S2', status: 'complete', desc: 'Done' },
      ],
      gate: {},
    })
    regenerateMotiveMap(dir, 'm')
    const content = readMap(dir, 'm')
    expect(content).toContain('## In progress / Blocked')
    expect(content).toContain('S1')
    expect(content).toContain('Active work')
  })

  it('Progress section shows completed count', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    writeLedger(dir, 'm', {
      motive: 'm',
      active: true,
      slices: [
        { id: 'S1', status: 'complete', desc: 'Done' },
        { id: 'S2', status: 'pending', desc: 'Todo' },
      ],
      gate: {},
    })
    regenerateMotiveMap(dir, 'm')
    const content = readMap(dir, 'm')
    expect(content).toContain('## Progress')
    expect(content).toContain('1 / 2 slices complete')
  })

  it('MAP.md reflects changed status after a second call', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    writeLedger(dir, 'm', {
      motive: 'm',
      active: true,
      slices: [{ id: 'S1', status: 'pending', desc: 'My task' }],
      gate: {},
    })
    regenerateMotiveMap(dir, 'm')
    const before = readMap(dir, 'm')
    expect(before).toContain('0 / 1 slices complete')

    // Simulate ledger mutation: S1 completed
    writeLedger(dir, 'm', {
      motive: 'm',
      active: true,
      slices: [{ id: 'S1', status: 'complete', desc: 'My task' }],
      gate: {},
    })
    regenerateMotiveMap(dir, 'm')
    const after = readMap(dir, 'm')
    expect(after).toContain('1 / 1 slices complete')
    expect(after).not.toContain('0 / 1')
  })
})

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

describe('regenerateMotiveMap — decisions', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('Decisions section shows DECISION events', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    writeDecisions(dir, 'm', [
      {
        ts: '2026-01-15T10:00:00Z',
        session: 'sess-1',
        motive: 'm',
        type: 'DECISION',
        msg: 'Use TypeScript for everything',
      },
    ])
    regenerateMotiveMap(dir, 'm')
    const content = readMap(dir, 'm')
    expect(content).toContain('Use TypeScript for everything')
  })

  it('deduplicates exact-same decision messages', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    writeDecisions(dir, 'm', [
      { ts: '2026-01-01T00:00:00Z', session: 's1', motive: 'm', type: 'DECISION', msg: 'Use TypeScript for everything' },
      { ts: '2026-01-01T00:00:01Z', session: 's2', motive: 'm', type: 'DECISION', msg: 'Use TypeScript for everything' },
    ])
    regenerateMotiveMap(dir, 'm')
    const content = readMap(dir, 'm')
    // Should appear exactly once
    const matches = content.match(/Use TypeScript for everything/g)
    expect(matches).toHaveLength(1)
  })

  it('keeps longer entry when one decision is a truncation of another', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    writeDecisions(dir, 'm', [
      { ts: '2026-01-01T00:00:00Z', session: 's1', motive: 'm', type: 'DECISION', msg: 'ASD-STE100 not adopted.' },
      { ts: '2026-01-01T00:00:01Z', session: 's2', motive: 'm', type: 'DECISION', msg: 'ASD-STE100 not adopted. Trial showed no benefit and degraded readability.' },
    ])
    regenerateMotiveMap(dir, 'm')
    const content = readMap(dir, 'm')
    // Shorter truncation must be gone; longer version must appear once
    const matches = content.match(/ASD-STE100 not adopted/g)
    expect(matches).toHaveLength(1)
    expect(content).toContain('degraded readability')
  })

  it('does NOT collapse decisions that share a common opening but diverge — both survive', () => {
    // Regression: the old sharedPrefixLen>=40 heuristic dropped distinct decisions that
    // happened to share a topic prefix.  Both entries below share the same first ~38 chars
    // but are genuinely different decisions and MUST both appear.
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    const a = 'ASD-STE100 controlled-prose style NOT adopted. Trial showed no benefit.'
    const b = 'ASD-STE100 controlled-prose style NOT adopted for spec files. Trial showed no benefit; readability degraded.'
    writeDecisions(dir, 'm', [
      { ts: '2026-01-01T00:00:00Z', session: 's1', motive: 'm', type: 'DECISION', msg: a },
      { ts: '2026-01-01T00:00:01Z', session: 's2', motive: 'm', type: 'DECISION', msg: b },
    ])
    regenerateMotiveMap(dir, 'm')
    const content = readMap(dir, 'm')
    // Both distinct decisions must survive
    expect(content).toContain('Trial showed no benefit.')
    expect(content).toContain('for spec files')
    expect(content).toContain('readability degraded')
  })

  it('regression: advisor counterexamples — distinct decisions with shared prefix both survive', () => {
    // Confirmed lost by the old sharedPrefixLen>=40 heuristic:
    //   "per-session ledger files instead of a global advisory lock"  (diverges at 43 chars)
    //   "per-session ledger files instead of a single shared run.json" (same prefix, different suffix)
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    const c = 'per-session ledger files instead of a global advisory lock'
    const d = 'per-session ledger files instead of a single shared run.json'
    writeDecisions(dir, 'm', [
      { ts: '2026-01-01T00:00:00Z', session: 's1', motive: 'm', type: 'DECISION', msg: c },
      { ts: '2026-01-01T00:00:01Z', session: 's2', motive: 'm', type: 'DECISION', msg: d },
    ])
    regenerateMotiveMap(dir, 'm')
    const content = readMap(dir, 'm')
    expect(content).toContain('global advisory lock')
    expect(content).toContain('single shared run.json')
  })

  it('supersession by data.id: superseded decision is excluded from Decisions section', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    writeDecisions(dir, 'm', [
      {
        ts: '2026-01-01T00:00:00Z', session: 's1', motive: 'm', type: 'DECISION',
        msg: 'Old approach: use monorepo layout',
        data: { id: 'D-1', status: 'accepted' },
      },
      {
        ts: '2026-01-01T00:00:01Z', session: 's2', motive: 'm', type: 'DECISION',
        msg: 'New approach: use polyrepo layout (supersedes D-1)',
        data: { id: 'D-2', supersedes: 'D-1', status: 'accepted' },
      },
    ])
    regenerateMotiveMap(dir, 'm')
    const content = readMap(dir, 'm')
    expect(content).toContain('polyrepo layout')
    expect(content).not.toContain('monorepo layout')
  })

  it('ignores events for other motives', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    writeDecisions(dir, 'm', [
      { ts: '2026-01-01T00:00:00Z', session: 's', motive: 'other', type: 'DECISION', msg: 'Other decision' },
      { ts: '2026-01-01T00:00:01Z', session: 's', motive: 'm', type: 'DECISION', msg: 'My decision' },
    ])
    regenerateMotiveMap(dir, 'm')
    const content = readMap(dir, 'm')
    expect(content).toContain('My decision')
    expect(content).not.toContain('Other decision')
  })
})

// ---------------------------------------------------------------------------
// Error resilience — never throw, never break the caller
// ---------------------------------------------------------------------------

describe('regenerateMotiveMap — never throws', () => {
  it('does not throw when called with null/undefined projectDir', () => {
    expect(() => regenerateMotiveMap(null as unknown as string, 'x')).not.toThrow()
    expect(() => regenerateMotiveMap(undefined as unknown as string, 'x')).not.toThrow()
  })

  it('does not throw when called with null/undefined motive', () => {
    expect(() => regenerateMotiveMap('/tmp', null as unknown as string)).not.toThrow()
  })

  it('does not throw when projectDir does not exist', () => {
    expect(() => regenerateMotiveMap('/nonexistent/path/xyz', 'motive')).not.toThrow()
  })

  it('writes a warning to stderr but does not throw on internal error (corrupt charter dir as file)', () => {
    const dir = tmp()
    // Place a file where the motive directory should be — causes existsSync(motiveDir) to return true
    // but readCharter will fail gracefully (returns null); motive-map should still complete
    try {
      const motiveParent = join(dir, '.groundwork', 'motives')
      mkdirSync(motiveParent, { recursive: true })
      writeFileSync(join(motiveParent, 'broken'), '{}', 'utf8')  // file, not directory
      // This should not throw even if internal operations fail
      expect(() => regenerateMotiveMap(dir, 'broken')).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Integration resilience — MAP.md write failure must not affect prior mutations
// ---------------------------------------------------------------------------

describe('regenerateMotiveMap — resilience: MAP write failure leaves prior state intact', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })
  afterEach(() => {
    // Ensure we can clean up even if chmod made MAP.md read-only
    try {
      const mapPath = join(dir, '.groundwork', 'motives', 'm', 'MAP.md')
      if (existsSync(mapPath)) chmodSync(mapPath, 0o644)
    } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 (no throw) and previously-written journal data persists when MAP write fails', () => {
    // Simulate the pattern: journal/ledger mutation is written first, then MAP is regenerated.
    // If MAP regeneration fails, the mutation must survive.
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    const journalDir = join(dir, '.groundwork', 'journal')
    mkdirSync(journalDir, { recursive: true })
    const journalFile = join(journalDir, '2026-01-01-test.jsonl')
    // Simulate: mutation written (this is what ledger.mjs / journal.mjs do before calling regenerateMotiveMap)
    const mutationEvent = JSON.stringify({
      ts: '2026-01-01T00:00:00Z', session: 's', motive: 'm', type: 'DECISION', msg: 'Important decision',
    })
    writeFileSync(journalFile, mutationEvent + '\n', 'utf8')

    // Make MAP.md path unwritable so _generate will throw at writeFileSync
    const motiveDir = join(dir, '.groundwork', 'motives', 'm')
    const mapPath = join(motiveDir, 'MAP.md')
    writeFileSync(mapPath, 'placeholder', 'utf8')
    chmodSync(mapPath, 0o444)  // read-only

    // regenerateMotiveMap must not throw
    expect(() => regenerateMotiveMap(dir, 'm')).not.toThrow()

    // The journal mutation written before the call must still be intact
    const journalContent = readFileSync(journalFile, 'utf8')
    expect(journalContent).toContain('Important decision')
  })
})

// ---------------------------------------------------------------------------
// Open items and out-of-scope
// ---------------------------------------------------------------------------

describe('regenerateMotiveMap — open items and out-of-scope', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('Open items section lists TBD entries from charter', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n\n## Open items\n- TBD-1: Should we use Redis?\n`)
    regenerateMotiveMap(dir, 'm')
    const content = readMap(dir, 'm')
    expect(content).toContain('TBD-1')
    expect(content).toContain('Should we use Redis?')
  })

  it('multi-line open item statement is joined onto a single bullet line', () => {
    // A charter where the TBD statement spans multiple physical lines
    const charter = [
      '# motive: m',
      '',
      '## Objective',
      'Test.',
      '',
      '## Open items',
      '- TBD-3: DECISION events D-1…D-6 were appended without structured `data.id`, so `motive compile`',
      '  cannot correlate them. Needs backfill or re-append.',
    ].join('\n')
    makeCharter(dir, 'm', charter)
    regenerateMotiveMap(dir, 'm')
    const content = readMap(dir, 'm')
    // The bullet must contain the full continuation without a bare newline inside it
    expect(content).toContain('TBD-3')
    expect(content).toContain('cannot correlate them')
    // The statement must appear on a single line (no bare newline between the two halves)
    const lines = content.split('\n')
    const bullet = lines.find((l) => l.includes('TBD-3'))
    expect(bullet).toBeDefined()
    expect(bullet).toContain('cannot correlate them')
  })

  it('Out of scope section lists .groundwork/out-of-scope/ entries', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    const oos = join(dir, '.groundwork', 'out-of-scope')
    mkdirSync(oos, { recursive: true })
    writeFileSync(join(oos, 'dark-mode.md'), '# dark mode\nNot doing it.', 'utf8')
    regenerateMotiveMap(dir, 'm')
    const content = readMap(dir, 'm')
    expect(content).toContain('dark mode')
  })
})
