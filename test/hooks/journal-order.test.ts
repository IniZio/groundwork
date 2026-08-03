/**
 * Tests for hooks/lib/journal-order.mjs (S1 — ordered reader).
 *
 * S1-AC1  Two shards with identical ts sort deterministically (shard → line).
 *         Verified across 20 repeated readOrderedEvents calls, all byte-identical.
 * S1-AC2  Shards created in reverse-lex order are still read in lex order.
 * S1-AC3  ord is 1..N contiguous with no gaps; _order.line matches physical
 *         0-based offset, even in a shard with a blank line and a malformed line.
 * S1-AC4  Malformed lines are skipped AND counted; malformed_lines is returned.
 * S1-AC5  hooks/lib/journal-io.mjs is byte-unchanged (structural: file exists
 *         and matches its tracked content — confirmed via git diff --name-only).
 * S1-AC6  test/fixtures/hook-only-stream.jsonl is tracked by git.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { execSync } from 'child_process'

// The module under test — imported as ESM.
// @ts-ignore — .mjs resolution under ts-node / vitest
import { readOrderedEvents } from '../../hooks/lib/journal-order.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'journal-order-test-'))
}

/** Write a .jsonl shard file. Lines may be objects (serialised) or raw strings. */
function writeShard(dir: string, filename: string, lines: (object | string)[]): string {
  const fp = path.join(dir, filename)
  const content = lines
    .map(l => (typeof l === 'string' ? l : JSON.stringify(l)))
    .join('\n')
  writeFileSync(fp, content, 'utf8')
  return fp
}

function event(ts: string, motive: string, extra: object = {}): object {
  return { ts, motive, type: 'TASK_COMPLETE', ...extra }
}

