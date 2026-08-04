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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

// ---------------------------------------------------------------------------
// splitSections — level-aware heading parsing (FIX 1 + FIX 2 regressions)
// ---------------------------------------------------------------------------

describe('readCharter — level-aware section splitting', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  // FIX 2: document-title pattern (`# motive: name` + `## sections`)
  it('parses objective when charter starts with # title then ## sections', () => {
    writeCharter(tmp, 'm', [
      '# motive: my-project',
      '',
      '## Objective',
      '',
      'Build something great.',
      '',
      '## Notes',
      '',
      'Keep it simple.',
      '',
      '## Open items',
      '',
      '- TBD-1: Decide the API shape.',
    ].join('\n'))
    const charter = readCharter({ projectDir: tmp, motive: 'm' })
    expect(charter?.objective?.trim()).toBe('Build something great.')
    expect(charter?.open_items).toHaveLength(1)
  })

  // FIX 1: ### nested inside ## Objective body must not truncate the section
  it('### nested inside ## Objective is kept as body text, not a new section', () => {
    writeCharter(tmp, 'm', [
      '# motive: m',
      '',
      '## Objective',
      '',
      'Primary goal.',
      '',
      '### Sub-detail',
      '',
      'Extra context that must stay in the Objective body.',
      '',
      '## Notes',
      '',
      'Note text.',
    ].join('\n'))
    const charter = readCharter({ projectDir: tmp, motive: 'm' })
    expect(charter?.objective).toContain('Primary goal.')
    expect(charter?.objective).toContain('Extra context that must stay in the Objective body.')
  })

  // FIX 1: ### nested inside ## Open items must not truncate TBD items after the sub-heading
  it('### nested inside ## Open items does not drop items that follow it', () => {
    writeCharter(tmp, 'm', [
      '## Objective',
      '',
      'Do the thing.',
      '',
      '## Open items',
      '',
      '- TBD-1: First item.',
      '',
      '### Context sub-heading',
      '',
      'Some clarifying notes.',
      '',
      '- TBD-2: Second item after sub-heading.',
    ].join('\n'))
    const charter = readCharter({ projectDir: tmp, motive: 'm' })
    expect(charter?.open_items).toHaveLength(2)
    expect(charter?.open_items[0].id).toBe('TBD-1')
    expect(charter?.open_items[1].id).toBe('TBD-2')
  })

  // FIX 2 (pilot format): # headings throughout still parse correctly
  it('pilot-style # headings parse objective, decisions, and open_items', () => {
    writeCharter(tmp, 'm', [
      '# Objective',
      '',
      'Ship the pilot CLI.',
      '',
      '# Decisions',
      '',
      'DECISION D-1: Use env var for store path.',
      'DECISION D-2: Entry ids from crypto.randomUUID().',
      '',
      '# Open items',
      '',
      '- TBD-1: Confirm deployment target.',
    ].join('\n'))
    const charter = readCharter({ projectDir: tmp, motive: 'm' })
    expect(charter?.objective?.trim()).toBe('Ship the pilot CLI.')
    expect(charter?.decisions).toHaveLength(2)
    expect(charter?.open_items).toHaveLength(1)
  })

  // Groundwork-format open items: multi-line + strikethrough (defensive regression)
  // TBD-4 starts with ~~ so it is treated as resolved and excluded from open_items.
  it('multi-line strikethrough TBD is excluded; surrounding items are kept', () => {
    writeCharter(tmp, 'm', [
      '## Objective',
      '',
      'Build it.',
      '',
      '## Open items',
      '',
      '- TBD-1: Short item.',
      '- TBD-4: ~~**Blocks something.** Original description.',
      '  Continuation line.',
      '  More continuation.~~ **RESOLVED** — fixed in commit abc.',
      '- TBD-5: Another item after the resolved one.',
    ].join('\n'))
    const charter = readCharter({ projectDir: tmp, motive: 'm' })
    // TBD-4 starts with ~~ → filtered out; only TBD-1 and TBD-5 remain
    expect(charter?.open_items).toHaveLength(2)
    expect(charter?.open_items[0].id).toBe('TBD-1')
    expect(charter?.open_items[1].id).toBe('TBD-5')
  })
})

