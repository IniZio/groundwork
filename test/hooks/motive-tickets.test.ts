// @verifies ARTIFACT-R-008
/**
 * Tests for hooks/lib/motive-tickets.mjs and the ticket integration in motive-map.mjs
 *
 * T4 ownership inversion:
 *   - tickets/ is agent/human-authored territory; this module NEVER writes there.
 *   - Open-item drill-downs move to open-items/ (sibling of tickets/).
 *   - Sweep is scoped to open-items/ only.
 *
 * Covers:
 *   - sanitizeId: valid ids, path-traversal guard
 *   - regenerateMotiveTickets: slices produce NO files (T4-AC2)
 *   - regenerateMotiveTickets: open-item drill-downs in open-items/ (T4-AC3)
 *   - regenerateMotiveTickets: tickets/ is never created or swept (T4-AC1, T4-AC4)
 *   - regenerateMotiveTickets: stale open-item files removed from open-items/ only
 *   - regenerateMotiveTickets: never throws (error resilience)
 *   - regenerateMotiveMap: tickets integration (MAP.md links unchanged — T5 scope)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sanitizeId, regenerateMotiveTickets } from '../../hooks/lib/motive-tickets.mjs'
import { regenerateMotiveMap } from '../../hooks/lib/motive-map.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmp() {
  return mkdtempSync(join(tmpdir(), 'motive-tickets-test-'))
}

function makeMotiveDir(dir: string, motive: string): string {
  const motiveDir = join(dir, '.groundwork', 'motives', motive)
  mkdirSync(motiveDir, { recursive: true })
  return motiveDir
}

function makeCharter(dir: string, motive: string, content: string) {
  const motiveDir = join(dir, '.groundwork', 'motives', motive)
  mkdirSync(motiveDir, { recursive: true })
  writeFileSync(join(motiveDir, 'motive.md'), content, 'utf8')
}

function writeLedger(dir: string, _motive: string, data: object) {
  const runsDir = join(dir, '.groundwork', 'runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(join(runsDir, `run-test.json`), JSON.stringify(data), 'utf8')
}

/** Read an open-item drill-down from open-items/ */
function readOpenItem(motiveDir: string, safeName: string): string {
  return readFileSync(join(motiveDir, 'open-items', `${safeName}.md`), 'utf8')
}

/** Check existence in open-items/ */
function openItemExists(motiveDir: string, safeName: string): boolean {
  return existsSync(join(motiveDir, 'open-items', `${safeName}.md`))
}

/** List files in open-items/ */
function listOpenItems(motiveDir: string): string[] {
  const dir = join(motiveDir, 'open-items')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.md'))
}

/** Check existence in tickets/ (must NOT be created by this module) */
function ticketExists(motiveDir: string, safeName: string): boolean {
  return existsSync(join(motiveDir, 'tickets', `${safeName}.md`))
}

// ---------------------------------------------------------------------------
// sanitizeId
// ---------------------------------------------------------------------------

describe('sanitizeId', () => {
  it('lowercases and preserves valid kebab ids', () => {
    expect(sanitizeId('map-autogen')).toBe('map-autogen')
    expect(sanitizeId('TBD-1')).toBe('tbd-1')
    expect(sanitizeId('S-ANCHOR')).toBe('s-anchor')
  })

  it('replaces invalid characters with hyphens', () => {
    expect(sanitizeId('foo bar')).toBe('foo-bar')
    expect(sanitizeId('foo:bar')).toBe('foo-bar')
  })

  it('collapses multiple hyphens', () => {
    expect(sanitizeId('foo--bar')).toBe('foo-bar')
    expect(sanitizeId('S1::io')).toBe('s1-io')
  })

  it('returns null for path-traversal ids', () => {
    expect(sanitizeId('../etc/passwd')).toBeNull()
    expect(sanitizeId('foo/bar')).toBeNull()
  })

  it('returns null for empty or non-string input', () => {
    expect(sanitizeId('')).toBeNull()
    expect(sanitizeId(null as unknown as string)).toBeNull()
    expect(sanitizeId(undefined as unknown as string)).toBeNull()
  })

  it('TBD-1 and TBD.1 produce the same stem (collision scenario)', () => {
    expect(sanitizeId('TBD-1')).toBe('tbd-1')
    expect(sanitizeId('TBD.1')).toBe('tbd-1')
  })
})

// ---------------------------------------------------------------------------
// T4-AC2 — slice inputs produce NO files anywhere
// ---------------------------------------------------------------------------

