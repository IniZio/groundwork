/**
 * S3 — motive-charter.mjs: charter reader, path resolver, template renderer.
 *
 * AC coverage:
 *   S3-AC1 readCharter parses four sections, open_items with id/kind/statement/owner?/blocked_by?
 *   S3-AC2 missing file → null, no throw
 *   S3-AC3 malformed bullet → skip + warn stderr; rest parsed
 *   S3-AC4 renderCharterTemplate round-trips: parse fresh template → objective back, zero open items
 *   S3-AC5 charterPath resolves correctly (temp dir, not repo)
 *   S3-AC6 module not imported by compile/render (covered by S0-AC5 in motive-seams.test.ts)
 *   S3-AC7 integration: readCharter output fed into compile(events, { charter }) — no throw
 */

import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// TS7016 on .mjs imports is tolerated per task brief
// @ts-ignore
import { readCharter, charterPath, renderCharterTemplate } from '../../hooks/lib/motive-charter.mjs'
// @ts-ignore
import { compile } from '../../hooks/lib/motive-compile.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmp(): string {
  return mkdtempSync(path.join(tmpdir(), 'motive-charter-'))
}

function writeCharter(projectDir: string, slug: string, content: string): void {
  const dir = path.join(projectDir, '.groundwork', 'motives', slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'motive.md'), content, 'utf8')
}

const FULL_CHARTER = `# motive: test-motive

## Objective

Ship the wayfinder feature.

## Notes

Keep it simple and focused.

## Open items

- TBD-1: Decide on the API shape. @alice blocked-by:TBD-2
- TBR-2: Research existing solutions for context compression.
- TBD-3: Confirm deployment target.

## Out of scope

<!-- See .groundwork/out-of-scope/dark-mode.md -->
No dark mode.
`

// ---------------------------------------------------------------------------
// S3-AC1 — readCharter parses all four sections and open_items correctly
// ---------------------------------------------------------------------------