// ---------------------------------------------------------------------------
// Strikethrough filtering (charter-strikethrough-resolved)
// ---------------------------------------------------------------------------

describe('readCharter — strikethrough-wrapped TBDs are excluded from open_items', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  it('single-line struck TBD is excluded; unstruck TBDs remain', () => {
    writeCharter(tmp, 'm', [
      '## Objective',
      '',
      'Do it.',
      '',
      '## Open items',
      '',
      '- TBD-1: Open item — still needs a decision.',
      '- TBD-2: ~~**Resolved item.** Was blocking something.~~ RESOLVED.',
      '- TBD-3: Another open item.',
    ].join('\n'))
    const charter = readCharter({ projectDir: tmp, motive: 'm' })
    expect(charter?.open_items).toHaveLength(2)
    expect(charter?.open_items.map((i: { id: string }) => i.id)).toEqual(['TBD-1', 'TBD-3'])
  })

  it('multi-line strikethrough (groundwork repo format) is excluded', () => {
    // TBD-4 style: opening ~~ on the bullet line, closing ~~ on a continuation line.
    writeCharter(tmp, 'm', [
      '## Objective',
      '',
      'Build it.',
      '',
      '## Open items',
      '',
      '- TBD-1: Still open.',
      '- TBD-4: ~~**Blocks WS2 beyond its diagnose slice.** The graph must join',
      '  DECISION events to ledger slices. Diagnose before any renderer work;',
      '  V2–V4 stay unstarted until this resolves. See D-14.~~ RESOLVED — join',
      '  implemented via slices tbd4-join-fix, F1, F2.',
      '- TBD-5: Also open.',
    ].join('\n'))
    const charter = readCharter({ projectDir: tmp, motive: 'm' })
    expect(charter?.open_items).toHaveLength(2)
    expect(charter?.open_items.map((i: { id: string }) => i.id)).toEqual(['TBD-1', 'TBD-5'])
  })

  it('all four groundwork-style resolved TBDs (TBD-16, TBD-19, TBD-20 format) are excluded', () => {
    writeCharter(tmp, 'm', [
      '## Objective',
      '',
      'Build it.',
      '',
      '## Open items',
      '',
      '- TBD-1: Open.',
      '- TBD-16: ~~**Journal compile: multi-ledger support** — If a motive spans multiple',
      '  runs, compile should fold events from all runs.~~ CLOSED — already ships.',
      '- TBD-19: ~~**Discoverability: point docs at MAP.md** — Direct users to MAP.md.',
      '  Include in docs pass.~~ RESOLVED — MAP.md path updated.',
      '- TBD-20: ~~**MAP.md Out of scope section renders empty** — Should surface',
      '  rejection-DECISION events.~~ RESOLVED — out of scope section now renders both.',
      '- TBD-21: Open.',
    ].join('\n'))
    const charter = readCharter({ projectDir: tmp, motive: 'm' })
    expect(charter?.open_items).toHaveLength(2)
    expect(charter?.open_items.map((i: { id: string }) => i.id)).toEqual(['TBD-1', 'TBD-21'])
  })

  it('unstruck TBD with ~~ elsewhere in statement is NOT filtered', () => {
    writeCharter(tmp, 'm', [
      '## Objective',
      '',
      'Build it.',
      '',
      '## Open items',
      '',
      '- TBD-1: Open item referencing ~~deprecated~~ approach. Still needs resolution.',
    ].join('\n'))
    const charter = readCharter({ projectDir: tmp, motive: 'm' })
    // statement starts with "Open item referencing", not "~~", so it is kept
    expect(charter?.open_items).toHaveLength(1)
    expect(charter?.open_items[0].id).toBe('TBD-1')
  })
})
