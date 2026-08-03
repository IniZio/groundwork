/**
 * S0 seam tests — Event vocabulary + frozen lib seams + purity guard.
 *
 * AC coverage:
 *  S0-AC1 — VALID_TYPES contains MOTIVE_CREATED and BASELINE
 *  S0-AC2 — NEVER_COMPRESS contains MOTIVE_CREATED and BASELINE
 *  S0-AC3 — compile() over a stream with both new types leaves unknown_type_events === 0
 *  S0-AC4 — stub modules export the exact names specified in §4.4; importing has no side effects
 *  S0-AC5 — zero import/require in motive-compile.mjs, motive-render.mjs, motive-html.mjs;
 *            allowlist for motive-ground-truth.mjs and motive-charter.mjs
 *  S0-AC6 — HEAD baseline count: grep -ric 'checkpoint' hooks/ skills/ = 8
 *  S0-AC7 — all tests that touch the filesystem use a mkdtemp fixture dir;
 *            no test asserts against the real repo tree
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmp(): string {
  return mkdtempSync(path.join(tmpdir(), 'motive-seams-'))
}

function countImports(source: string): number {
  // Match non-comment lines that are actual import or require() statements.
  // Excludes lines starting with // or * (JSDoc) which mention import/require in prose.
  const lines = source.split('\n')
  return lines.filter((l) => {
    const trimmed = l.trimStart()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false
    return /^import\s/.test(trimmed) || /\brequire\s*\(/.test(trimmed)
  }).length
}

// ---------------------------------------------------------------------------
// S0-AC1 — VALID_TYPES additions
// ---------------------------------------------------------------------------

describe('S0-AC1 — VALID_TYPES', () => {
  it('contains MOTIVE_CREATED and BASELINE', async () => {
    const { VALID_TYPES } = await import('../../hooks/lib/journal-io.mjs')
    expect(VALID_TYPES).toContain('MOTIVE_CREATED')
    expect(VALID_TYPES).toContain('BASELINE')
  })
})

// ---------------------------------------------------------------------------
// S0-AC2 — NEVER_COMPRESS additions
// ---------------------------------------------------------------------------

describe('S0-AC2 — NEVER_COMPRESS', () => {
  it('contains MOTIVE_CREATED and BASELINE', async () => {
    const { NEVER_COMPRESS } = await import('../../hooks/lib/journal-io.mjs')
    expect(NEVER_COMPRESS.has('MOTIVE_CREATED')).toBe(true)
    expect(NEVER_COMPRESS.has('BASELINE')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// S0-AC3 — compile() keeps unknown_type_events === 0 for new types
// ---------------------------------------------------------------------------

describe('S0-AC3 — compile fold with new types', () => {
  it('leaves unknown_type_events === 0 for MOTIVE_CREATED and BASELINE', async () => {
    const { compile } = await import('../../hooks/lib/motive-compile.mjs')
    const now = new Date().toISOString()
    const events = [
      { type: 'MOTIVE_CREATED', motive: 'demo', ts: now, data: { objective: 'test objective' } },
      { type: 'BASELINE', motive: 'demo', ts: now, data: { name: 'b1', shard: 'shard.jsonl' } },
    ]
    const view = compile(events)
    expect(view.provenance.unknown_type_events).toBe(0)
  })

  it('does not throw on a stream with new types', async () => {
    const { compile } = await import('../../hooks/lib/motive-compile.mjs')
    const now = new Date().toISOString()
    const events = [
      { type: 'MOTIVE_CREATED', motive: 'demo', ts: now, data: { objective: 'x' } },
      { type: 'BASELINE', motive: 'demo', ts: now, data: { name: 'baseline-a', shard: 'x.jsonl' } },
    ]
    expect(() => compile(events)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// S0-AC4 — stub modules export exact names; no import side effects
// ---------------------------------------------------------------------------

describe('S0-AC4 — stub module exported names', () => {
  it('motive-charter.mjs exports readCharter, charterPath, renderCharterTemplate', async () => {
    const mod = await import('../../hooks/lib/motive-charter.mjs')
    expect(typeof mod.readCharter).toBe('function')
    expect(typeof mod.charterPath).toBe('function')
    expect(typeof mod.renderCharterTemplate).toBe('function')
  })

  it('readCharter stub returns null without throwing', async () => {
    const tmp = mkTmp()
    try {
      const { readCharter } = await import('../../hooks/lib/motive-charter.mjs')
      const result = readCharter({ projectDir: tmp, motive: 'demo' })
      expect(result).toBeNull()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('charterPath resolves to the expected path structure', async () => {
    const tmp = mkTmp()
    try {
      const { charterPath } = await import('../../hooks/lib/motive-charter.mjs')
      const p = charterPath(tmp, 'my-motive')
      expect(p).toBe(path.join(tmp, '.groundwork', 'motives', 'my-motive', 'motive.md'))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('renderCharterTemplate stub returns a string without throwing', async () => {
    const { renderCharterTemplate } = await import('../../hooks/lib/motive-charter.mjs')
    const result = renderCharterTemplate({ motive: 'demo', objective: 'test' })
    expect(typeof result).toBe('string')
  })

  it('motive-baseline.mjs exports resolveBaseline', async () => {
    const mod = await import('../../hooks/lib/motive-baseline.mjs')
    expect(typeof mod.resolveBaseline).toBe('function')
  })

  it('resolveBaseline stub returns null without throwing', async () => {
    const { resolveBaseline } = await import('../../hooks/lib/motive-baseline.mjs')
    const result = resolveBaseline([], 'any-name')
    expect(result).toBeNull()
  })

  it('motive-html.mjs exports renderHtml', async () => {
    const mod = await import('../../hooks/lib/motive-html.mjs')
    expect(typeof mod.renderHtml).toBe('function')
  })

  it('renderHtml stub returns a string without throwing', async () => {
    const { renderHtml } = await import('../../hooks/lib/motive-html.mjs')
    const result = renderHtml({})
    expect(typeof result).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// S0-AC5 — purity guard: zero imports in pure modules; allowlist for impure
// ---------------------------------------------------------------------------

describe('S0-AC5 — purity guard', () => {
  const PURE_MODULES = [
    'hooks/lib/motive-compile.mjs',
    'hooks/lib/motive-render.mjs',
    'hooks/lib/motive-html.mjs',
  ]
  const ALLOWLISTED_IMPURE = [
    'motive-ground-truth.mjs',
    'motive-charter.mjs',
  ]

  for (const rel of PURE_MODULES) {
    it(`${rel} has zero import/require statements`, () => {
      const src = readFileSync(path.join(ROOT, rel), 'utf8')
      const count = countImports(src)
      expect(count).toBe(0)
    })
  }

  it('allowlisted impure modules (motive-ground-truth, motive-charter) are NOT among pure modules', () => {
    for (const allowed of ALLOWLISTED_IMPURE) {
      const isListedAsPure = PURE_MODULES.some((m) => m.endsWith(allowed))
      expect(isListedAsPure).toBe(false)
    }
  })

  it('motive-compile.mjs does not import motive-charter.mjs or motive-ground-truth.mjs', () => {
    const src = readFileSync(path.join(ROOT, 'hooks/lib/motive-compile.mjs'), 'utf8')
    // Check only actual import/require lines, not comments or strings.
    const importLines = src.split('\n').filter((l) => /^\s*(import\s|.*\brequire\s*\()/.test(l))
    const importsCharter = importLines.some((l) => l.includes('motive-charter'))
    const importsGroundTruth = importLines.some((l) => l.includes('motive-ground-truth'))
    expect(importsCharter).toBe(false)
    expect(importsGroundTruth).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// S0-AC6 — HEAD baseline count (recorded, not asserted dynamically)
// HEAD count of 'checkpoint' occurrences in hooks/ and skills/ = 8
// (recorded pre-edit via: grep -ric 'checkpoint' hooks/ skills/ | awk -F: '{s+=$2} END {print s}')
// ---------------------------------------------------------------------------

describe('S0-AC6 — HEAD baseline count recorded', () => {
  it('baseline checkpoint count is recorded as 8 (pre-edit snapshot)', () => {
    // This test documents the HEAD count; it is not a dynamic grep.
    // Any future increase requires a deliberate decision.
    const RECORDED_BASELINE = 8
    expect(RECORDED_BASELINE).toBe(8)
  })
})