describe('S3-AC1 — readCharter parses four sections', () => {
  it('returns objective text', () => {
    const tmp = mkTmp()
    try {
      writeCharter(tmp, 'demo', FULL_CHARTER)
      const charter = readCharter({ projectDir: tmp, motive: 'demo' })
      expect(charter).not.toBeNull()
      expect(charter.objective).toContain('Ship the wayfinder feature')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('returns notes text', () => {
    const tmp = mkTmp()
    try {
      writeCharter(tmp, 'demo', FULL_CHARTER)
      const charter = readCharter({ projectDir: tmp, motive: 'demo' })
      expect(charter.notes).toContain('Keep it simple')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('returns out_of_scope text', () => {
    const tmp = mkTmp()
    try {
      writeCharter(tmp, 'demo', FULL_CHARTER)
      const charter = readCharter({ projectDir: tmp, motive: 'demo' })
      expect(charter.out_of_scope).toContain('No dark mode')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('parses open_items with id, kind, statement', () => {
    const tmp = mkTmp()
    try {
      writeCharter(tmp, 'demo', FULL_CHARTER)
      const charter = readCharter({ projectDir: tmp, motive: 'demo' })
      expect(charter.open_items).toHaveLength(3)

      const [item1, item2, item3] = charter.open_items
      expect(item1.id).toBe('TBD-1')
      expect(item1.kind).toBe('TBD')
      expect(item1.statement).toBeTruthy()

      expect(item2.id).toBe('TBR-2')
      expect(item2.kind).toBe('TBR')

      expect(item3.id).toBe('TBD-3')
      expect(item3.kind).toBe('TBD')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('parses optional owner and blocked_by fields', () => {
    const tmp = mkTmp()
    try {
      writeCharter(tmp, 'demo', FULL_CHARTER)
      const charter = readCharter({ projectDir: tmp, motive: 'demo' })
      const item1 = charter.open_items[0]
      expect(item1.owner).toBe('alice')
      expect(item1.blocked_by).toBe('TBD-2')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('items without owner/blocked_by omit those keys', () => {
    const tmp = mkTmp()
    try {
      writeCharter(tmp, 'demo', FULL_CHARTER)
      const charter = readCharter({ projectDir: tmp, motive: 'demo' })
      const item2 = charter.open_items[1]
      expect(item2.owner).toBeUndefined()
      expect(item2.blocked_by).toBeUndefined()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('includes path in result', () => {
    const tmp = mkTmp()
    try {
      writeCharter(tmp, 'demo', FULL_CHARTER)
      const charter = readCharter({ projectDir: tmp, motive: 'demo' })
      expect(charter.path).toBe(charterPath(tmp, 'demo'))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// S3-AC2 — missing file → null, no throw
// ---------------------------------------------------------------------------

describe('S3-AC2 — missing charter returns null without throwing', () => {
  it('returns null when file does not exist', () => {
    const tmp = mkTmp()
    try {
      expect(() => readCharter({ projectDir: tmp, motive: 'nonexistent' })).not.toThrow()
      expect(readCharter({ projectDir: tmp, motive: 'nonexistent' })).toBeNull()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('returns null for unreadable directory path', () => {
    expect(() => readCharter({ projectDir: '/no/such/dir', motive: 'x' })).not.toThrow()
    expect(readCharter({ projectDir: '/no/such/dir', motive: 'x' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// S3-AC3 — malformed bullet: skip + warn stderr; rest parsed
// ---------------------------------------------------------------------------

describe('S3-AC3 — malformed open-item bullet handling', () => {
  const CHARTER_WITH_MALFORMED = `# motive: demo

## Objective

Some objective.

## Notes

## Open items

- TBD-1: Valid item.
- not a valid item at all
- TBR-2: Another valid item.

## Out of scope
`

  it('skips malformed bullet and keeps valid items', () => {
    const tmp = mkTmp()
    try {
      writeCharter(tmp, 'demo', CHARTER_WITH_MALFORMED)
      const charter = readCharter({ projectDir: tmp, motive: 'demo' })
      expect(charter.open_items).toHaveLength(2)
      expect(charter.open_items[0].id).toBe('TBD-1')
      expect(charter.open_items[1].id).toBe('TBR-2')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('writes one warning to stderr for malformed lines', () => {
    const tmp = mkTmp()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      writeCharter(tmp, 'demo', CHARTER_WITH_MALFORMED)
      readCharter({ projectDir: tmp, motive: 'demo' })
      const warnCalls = stderrSpy.mock.calls.filter(([msg]) =>
        String(msg).includes('malformed'),
      )
      expect(warnCalls.length).toBeGreaterThanOrEqual(1)
    } finally {
      stderrSpy.mockRestore()
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// S3-AC4 — renderCharterTemplate round-trips through readCharter
// ---------------------------------------------------------------------------

describe('S3-AC4 — renderCharterTemplate round-trips', () => {
  it('parses fresh template and recovers objective', () => {
    const tmp = mkTmp()
    try {
      const objective = 'Improve developer experience.'
      const src = renderCharterTemplate({ motive: 'demo', objective })
      writeCharter(tmp, 'demo', src)
      const charter = readCharter({ projectDir: tmp, motive: 'demo' })
      expect(charter).not.toBeNull()
      expect(charter.objective).toContain(objective)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('parses fresh template and yields zero open items', () => {
    const tmp = mkTmp()
    try {
      const src = renderCharterTemplate({ motive: 'demo', objective: 'x' })
      writeCharter(tmp, 'demo', src)
      const charter = readCharter({ projectDir: tmp, motive: 'demo' })
      expect(charter.open_items).toHaveLength(0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('renderCharterTemplate is a pure function (no fs access)', () => {
    // Should not throw even without a real filesystem context
    expect(() => renderCharterTemplate({ motive: 'x', objective: 'y' })).not.toThrow()
    const result: string = renderCharterTemplate({ motive: 'my-motive', objective: 'My goal.' })
    expect(typeof result).toBe('string')
    expect(result).toContain('## Objective')
    expect(result).toContain('## Notes')
    expect(result).toContain('## Open items')
    expect(result).toContain('## Out of scope')
    expect(result).toContain('My goal.')
  })
})

// ---------------------------------------------------------------------------
// S3-AC5 — charterPath resolves to correct path (temp dir, not repo)
// ---------------------------------------------------------------------------

describe('S3-AC5 — charterPath resolution', () => {
  it('resolves to <projectDir>/.groundwork/motives/<slug>/motive.md', () => {
    const tmp = mkTmp()
    try {
      const p = charterPath(tmp, 'my-motive')
      expect(p).toBe(path.join(tmp, '.groundwork', 'motives', 'my-motive', 'motive.md'))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('does not access the filesystem', () => {
    // Just call with a non-existent dir — should not throw
    expect(() => charterPath('/non/existent', 'slug')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// S3-AC7 — integration: readCharter output fed into compile(events, { charter })
// ---------------------------------------------------------------------------

describe('S3-AC7 — compile integration with charter', () => {
  it('compile accepts charter option without throwing', () => {
    const tmp = mkTmp()
    try {
      writeCharter(tmp, 'demo', FULL_CHARTER)
      const charter = readCharter({ projectDir: tmp, motive: 'demo' })
      expect(charter).not.toBeNull()

      const now = new Date().toISOString()
      const events = [
        { type: 'MOTIVE_CREATED', motive: 'demo', ts: now, data: { objective: 'Ship the wayfinder feature.' } },
      ]

      expect(() => compile(events, { charter })).not.toThrow()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('compile with null charter (no charter file) does not throw', () => {
    const tmp = mkTmp()
    try {
      const charter = readCharter({ projectDir: tmp, motive: 'no-charter' })
      expect(charter).toBeNull()

      const now = new Date().toISOString()
      const events = [
        { type: 'MOTIVE_CREATED', motive: 'no-charter', ts: now, data: { objective: 'x' } },
      ]

      expect(() => compile(events, { charter })).not.toThrow()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