describe('regenerateMotiveTickets — slices produce no files (T4-AC2)', () => {
  let dir: string
  let motiveDir: string

  beforeEach(() => {
    dir = tmp()
    motiveDir = makeMotiveDir(dir, 'm')
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('creates NO ticket files for slices — tickets/ is not created', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [
        { id: 'S1', status: 'complete', desc: 'First task', wave: 1 },
        { id: 'S2', status: 'pending', desc: 'Second task', wave: 2 },
      ],
      openItems: [],
      events: [],
    })
    expect(existsSync(join(motiveDir, 'tickets'))).toBe(false)
  })

  it('slice ids do not appear in open-items/ either', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [
        { id: 'S1', status: 'pending', desc: 'Foo', wave: 3, kind: 'impl' },
      ],
      openItems: [],
      events: [],
    })
    expect(openItemExists(motiveDir, 's1')).toBe(false)
  })

  it('slice with acceptance criteria — no file created', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [{
        id: 'S1',
        status: 'complete',
        desc: 'Foo',
        acceptance: ['AC1 passes', 'AC2 passes'],
      }],
      openItems: [],
      events: [],
    })
    expect(existsSync(join(motiveDir, 'tickets'))).toBe(false)
  })

  it('slice with blocked_by — no file created', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [{ id: 'S2', status: 'pending', desc: 'Blocked', blocked_by: ['S1'] }],
      openItems: [],
      events: [],
    })
    expect(existsSync(join(motiveDir, 'tickets'))).toBe(false)
  })

  it('slice-related events do not produce files', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [{ id: 'S1', status: 'complete', desc: 'Foo' }],
      openItems: [],
      events: [
        { ts: '2026-01-01T00:00:00Z', type: 'TASK_COMPLETE', motive: 'm', data: { slice: 'S1' }, msg: 'done' },
      ],
    })
    expect(existsSync(join(motiveDir, 'tickets'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// T4-AC3 — open-item drill-downs go to open-items/
// ---------------------------------------------------------------------------

describe('regenerateMotiveTickets — open item drill-downs in open-items/ (T4-AC3)', () => {
  let dir: string
  let motiveDir: string

  beforeEach(() => {
    dir = tmp()
    motiveDir = makeMotiveDir(dir, 'm')
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('creates a drill-down file for each open item in open-items/', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [
        { id: 'TBD-1', kind: 'TBD', statement: 'Should we use Redis?' },
        { id: 'TBD-2', kind: 'TBD', statement: 'Naming convention?' },
      ],
      events: [],
    })
    expect(openItemExists(motiveDir, 'tbd-1')).toBe(true)
    expect(openItemExists(motiveDir, 'tbd-2')).toBe(true)
    // NOT in tickets/
    expect(ticketExists(motiveDir, 'tbd-1')).toBe(false)
    expect(ticketExists(motiveDir, 'tbd-2')).toBe(false)
  })

  it('open item drill-down contains id, statement, and kind', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [{ id: 'TBD-1', kind: 'TBD', statement: 'Should we use Redis?' }],
      events: [],
    })
    const content = readOpenItem(motiveDir, 'tbd-1')
    expect(content).toContain('TBD-1')
    expect(content).toContain('Should we use Redis?')
    expect(content).toContain('TBD')
  })

  it('open item drill-down shows blocked_by when set', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [{ id: 'TBD-2', kind: 'TBD', statement: 'Cache format?', blocked_by: 'TBD-1' }],
      events: [],
    })
    const content = readOpenItem(motiveDir, 'tbd-2')
    expect(content).toContain('Blocked by')
    expect(content).toContain('TBD-1')
  })

  it('open item drill-down shows related decisions when a DECISION event mentions the id', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [{ id: 'TBD-1', kind: 'TBD', statement: 'Use flat JSON?' }],
      events: [
        {
          ts: '2026-01-15T00:00:00Z',
          type: 'DECISION',
          motive: 'm',
          msg: 'TBD-1 resolved: use flat JSON',
          data: {},
        },
      ],
    })
    const content = readOpenItem(motiveDir, 'tbd-1')
    expect(content).toContain('## Related decisions')
    expect(content).toContain('use flat JSON')
  })

  it('open item status is "open" when present in open_items', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [{ id: 'TBD-1', kind: 'TBD', statement: 'Something?' }],
      events: [
        { ts: '2026-01-15T00:00:00Z', type: 'DECISION', motive: 'm', msg: 'TBD-1: decided', data: {} },
      ],
    })
    const content = readOpenItem(motiveDir, 'tbd-1')
    expect(content).toContain('**open**')
    expect(content).not.toContain('**resolved**')
  })

  it('open item with resolved_by is NOT written to open-items/ (resolved items are filtered out)', () => {
    // Pre-ticket-03: this used to write a drill-down and show "**resolved**" status.
    // Post-ticket-03: resolved items are filtered from the sweep entirely — no file written.
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [{ id: 'TBD-1', kind: 'TBD', statement: 'Something?', resolved_by: 'DEC-42' }],
      events: [],
    })
    expect(openItemExists(motiveDir, 'tbd-1')).toBe(false)
  })

  it('TBD-1 drill-down does NOT list a decision that only mentions TBD-12 (no substring match)', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [{ id: 'TBD-1', kind: 'TBD', statement: 'Something?' }],
      events: [
        {
          ts: '2026-01-20T00:00:00Z',
          type: 'DECISION',
          motive: 'm',
          msg: 'TBD-12 resolved: use postgres',
          data: {},
        },
      ],
    })
    const content = readOpenItem(motiveDir, 'tbd-1')
    expect(content).not.toContain('## Related decisions')
    expect(content).not.toContain('use postgres')
  })
})