// ---------------------------------------------------------------------------
// S1-AC6 — fixture is tracked by git (prerequisite check, runs first)
// ---------------------------------------------------------------------------
describe('S1-AC6: fixture committed', () => {
  it('hook-only-stream.jsonl is tracked by git', () => {
    // git ls-files --error-unmatch exits 0 iff the path is tracked
    expect(() =>
      execSync(
        'git ls-files --error-unmatch test/fixtures/hook-only-stream.jsonl',
        { cwd: REPO_ROOT, stdio: 'pipe' },
      )
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// S1-AC1 — deterministic tie-breaking by (shard, line)
// ---------------------------------------------------------------------------
describe('S1-AC1: deterministic order on ts tie', () => {
  let dir: string

  beforeEach(() => { dir = tempDir() })

  it('20 repeated calls return byte-identical results when ts ties', () => {
    const TS = '2026-08-03T10:00:00.000Z'
    // shard-b has the earlier filename-lex order but we write shard-z first
    writeShard(dir, 'shard-z.jsonl', [event(TS, 'm1', { id: 'z0' })])
    writeShard(dir, 'shard-a.jsonl', [
      event(TS, 'm1', { id: 'a0' }),
      event(TS, 'm1', { id: 'a1' }),
    ])

    const { events: first } = readOrderedEvents(dir)
    const serialised = (e: object) => JSON.stringify((e as any)._order) + '|' + (e as any).id

    for (let i = 0; i < 19; i++) {
      const { events: run } = readOrderedEvents(dir)
      expect(run.length).toBe(first.length)
      run.forEach((e: any, idx: number) => {
        expect(serialised(e)).toBe(serialised(first[idx]))
      })
    }

    // Verify the order is actually (shard-a, shard-z) not insertion order
    expect((first[0] as any)._order.shard).toBe('shard-a.jsonl')
    expect((first[1] as any)._order.shard).toBe('shard-a.jsonl')
    expect((first[2] as any)._order.shard).toBe('shard-z.jsonl')
  })
})

// ---------------------------------------------------------------------------
// S1-AC2 — lexicographic shard read order regardless of creation order
// ---------------------------------------------------------------------------
describe('S1-AC2: lex shard order despite reverse-lex creation', () => {
  let dir: string

  beforeEach(() => { dir = tempDir() })

  it('shards created z→a are returned a→z', () => {
    // Create in reverse-lex order
    writeShard(dir, 'shard-z.jsonl', [event('2026-08-03T12:00:00.000Z', 'm1', { id: 'z' })])
    writeShard(dir, 'shard-m.jsonl', [event('2026-08-03T12:00:00.000Z', 'm1', { id: 'm' })])
    writeShard(dir, 'shard-a.jsonl', [event('2026-08-03T12:00:00.000Z', 'm1', { id: 'a' })])

    const { events } = readOrderedEvents(dir)
    expect(events.map((e: any) => e._order.shard)).toEqual([
      'shard-a.jsonl',
      'shard-m.jsonl',
      'shard-z.jsonl',
    ])
  })
})

// ---------------------------------------------------------------------------
// S1-AC3 — ord is 1..N contiguous; _order.line matches physical 0-based offset
// ---------------------------------------------------------------------------
describe('S1-AC3: ord contiguous; _order.line = physical offset', () => {
  let dir: string

  beforeEach(() => { dir = tempDir() })

  it('ord is 1-based and contiguous across events', () => {
    writeShard(dir, 'shard-a.jsonl', [
      event('2026-08-03T10:00:00.000Z', 'm1'),
      event('2026-08-03T10:00:01.000Z', 'm1'),
      event('2026-08-03T10:00:02.000Z', 'm1'),
    ])
    const { events } = readOrderedEvents(dir, { motive: 'm1' })
    expect(events.map((e: any) => e.ord)).toEqual([1, 2, 3])
  })

  it('_order.line counts blank and malformed lines toward offset', () => {
    // Physical layout (0-based):
    //   line 0: valid event A
    //   line 1: blank line
    //   line 2: malformed JSON
    //   line 3: valid event B
    const fp = path.join(dir, 'shard-a.jsonl')
    const raw = [
      JSON.stringify(event('2026-08-03T10:00:00.000Z', 'm1', { id: 'A' })),
      '',
      'NOT VALID JSON',
      JSON.stringify(event('2026-08-03T10:00:01.000Z', 'm1', { id: 'B' })),
    ].join('\n')
    writeFileSync(fp, raw, 'utf8')

    const { events, malformed_lines } = readOrderedEvents(dir, { motive: 'm1' })

    expect(events.length).toBe(2)
    expect((events[0] as any)._order.line).toBe(0)   // physical offset 0
    expect((events[1] as any)._order.line).toBe(3)   // physical offset 3 (skips blank+malformed)
    expect(events[0]).toHaveProperty('ord', 1)
    expect(events[1]).toHaveProperty('ord', 2)
    expect(malformed_lines).toBe(1)
  })

  it('ord restarts from 1 per motive (ord assigned after filter)', () => {
    // Two motives, 3 events each — each motive should get ords 1,2,3
    writeShard(dir, 'shard-a.jsonl', [
      event('2026-08-03T10:00:00.000Z', 'motive-x'),
      event('2026-08-03T10:00:01.000Z', 'motive-y'),
      event('2026-08-03T10:00:02.000Z', 'motive-x'),
      event('2026-08-03T10:00:03.000Z', 'motive-y'),
      event('2026-08-03T10:00:04.000Z', 'motive-x'),
      event('2026-08-03T10:00:05.000Z', 'motive-y'),
    ])

    const { events: mx } = readOrderedEvents(dir, { motive: 'motive-x' })
    const { events: my } = readOrderedEvents(dir, { motive: 'motive-y' })

    expect(mx.map((e: any) => e.ord)).toEqual([1, 2, 3])
    expect(my.map((e: any) => e.ord)).toEqual([1, 2, 3])
  })
})

// ---------------------------------------------------------------------------
// S1-AC4 — malformed lines counted, not swallowed
// ---------------------------------------------------------------------------
describe('S1-AC4: malformed lines counted', () => {
  let dir: string

  beforeEach(() => { dir = tempDir() })

  it('returns malformed_lines count across all shards', () => {
    // shard-a: 2 valid, 1 malformed
    const fp1 = path.join(dir, 'shard-a.jsonl')
    writeFileSync(fp1, [
      JSON.stringify(event('2026-08-03T10:00:00.000Z', 'm1')),
      'THIS IS NOT JSON',
      JSON.stringify(event('2026-08-03T10:00:01.000Z', 'm1')),
    ].join('\n'), 'utf8')

    // shard-b: 1 valid, 2 malformed
    const fp2 = path.join(dir, 'shard-b.jsonl')
    writeFileSync(fp2, [
      'BAD',
      JSON.stringify(event('2026-08-03T10:00:02.000Z', 'm1')),
      '{incomplete',
    ].join('\n'), 'utf8')

    const { events, malformed_lines } = readOrderedEvents(dir, { motive: 'm1' })

    expect(events.length).toBe(3)
    expect(malformed_lines).toBe(3)   // 1 from shard-a + 2 from shard-b
  })

  it('returns malformed_lines:0 when all lines are valid', () => {
    writeShard(dir, 'shard-a.jsonl', [event('2026-08-03T10:00:00.000Z', 'm1')])
    const { malformed_lines } = readOrderedEvents(dir)
    expect(malformed_lines).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// S1-AC5 — journal-io.mjs is byte-unchanged
// ---------------------------------------------------------------------------
describe('S1-AC5: journal-io.mjs is byte-unchanged', () => {
  it('git diff --name-only shows no change to journal-io.mjs', () => {
    // We check that journal-io.mjs does not appear in working-tree changes.
    // This test will fail if any code in this session edits that file.
    const diff = execSync('git diff --name-only HEAD', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    expect(diff).not.toContain('hooks/lib/journal-io.mjs')
  })
})

// ---------------------------------------------------------------------------
// Bonus: empty / missing dir
// ---------------------------------------------------------------------------
describe('edge cases', () => {
  it('returns empty result for non-existent journalDir', () => {
    const { events, malformed_lines } = readOrderedEvents('/nonexistent/path/that/does/not/exist')
    expect(events).toEqual([])
    expect(malformed_lines).toBe(0)
  })

  it('no-motive filter returns all events', () => {
    const dir = tempDir()
    writeShard(dir, 'a.jsonl', [
      event('2026-08-03T10:00:00.000Z', 'x'),
      event('2026-08-03T10:00:01.000Z', 'y'),
    ])
    const { events } = readOrderedEvents(dir)
    expect(events.length).toBe(2)
  })

  it('uses hook-only-stream.jsonl fixture without reading it in place', () => {
    // Copy fixture into mkdtemp, verify readOrderedEvents parses it
    const fixtureDir = tempDir()
    const src = path.join(REPO_ROOT, 'test/fixtures/hook-only-stream.jsonl')
    writeFileSync(
      path.join(fixtureDir, 'hook-only.jsonl'),
      readFileSync(src, 'utf8'),
      'utf8',
    )
    const { events, malformed_lines } = readOrderedEvents(fixtureDir)
    expect(events.length).toBeGreaterThan(0)
    expect(malformed_lines).toBe(0)
    // All events have ord and _order
    for (const e of events as any[]) {
      expect(typeof e.ord).toBe('number')
      expect(e._order).toHaveProperty('shard')
      expect(e._order).toHaveProperty('line')
    }
  })
})
