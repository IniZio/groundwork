/**
 * Tests for hooks/lib/motive-tickets.mjs and the ticket integration in motive-map.mjs
 *
 * Covers:
 *   - sanitizeId: valid ids, path-traversal guard
 *   - regenerateMotiveTickets: creates slice tickets, creates open-item tickets
 *   - regenerateMotiveTickets: updates tickets on second call
 *   - regenerateMotiveTickets: removes stale ticket files
 *   - regenerateMotiveTickets: never throws (error resilience)
 *   - regenerateMotiveMap: tickets/ created alongside MAP.md
 *   - MAP.md: ids are links to ticket files
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

function writeLedger(dir: string, motive: string, data: object) {
  const runsDir = join(dir, '.groundwork', 'runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(join(runsDir, `run-test.json`), JSON.stringify(data), 'utf8')
}

function readTicket(motiveDir: string, safeName: string): string {
  return readFileSync(join(motiveDir, 'tickets', `${safeName}.md`), 'utf8')
}

function ticketExists(motiveDir: string, safeName: string): boolean {
  return existsSync(join(motiveDir, 'tickets', `${safeName}.md`))
}

function listTickets(motiveDir: string): string[] {
  const dir = join(motiveDir, 'tickets')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.md'))
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
    // Both sanitize to "tbd-1" — the implementation should emit a warning and not crash
    expect(sanitizeId('TBD-1')).toBe('tbd-1')
    expect(sanitizeId('TBD.1')).toBe('tbd-1')
  })
})

// ---------------------------------------------------------------------------
// regenerateMotiveTickets — slice tickets
// ---------------------------------------------------------------------------

describe('regenerateMotiveTickets — slice tickets', () => {
  let dir: string
  let motiveDir: string

  beforeEach(() => {
    dir = tmp()
    motiveDir = makeMotiveDir(dir, 'm')
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('creates a ticket file for each slice', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [
        { id: 'S1', status: 'complete', desc: 'First task', wave: 1 },
        { id: 'S2', status: 'pending', desc: 'Second task', wave: 2 },
      ],
      openItems: [],
      events: [],
    })
    expect(ticketExists(motiveDir, 's1')).toBe(true)
    expect(ticketExists(motiveDir, 's2')).toBe(true)
  })

  it('slice ticket contains id, description, and status', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [{ id: 'S1', status: 'complete', desc: 'Build the thing', wave: 1 }],
      openItems: [],
      events: [],
    })
    const content = readTicket(motiveDir, 's1')
    expect(content).toContain('S1')
    expect(content).toContain('Build the thing')
    expect(content).toContain('complete')
  })

  it('slice ticket shows wave and kind in Details', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [{ id: 'S1', status: 'pending', desc: 'Foo', wave: 3, kind: 'impl' }],
      openItems: [],
      events: [],
    })
    const content = readTicket(motiveDir, 's1')
    expect(content).toContain('**Wave:** 3')
    expect(content).toContain('**Kind:** impl')
  })

  it('slice ticket lists acceptance criteria as checklist (checked when complete)', () => {
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
    const content = readTicket(motiveDir, 's1')
    expect(content).toContain('[x] AC1 passes')
    expect(content).toContain('[x] AC2 passes')
  })

  it('acceptance criteria unchecked when status is not complete', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [{
        id: 'S1',
        status: 'pending',
        desc: 'Foo',
        acceptance: ['AC1 passes'],
      }],
      openItems: [],
      events: [],
    })
    const content = readTicket(motiveDir, 's1')
    expect(content).toContain('[ ] AC1 passes')
  })

  it('status line says "blocked by" when blocked_by is set', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [{ id: 'S2', status: 'pending', desc: 'Blocked', blocked_by: ['S1'] }],
      openItems: [],
      events: [],
    })
    const content = readTicket(motiveDir, 's2')
    expect(content).toContain('blocked')
    expect(content).toContain('S1')
  })

  it('status line says "ready" when not blocked and not in progress', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [{ id: 'S1', status: 'pending', desc: 'Ready', blocked_by: [] }],
      openItems: [],
      events: [],
    })
    const content = readTicket(motiveDir, 's1')
    expect(content).toContain('ready')
  })

  it('includes related events (TASK_COMPLETE) in Related events section', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [{ id: 'S1', status: 'complete', desc: 'Foo' }],
      openItems: [],
      events: [
        { ts: '2026-01-01T00:00:00Z', type: 'TASK_COMPLETE', motive: 'm', data: { slice: 'S1' }, msg: 'done' },
        { ts: '2026-01-01T00:00:00Z', type: 'TASK_COMPLETE', motive: 'm', data: { slice: 'S2' }, msg: 'other done' },
      ],
    })
    const content = readTicket(motiveDir, 's1')
    expect(content).toContain('## Related events')
    expect(content).toContain('TASK_COMPLETE')
    expect(content).not.toContain('other done')
  })

  it('ticket has auto-generated footer', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [{ id: 'S1', status: 'pending', desc: 'Foo' }],
      openItems: [],
      events: [],
    })
    const content = readTicket(motiveDir, 's1')
    expect(content).toContain('Auto-generated')
  })
})

// ---------------------------------------------------------------------------
// regenerateMotiveTickets — open item tickets
// ---------------------------------------------------------------------------

describe('regenerateMotiveTickets — open item tickets', () => {
  let dir: string
  let motiveDir: string

  beforeEach(() => {
    dir = tmp()
    motiveDir = makeMotiveDir(dir, 'm')
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('creates a ticket file for each open item', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [
        { id: 'TBD-1', kind: 'TBD', statement: 'Should we use Redis?' },
        { id: 'TBD-2', kind: 'TBD', statement: 'Naming convention?' },
      ],
      events: [],
    })
    expect(ticketExists(motiveDir, 'tbd-1')).toBe(true)
    expect(ticketExists(motiveDir, 'tbd-2')).toBe(true)
  })

  it('open item ticket contains id, statement, and kind', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [{ id: 'TBD-1', kind: 'TBD', statement: 'Should we use Redis?' }],
      events: [],
    })
    const content = readTicket(motiveDir, 'tbd-1')
    expect(content).toContain('TBD-1')
    expect(content).toContain('Should we use Redis?')
    expect(content).toContain('TBD')
  })

  it('open item ticket shows blocked_by when set', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [{ id: 'TBD-2', kind: 'TBD', statement: 'Cache format?', blocked_by: 'TBD-1' }],
      events: [],
    })
    const content = readTicket(motiveDir, 'tbd-2')
    expect(content).toContain('Blocked by')
    expect(content).toContain('TBD-1')
  })

  it('open item ticket shows related decisions when a DECISION event mentions the id', () => {
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
    const content = readTicket(motiveDir, 'tbd-1')
    expect(content).toContain('## Related decisions')
    expect(content).toContain('use flat JSON')
  })

  it('open item status is "open" when item is present in open_items, even if decisions mention it', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [{ id: 'TBD-1', kind: 'TBD', statement: 'Something?' }],
      events: [
        { ts: '2026-01-15T00:00:00Z', type: 'DECISION', motive: 'm', msg: 'TBD-1: decided', data: {} },
      ],
    })
    const content = readTicket(motiveDir, 'tbd-1')
    // Status is sourced from charter membership — open_items presence means open
    expect(content).toContain('**open**')
    expect(content).not.toContain('**resolved**')
  })

  it('open item status is "resolved" when item has resolved_by field', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [{ id: 'TBD-1', kind: 'TBD', statement: 'Something?', resolved_by: 'DEC-42' }],
      events: [],
    })
    const content = readTicket(motiveDir, 'tbd-1')
    expect(content).toContain('**resolved**')
    expect(content).toContain('DEC-42')
  })

  it('TBD-1 ticket does NOT list a decision that only mentions TBD-12 (no substring match)', () => {
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
    const content = readTicket(motiveDir, 'tbd-1')
    expect(content).not.toContain('## Related decisions')
    expect(content).not.toContain('use postgres')
  })
})

// ---------------------------------------------------------------------------
// regenerateMotiveTickets — stale removal + idempotency
// ---------------------------------------------------------------------------

describe('regenerateMotiveTickets — stale removal and update', () => {
  let dir: string
  let motiveDir: string

  beforeEach(() => {
    dir = tmp()
    motiveDir = makeMotiveDir(dir, 'm')
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('removes stale ticket files when slice is removed', () => {
    // First call: S1 and S2
    regenerateMotiveTickets(motiveDir, {
      slices: [
        { id: 'S1', status: 'complete', desc: 'Done' },
        { id: 'S2', status: 'pending', desc: 'TODO' },
      ],
      openItems: [],
      events: [],
    })
    expect(ticketExists(motiveDir, 's1')).toBe(true)
    expect(ticketExists(motiveDir, 's2')).toBe(true)

    // Second call: only S1 remains
    regenerateMotiveTickets(motiveDir, {
      slices: [{ id: 'S1', status: 'complete', desc: 'Done' }],
      openItems: [],
      events: [],
    })
    expect(ticketExists(motiveDir, 's1')).toBe(true)
    expect(ticketExists(motiveDir, 's2')).toBe(false)
  })

  it('updates ticket content when slice status changes', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [{ id: 'S1', status: 'pending', desc: 'My task' }],
      openItems: [],
      events: [],
    })
    expect(readTicket(motiveDir, 's1')).toContain('ready')

    regenerateMotiveTickets(motiveDir, {
      slices: [{ id: 'S1', status: 'complete', desc: 'My task' }],
      openItems: [],
      events: [],
    })
    expect(readTicket(motiveDir, 's1')).toContain('complete')
    expect(readTicket(motiveDir, 's1')).not.toContain('ready')
  })

  it('removes stale open item tickets when TBD is removed', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [
        { id: 'TBD-1', kind: 'TBD', statement: 'Question A' },
        { id: 'TBD-2', kind: 'TBD', statement: 'Question B' },
      ],
      events: [],
    })
    expect(ticketExists(motiveDir, 'tbd-1')).toBe(true)
    expect(ticketExists(motiveDir, 'tbd-2')).toBe(true)

    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [{ id: 'TBD-1', kind: 'TBD', statement: 'Question A' }],
      events: [],
    })
    expect(ticketExists(motiveDir, 'tbd-1')).toBe(true)
    expect(ticketExists(motiveDir, 'tbd-2')).toBe(false)
  })

  it('emits a stderr warning when two ids collide on the same filename stem', () => {
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

  it('is idempotent — calling twice produces the same files', () => {
    const opts = {
      slices: [{ id: 'S1', status: 'pending', desc: 'Foo' }],
      openItems: [{ id: 'TBD-1', kind: 'TBD', statement: 'Bar' }],
      events: [],
    }
    regenerateMotiveTickets(motiveDir, opts)
    const before = listTickets(motiveDir).sort()
    regenerateMotiveTickets(motiveDir, opts)
    const after = listTickets(motiveDir).sort()
    expect(after).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// regenerateMotiveTickets — error resilience
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

  it('skips slices with path-traversal ids without throwing', () => {
    const dir = tmp()
    const motiveDir = makeMotiveDir(dir, 'm')
    try {
      expect(() =>
        regenerateMotiveTickets(motiveDir, {
          slices: [{ id: '../evil', status: 'pending', desc: 'Bad' }],
          openItems: [],
          events: [],
        }),
      ).not.toThrow()
      // No file should be created outside the tickets/ dir
      expect(listTickets(motiveDir)).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Integration: regenerateMotiveMap creates tickets/ and links MAP.md ids
// ---------------------------------------------------------------------------

describe('regenerateMotiveMap — tickets integration', () => {
  let dir: string

  beforeEach(() => { dir = tmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('creates tickets/ directory with slice and open item tickets', () => {
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
    expect(existsSync(join(motiveDir, 'tickets'))).toBe(true)
    expect(ticketExists(motiveDir, 's1')).toBe(true)
    expect(ticketExists(motiveDir, 'tbd-1')).toBe(true)
  })

  it('MAP.md Frontier section links slice ids to ticket files', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    writeLedger(dir, 'm', {
      motive: 'm',
      active: true,
      slices: [{ id: 'S1', status: 'pending', desc: 'My task', blocked_by: [] }],
      gate: {},
    })

    regenerateMotiveMap(dir, 'm')
    const map = readFileSync(join(dir, '.groundwork', 'motives', 'm', 'MAP.md'), 'utf8')

    // Should contain a Markdown link, not just bold text
    expect(map).toContain('[S1](tickets/s1.md)')
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

    expect(map).toContain('[TBD-1](tickets/tbd-1.md)')
  })

  it('MAP.md In progress section links in-progress slice ids', () => {
    makeCharter(dir, 'm', `# motive: m\n\n## Objective\nTest.\n`)
    writeLedger(dir, 'm', {
      motive: 'm',
      active: true,
      slices: [{ id: 'WIP-1', status: 'in_progress', desc: 'Active work' }],
      gate: {},
    })

    regenerateMotiveMap(dir, 'm')
    const map = readFileSync(join(dir, '.groundwork', 'motives', 'm', 'MAP.md'), 'utf8')

    expect(map).toContain('[WIP-1](tickets/wip-1.md)')
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

    // Progress must link completed slices
    expect(map).toContain('## Progress')
    expect(map).toContain('[S1](tickets/s1.md)')
    // Pending slice NOT in the completed list
    expect(map).not.toMatch(/✓.*\[S2\]/)
  })

  it('stale tickets are removed when slice is removed after second regeneration', () => {
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
    expect(ticketExists(motiveDir, 's2')).toBe(true)

    // S2 removed
    writeLedger(dir, 'm', {
      motive: 'm',
      active: true,
      slices: [{ id: 'S1', status: 'complete', desc: 'Done' }],
      gate: {},
    })
    regenerateMotiveMap(dir, 'm')

    expect(ticketExists(motiveDir, 's1')).toBe(true)
    expect(ticketExists(motiveDir, 's2')).toBe(false)
  })
})