// ---------------------------------------------------------------------------
// T4-AC4 — stale sweep hits open-items/ only; tickets/ never swept
// ---------------------------------------------------------------------------

describe('regenerateMotiveTickets — stale removal and update', () => {
  let dir: string
  let motiveDir: string

  beforeEach(() => {
    dir = tmp()
    motiveDir = makeMotiveDir(dir, 'm')
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('removes stale open-item files when TBD is removed from charter', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [
        { id: 'TBD-1', kind: 'TBD', statement: 'Question A' },
        { id: 'TBD-2', kind: 'TBD', statement: 'Question B' },
      ],
      events: [],
    })
    expect(openItemExists(motiveDir, 'tbd-1')).toBe(true)
    expect(openItemExists(motiveDir, 'tbd-2')).toBe(true)

    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [{ id: 'TBD-1', kind: 'TBD', statement: 'Question A' }],
      events: [],
    })
    expect(openItemExists(motiveDir, 'tbd-1')).toBe(true)
    expect(openItemExists(motiveDir, 'tbd-2')).toBe(false)
  })

  it('does NOT sweep tickets/ — hand-authored files survive even when matching id disappears', () => {
    const ticketsDir = join(motiveDir, 'tickets')
    mkdirSync(ticketsDir, { recursive: true })
    const handWritten = '# TBD-1\n\nHand authored content.\n'
    writeFileSync(join(ticketsDir, 'tbd-1.md'), handWritten, 'utf8')

    // Run with no open items (would sweep if tickets/ were in scope)
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [],
      events: [],
    })

    expect(readFileSync(join(ticketsDir, 'tbd-1.md'), 'utf8')).toBe(handWritten)
  })

  it('slices being removed does NOT delete anything from open-items/', () => {
    // Establish an open-item file
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [{ id: 'TBD-1', kind: 'TBD', statement: 'Keep me' }],
      events: [],
    })
    expect(openItemExists(motiveDir, 'tbd-1')).toBe(true)

    // Second call: slices change but open items unchanged
    regenerateMotiveTickets(motiveDir, {
      slices: [
        { id: 'S1', status: 'complete', desc: 'Done' },
        { id: 'S2', status: 'pending', desc: 'TODO' },
      ],
      openItems: [{ id: 'TBD-1', kind: 'TBD', statement: 'Keep me' }],
      events: [],
    })
    expect(openItemExists(motiveDir, 'tbd-1')).toBe(true)
    // slices produce no files
    expect(existsSync(join(motiveDir, 'tickets'))).toBe(false)
  })

  it('emits a stderr warning when two open-item ids collide on the same filename stem', () => {
    const stderrMessages: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    const spy = (msg: Parameters<typeof process.stderr.write>[0], ...args: Parameters<typeof process.stderr.write>[1][]) => {
      stderrMessages.push(String(msg))
      return (origWrite as (...a: Parameters<typeof process.stderr.write>) => boolean)(msg, ...args)
    }
    process.stderr.write = spy as typeof process.stderr.write
    try {
      regenerateMotiveTickets(motiveDir, {
        slices: [],
        openItems: [
          { id: 'TBD-1', kind: 'TBD', statement: 'First' },
          { id: 'TBD.1', kind: 'TBD', statement: 'Collision' },
        ],
        events: [],
      })
      const warned = stderrMessages.some((m) => m.includes('collision') && m.includes('tbd-1'))
      expect(warned).toBe(true)
    } finally {
      process.stderr.write = origWrite as typeof process.stderr.write
    }
  })

  it('is idempotent — calling twice with same inputs produces the same open-items/ files', () => {
    const opts = {
      slices: [{ id: 'S1', status: 'pending', desc: 'Foo' }],
      openItems: [{ id: 'TBD-1', kind: 'TBD', statement: 'Bar' }],
      events: [],
    }
    regenerateMotiveTickets(motiveDir, opts)
    const before = listOpenItems(motiveDir).sort()
    regenerateMotiveTickets(motiveDir, opts)
    const after = listOpenItems(motiveDir).sort()
    expect(after).toEqual(before)
    // tickets/ still absent
    expect(existsSync(join(motiveDir, 'tickets'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Error resilience — never throws
// ---------------------------------------------------------------------------

describe('regenerateMotiveTickets — error resilience', () => {
  it('never throws even with an invalid motiveDir', () => {
    expect(() =>
      regenerateMotiveTickets('/nonexistent/path/xyz/motive', {
        slices: [{ id: 'S1', status: 'pending', desc: 'Foo' }],
        openItems: [],
        events: [],
      }),
    ).not.toThrow()
  })

  it('skips open items with path-traversal ids without throwing', () => {
    const dir = tmp()
    const motiveDir = makeMotiveDir(dir, 'm')
    try {
      expect(() =>
        regenerateMotiveTickets(motiveDir, {
          slices: [{ id: '../evil', status: 'pending', desc: 'Bad' }],
          openItems: [{ id: '../evil', kind: 'TBD', statement: 'Bad' }],
          events: [],
        }),
      ).not.toThrow()
      // No files created in open-items/ for traversal ids
      expect(listOpenItems(motiveDir)).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// _renderOpenItemTicket — body rendering (statement vs detail section)
// ---------------------------------------------------------------------------

describe('open item drill-down — body rendering', () => {
  let dir: string
  let motiveDir: string

  beforeEach(() => {
    dir = tmp()
    motiveDir = makeMotiveDir(dir, 'm')
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('(a) title line contains the short handle, NOT the body text', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [
        {
          id: 'TBD-1',
          kind: 'TBD',
          statement: 'Choose a cache layer',
          body: 'We need to decide between Redis and Memcached given our latency budget.',
        },
      ],
      events: [],
    })
    const content = readOpenItem(motiveDir, 'tbd-1')
    const titleLine = content.split('\n')[0]
    expect(titleLine).toContain('Choose a cache layer')
    expect(titleLine).not.toContain('Redis')
    expect(titleLine).not.toContain('latency budget')
  })

  it('(b) body text appears in a section below the title when body is present', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [
        {
          id: 'TBD-2',
          kind: 'TBD',
          statement: 'Pick a serialisation format',
          body: 'Options are JSON, MessagePack, and Protobuf. See ADR-3.',
        },
      ],
      events: [],
    })
    const content = readOpenItem(motiveDir, 'tbd-2')
    const titleLine = content.split('\n')[0]
    // body must NOT be in the title
    expect(titleLine).not.toContain('MessagePack')
    // body must appear somewhere after the title
    const bodyIndex = content.indexOf('MessagePack')
    const titleEnd = content.indexOf('\n')
    expect(bodyIndex).toBeGreaterThan(titleEnd)
  })

  it('(c) a body-less item renders with no empty body section between the title and ## Status', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [
        { id: 'TBD-3', kind: 'TBD', statement: 'Single-line question?' },
      ],
      events: [],
    })
    const content = readOpenItem(motiveDir, 'tbd-3')
    // The Status heading must still be present
    expect(content).toContain('## Status')
    // No dangling empty-body content between title and Status
    const titleEnd = content.indexOf('\n')
    const statusIdx = content.indexOf('## Status')
    const between = content.slice(titleEnd, statusIdx)
    // Between title and Status there should be only blank lines (no prose body)
    expect(between.trim()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Integration: regenerateMotiveMap — MAP.md links (T5 scope; MAP text unchanged)
// ---------------------------------------------------------------------------

describe('regenerateMotiveMap — tickets integration', () => {
  let dir: string

  beforeEach(() => { dir = tmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('does NOT create tickets/ directory for slices; open-items/ created for open items', () => {
    makeCharter(dir, 'm', [
      '# motive: m',
      '',
      '## Objective',
      'Test.',
      '',
      '## Open items',
      '- TBD-1: Should we use Redis?',
    ].join('\n'))
    writeLedger(dir, 'm', {
      motive: 'm',
      active: true,
      slices: [{ id: 'S1', status: 'pending', desc: 'First task', blocked_by: [] }],
      gate: {},
    })

    regenerateMotiveMap(dir, 'm')

    const motiveDir = join(dir, '.groundwork', 'motives', 'm')
    // tickets/ must NOT be created by ticket generation machinery
    expect(ticketExists(motiveDir, 's1')).toBe(false)
    // open-items/ created for TBD-1
    expect(openItemExists(motiveDir, 'tbd-1')).toBe(true)
  })

  it('MAP.md Frontier section renders slice ids as bold when no ticket ref', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    writeLedger(dir, 'm', {
      motive: 'm',
      active: true,
      slices: [{ id: 'S1', status: 'pending', desc: 'My task', blocked_by: [] }],
      gate: {},
    })

    regenerateMotiveMap(dir, 'm')
    const map = readFileSync(join(dir, '.groundwork', 'motives', 'm', 'MAP.md'), 'utf8')

    // No ticket ref on slice → rendered as bold, not a link to tickets/
    expect(map).toContain('**S1**')
    expect(map).not.toContain('[S1](tickets/')
  })

  it('MAP.md Open items section links TBD ids to ticket files', () => {
    makeCharter(dir, 'm', [
      '# motive: m',
      '',
      '## Objective',
      'Test.',
      '',
      '## Open items',
      '- TBD-1: Should we use Redis?',
    ].join('\n'))

    regenerateMotiveMap(dir, 'm')
    const map = readFileSync(join(dir, '.groundwork', 'motives', 'm', 'MAP.md'), 'utf8')

    expect(map).toContain('[TBD-1](open-items/tbd-1.md)')
  })

  it('MAP.md In progress section renders in-progress slice ids as bold when no ticket ref', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    writeLedger(dir, 'm', {
      motive: 'm',
      active: true,
      slices: [{ id: 'WIP-1', status: 'in_progress', desc: 'Active work' }],
      gate: {},
    })

    regenerateMotiveMap(dir, 'm')
    const map = readFileSync(join(dir, '.groundwork', 'motives', 'm', 'MAP.md'), 'utf8')

    expect(map).toContain('**WIP-1**')
    expect(map).not.toContain('[WIP-1](tickets/')
  })

  it('MAP.md Progress section links completed slice tickets', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    writeLedger(dir, 'm', {
      motive: 'm',
      active: true,
      slices: [
        { id: 'S1', status: 'complete', desc: 'Done task' },
        { id: 'S2', status: 'pending', desc: 'Pending task' },
      ],
      gate: {},
    })

    regenerateMotiveMap(dir, 'm')
    const map = readFileSync(join(dir, '.groundwork', 'motives', 'm', 'MAP.md'), 'utf8')

    expect(map).toContain('## Progress')
    expect(map).toContain('**S1**')
    expect(map).not.toContain('[S1](tickets/')
    expect(map).not.toMatch(/✓.*\[S2\]/)
  })

  it('second regeneration with fewer slices: no ticket files affected in tickets/', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    writeLedger(dir, 'm', {
      motive: 'm',
      active: true,
      slices: [
        { id: 'S1', status: 'complete', desc: 'Done' },
        { id: 'S2', status: 'pending', desc: 'TODO' },
      ],
      gate: {},
    })
    regenerateMotiveMap(dir, 'm')

    const motiveDir = join(dir, '.groundwork', 'motives', 'm')
    // tickets/ should NOT exist at all — slices don't write there
    expect(existsSync(join(motiveDir, 'tickets'))).toBe(false)

    // S2 removed
    writeLedger(dir, 'm', {
      motive: 'm',
      active: true,
      slices: [{ id: 'S1', status: 'complete', desc: 'Done' }],
      gate: {},
    })
    regenerateMotiveMap(dir, 'm')

    // Still no tickets/
    expect(existsSync(join(motiveDir, 'tickets'))).toBe(false)
  })

  // SC3 / T5-AC3 — every relative link emitted in MAP.md resolves to a file that regeneration writes
  it('SC3 T5-AC3: every relative markdown link in MAP.md resolves to an existing file', () => {
    makeCharter(dir, 'm', [
      '# motive: m',
      '',
      '## Objective',
      'Test.',
      '',
      '## Open items',
      '- TBD-1: Should we use Redis?',
      '- TBD-2: Pick a format?',
    ].join('\n'))
    writeLedger(dir, 'm', {
      motive: 'm',
      active: true,
      slices: [
        { id: 'S1', status: 'pending', desc: 'Frontier task', blocked_by: [] },
        { id: 'S2', status: 'in_progress', desc: 'Active work' },
        { id: 'S3', status: 'complete', desc: 'Done' },
      ],
      gate: {},
    })

    regenerateMotiveMap(dir, 'm')

    const motiveDir = join(dir, '.groundwork', 'motives', 'm')
    const map = readFileSync(join(motiveDir, 'MAP.md'), 'utf8')

    // Extract all relative markdown link targets: [text](target)
    // Skip anchors (#) and absolute URLs (http/https)
    const linkRe = /\]\(([^)]+)\)/g
    const broken: string[] = []
    let m: RegExpExecArray | null
    while ((m = linkRe.exec(map)) !== null) {
      const target = m[1]
      if (target.startsWith('#') || /^https?:\/\//.test(target)) continue
      const resolved = join(motiveDir, target)
      if (!existsSync(resolved)) broken.push(target)
    }

    expect(broken).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Ticket-03 regression — resolved items (resolved_by set) must not render
// ---------------------------------------------------------------------------

describe('resolved_by filter — resolved items absent from MAP and drill-down', () => {
  let dir: string
  let motiveDir: string

  beforeEach(() => {
    dir = tmp()
    motiveDir = makeMotiveDir(dir, 'm')
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('drill-down: resolved item produces no file; open item produces a file', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [
        { id: 'TBD-1', kind: 'TBD', statement: 'Still open question' },
        { id: 'TBD-2', kind: 'TBD', statement: 'Resolved question', resolved_by: 'D-99' },
      ],
      events: [],
    })
    expect(openItemExists(motiveDir, 'tbd-1')).toBe(true)
    expect(openItemExists(motiveDir, 'tbd-2')).toBe(false)
  })

  it('MAP: resolved item absent from ## Open items; open item present', () => {
    makeCharter(dir, 'm', [
      '# motive: m',
      '',
      '## Objective',
      'Test.',
      '',
      '## Open items',
      '- TBD-1: Still open question',
      '- TBD-2: Resolved question',
    ].join('\n'))

    // Write an accepted DECISION journal event resolving TBD-2.
    // Journal shards live at .groundwork/journal/ (project-level), not motive-level.
    const journalDir = join(dir, '.groundwork', 'journal')
    mkdirSync(journalDir, { recursive: true })
    writeFileSync(join(journalDir, '2026-01-01-test.jsonl'), [
      JSON.stringify({ ts: '2026-01-01T00:00:00Z', session: 'test', motive: 'm', type: 'DECISION', msg: 'resolve TBD-2', source: 'cli:journal', data: { id: 'D-99', status: 'accepted', resolves: 'TBD-2' } }),
    ].join('\n') + '\n', 'utf8')

    regenerateMotiveMap(dir, 'm')

    const map = readFileSync(join(motiveDir, 'MAP.md'), 'utf8')
    // Extract only the ## Open items section for targeted assertion
    const openSection = map.split(/^## /m).find((s) => s.startsWith('Open items')) ?? ''
    expect(openSection).toContain('TBD-1')
    expect(openSection).not.toContain('TBD-2')
  })

  it('drill-down: stale file for a now-resolved item is swept on next regeneration', () => {
    // First pass: both items unresolved → both files created
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [
        { id: 'TBD-1', kind: 'TBD', statement: 'Still open' },
        { id: 'TBD-2', kind: 'TBD', statement: 'About to be resolved' },
      ],
      events: [],
    })
    expect(openItemExists(motiveDir, 'tbd-1')).toBe(true)
    expect(openItemExists(motiveDir, 'tbd-2')).toBe(true)

    // Second pass: TBD-2 is now resolved → its file must be removed
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [
        { id: 'TBD-1', kind: 'TBD', statement: 'Still open' },
        { id: 'TBD-2', kind: 'TBD', statement: 'About to be resolved', resolved_by: 'D-99' },
      ],
      events: [],
    })
    expect(openItemExists(motiveDir, 'tbd-1')).toBe(true)
    expect(openItemExists(motiveDir, 'tbd-2')).toBe(false)
  })
})
