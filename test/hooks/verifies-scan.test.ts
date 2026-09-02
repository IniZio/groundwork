/**
 * Tests for hooks/lib/verifies-scan.mjs
 *
 * Covers:
 *   1. Comment-form annotations (`// @verifies FOO-R-001`)
 *   2. Mid-line / title-string forms are NOT extracted (scanner requires `@verifies` as first non-whitespace after `//` or `*`)
 *   3. Multi-id annotations on one line (space- and comma-separated)
 *   4. Malformed ids that must NOT match
 *   5. Files with no annotations produce no entries
 *   6. Multiple test files annotating the same requirement
 *   7. Files in both test/ and tests/ are scanned
 *   8. node_modules and worktrees/ dirs are ignored
 *   9. (removed — verifiedIds() was a dead export wrapping scanVerifies; deleted with T60)
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'

const VERIFIES_SCAN = path.resolve(
  import.meta.dirname,
  '..', '..', 'hooks', 'lib', 'verifies-scan.mjs',
)

const { scanVerifies, lookupVerifies } = await import(pathToFileURL(VERIFIES_SCAN).href)

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let rootDir: string

beforeEach(() => {
  rootDir = mkdtempSync(path.join(tmpdir(), 'gw-verifies-scan-'))
  mkdirSync(path.join(rootDir, 'test'), { recursive: true })
  mkdirSync(path.join(rootDir, 'tests'), { recursive: true })
})

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

/** Write a file under rootDir/test/ with the given content. */
function writeTestFile(relPath: string, content: string): void {
  const full = path.join(rootDir, relPath)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content)
}

// ---------------------------------------------------------------------------
// Suite 1: comment-form annotation
// ---------------------------------------------------------------------------

describe('scanVerifies — comment-form annotation', () => {
  it('extracts a single id from a // @verifies comment', () => {
    writeTestFile('test/foo.test.ts', [
      'import { describe, it } from "vitest"',
      '',
      '// @verifies FOO-R-001',
      'describe("foo", () => { it("does something", () => {}) })',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    expect(mapping['foo-r-001']).toBeDefined()
    expect(mapping['foo-r-001']).toContain('test/foo.test.ts')
  })

  it('returns path relative to rootDir, not absolute', () => {
    writeTestFile('test/bar.test.ts', '// @verifies BAR-R-001\n')

    const mapping = scanVerifies(rootDir)
    expect(mapping['bar-r-001'][0]).not.toContain(rootDir)
    expect(mapping['bar-r-001'][0]).toBe('test/bar.test.ts')
  })

  it('handles a multi-segment subdirectory path', () => {
    writeTestFile('test/hooks/deep.test.ts', '// @verifies DEEP-R-001\n')

    const mapping = scanVerifies(rootDir)
    expect(mapping['deep-r-001']).toContain(path.join('test', 'hooks', 'deep.test.ts'))
  })
})

// ---------------------------------------------------------------------------
// Suite 2: mid-line annotations are intentionally NOT matched
//
// @verifies is only recognized when it is the first non-whitespace content
// following a comment marker (// or *).  Forms where @verifies appears inside
// a string literal or after other code on the same line are deliberately
// unsupported — they produce false positives when prose describes the
// convention.
// ---------------------------------------------------------------------------

describe('scanVerifies — mid-line annotations are not matched (intentional)', () => {
  it('does NOT extract @verifies from inside a describe/it title string', () => {
    // @verifies is mid-line here (inside a string arg), not after a comment marker
    writeTestFile('test/title.test.ts', [
      'describe("// @verifies TITLE-R-001: the feature works", () => {',
      '  it("passes", () => {})',
      '})',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    // Mid-line @verifies inside a string is intentionally not scanned
    expect(mapping['title-r-001']).toBeUndefined()
  })

  it('does NOT extract @verifies from an it() title string (mid-line)', () => {
    // @verifies is mid-line here (inside a string arg), not after a comment marker
    writeTestFile('test/it-title.test.ts', [
      'it("@verifies IT-R-002 — blocks when incomplete", () => {})',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    // Mid-line @verifies inside a string is intentionally not scanned
    expect(mapping['it-r-002']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Suite 3: multi-id annotations
// ---------------------------------------------------------------------------

describe('scanVerifies — multi-id annotations', () => {
  it('extracts multiple comma-separated ids from one line', () => {
    writeTestFile('test/multi.test.ts', [
      '// @verifies MULTI-R-001, MULTI-R-002',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    expect(mapping['multi-r-001']).toContain('test/multi.test.ts')
    expect(mapping['multi-r-002']).toContain('test/multi.test.ts')
  })

  it('extracts multiple space-separated ids from one line', () => {
    writeTestFile('test/space-sep.test.ts', [
      '// @verifies SPACE-R-001 SPACE-R-002 SPACE-R-003',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    expect(mapping['space-r-001']).toBeDefined()
    expect(mapping['space-r-002']).toBeDefined()
    expect(mapping['space-r-003']).toBeDefined()
  })

  it('handles mixed comma-and-space separation', () => {
    writeTestFile('test/mixed-sep.test.ts', [
      '// @verifies MIXED-R-001, MIXED-R-002 MIXED-R-003',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    expect(Object.keys(mapping).filter(k => k.startsWith('mixed-'))).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// Suite 4: malformed ids that must NOT match
// ---------------------------------------------------------------------------

describe('scanVerifies — malformed ids are not extracted', () => {
  it('detects lowercase requirement ids (case-insensitive extraction)', () => {
    writeTestFile('test/lowercase.test.ts', [
      '// @verifies foo-r-001',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    expect(mapping['foo-r-001']).toBeDefined()
  })

  it('does not extract bare words that lack the -R- segment', () => {
    writeTestFile('test/no-r-seg.test.ts', [
      '// @verifies FOO-001',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    expect(Object.keys(mapping)).toHaveLength(0)
  })

  it('does not extract text without @verifies token', () => {
    writeTestFile('test/no-token.test.ts', [
      '// verifies FOO-R-001 but missing the @ sign',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    expect(mapping['FOO-R-001']).toBeUndefined()
  })

  it('does not pick up ids mentioned in prose without a proper annotation marker', () => {
    // A requirement id that appears in plain prose (no @verifies marker at start of
    // comment) is not captured — the full line must match the comment-first pattern.
    writeTestFile('test/before.test.ts', [
      '// BEFORE-R-001 is described here without being an annotation',
      '// @verifies AFTER-R-001',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    // BEFORE-R-001 is in prose only — not extracted
    expect(mapping['before-r-001']).toBeUndefined()
    // AFTER-R-001 is on a proper annotation line — extracted
    expect(mapping['after-r-001']).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Suite 5: files with no annotations
// ---------------------------------------------------------------------------

describe('scanVerifies — files with no annotations', () => {
  it('returns empty mapping when no test files contain @verifies', () => {
    writeTestFile('test/no-annotations.test.ts', [
      'import { describe, it } from "vitest"',
      'describe("clean test", () => { it("works", () => {}) })',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    expect(Object.keys(mapping)).toHaveLength(0)
  })

  it('returns empty mapping when test directories are empty', () => {
    const mapping = scanVerifies(rootDir)
    expect(Object.keys(mapping)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Suite 6: multiple files annotating the same requirement
// ---------------------------------------------------------------------------

describe('scanVerifies — multiple files per requirement', () => {
  it('collects multiple files when they share the same requirement id', () => {
    writeTestFile('test/alpha.test.ts', '// @verifies SHARED-R-001\n')
    writeTestFile('test/beta.test.ts', '// @verifies SHARED-R-001\n')

    const mapping = scanVerifies(rootDir)
    expect(mapping['shared-r-001']).toHaveLength(2)
    expect(mapping['shared-r-001']).toContain('test/alpha.test.ts')
    expect(mapping['shared-r-001']).toContain('test/beta.test.ts')
  })

  it('does not duplicate a file that has @verifies on multiple lines for the same id', () => {
    writeTestFile('test/dup-annot.test.ts', [
      '// @verifies DUP-R-001',
      '// @verifies DUP-R-001',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    expect(mapping['dup-r-001']).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Suite 7: tests/ directory is also scanned
// ---------------------------------------------------------------------------

describe('scanVerifies — tests/ directory', () => {
  it('finds annotations in the tests/ directory (plural)', () => {
    writeTestFile('tests/plural.test.ts', '// @verifies PLURAL-R-001\n')

    const mapping = scanVerifies(rootDir)
    expect(mapping['plural-r-001']).toBeDefined()
    expect(mapping['plural-r-001'][0]).toMatch(/^tests\//)
  })

  it('merges results from both test/ and tests/ directories', () => {
    writeTestFile('test/alpha.test.ts', '// @verifies BOTH-R-001\n')
    writeTestFile('tests/beta.test.ts', '// @verifies BOTH-R-001\n')

    const mapping = scanVerifies(rootDir)
    expect(mapping['both-r-001']).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Suite 8: ignored directories
// ---------------------------------------------------------------------------

describe('scanVerifies — ignored directories', () => {
  it('does not scan files inside node_modules/', () => {
    writeTestFile('test/node_modules/hidden.test.ts', '// @verifies HIDDEN-R-001\n')

    const mapping = scanVerifies(rootDir)
    expect(mapping['hidden-r-001']).toBeUndefined()
  })

  it('does not scan files inside worktrees/', () => {
    writeTestFile('test/worktrees/branch.test.ts', '// @verifies WORKTREE-R-001\n')

    const mapping = scanVerifies(rootDir)
    expect(mapping['worktree-r-001']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Suite 12: annotation position gate — both-directions bite
//
// The gate rejects @verifies unless it is the FIRST non-whitespace content
// after a comment marker (// or *).  This suite asserts BOTH directions:
//   - Positive: genuine comment-first annotations ARE found (scanner is live)
//   - Negative: prose mentions and mid-line trailing annotations are rejected
//
// A suite where every assertion is a negative cannot distinguish a live scanner
// from one that matches nothing.  The positive controls below prevent that.
// ---------------------------------------------------------------------------

describe('scanVerifies — annotation position gate (both-directions bite)', () => {
  it('positive: // @verifies is matched when @verifies is first after // (gate open)', () => {
    writeTestFile('test/gate-comment.test.ts', '// @verifies GATE-R-001\n')
    const mapping = scanVerifies(rootDir)
    // Must be defined — proves the scanner is live and the gate lets real annotations through
    expect(mapping['gate-r-001']).toBeDefined()
    expect(mapping['gate-r-001']).toContain('test/gate-comment.test.ts')
  })

  it('positive: JSDoc * @verifies is matched when @verifies is first after * (gate open)', () => {
    writeTestFile('test/gate-jsdoc.test.ts', [
      '/**',
      ' * @verifies JSDOC-R-001',
      ' */',
    ].join('\n'))
    const mapping = scanVerifies(rootDir)
    // Must be defined — proves the * form is also a live gate
    expect(mapping['jsdoc-r-001']).toBeDefined()
    expect(mapping['jsdoc-r-001']).toContain('test/gate-jsdoc.test.ts')
  })

  it('negative: prose mention of @verifies inside a JSDoc description is rejected (gate closed)', () => {
    // A description comment that mentions @verifies as convention prose — must NOT be scanned.
    // This is the false-positive case the gate was added to fix.
    writeTestFile('test/gate-prose.test.ts', [
      '/**',
      ' * Covers the annotation convention: @verifies PROSE-R-001 appears here as prose.',
      ' * Use @verifies in your test comments to register coverage.',
      ' */',
    ].join('\n'))
    const mapping = scanVerifies(rootDir)
    // Prose mention must be rejected — @verifies is not the first thing after *
    expect(mapping['prose-r-001']).toBeUndefined()
  })

  it('negative: trailing mid-line @verifies (code // @verifies) is rejected (gate closed)', () => {
    // A trailing comment after real code — must NOT be scanned (mid-line trailing is intentionally unsupported).
    writeTestFile('test/gate-trailing.test.ts', [
      'doSomething() // @verifies TRAILING-R-001',
    ].join('\n'))
    const mapping = scanVerifies(rootDir)
    // Trailing comment after code is intentionally not supported
    expect(mapping['trailing-r-001']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Suite 10: case-insensitive extraction (D-30)
// ---------------------------------------------------------------------------

describe('scanVerifies — case-insensitive extraction', () => {
  it('detects a lowercase annotation // @verifies foo-r-001 (primary bite target)', () => {
    writeTestFile('test/lowercase-detect.test.ts', [
      '// @verifies foo-r-001',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    // Assert on the key set so a red run names what the scanner actually produced
    expect(Object.keys(mapping)).toContain('foo-r-001')
    expect(mapping['foo-r-001']).toContain('test/lowercase-detect.test.ts')
  })

  it('detects an uppercase annotation // @verifies FOO-R-001 and normalizes key to lowercase (backward compat)', () => {
    writeTestFile('test/uppercase-detect.test.ts', [
      '// @verifies FOO-R-001',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    // Assert on the key set so a red run names what the scanner actually produced
    expect(Object.keys(mapping)).toContain('foo-r-001')
    expect(mapping['foo-r-001']).toContain('test/uppercase-detect.test.ts')
  })
})

// ---------------------------------------------------------------------------
// Suite 11: lookupVerifies — normalizing lookup helper
// ---------------------------------------------------------------------------

describe('lookupVerifies — normalizing lookup helper', () => {
  it('finds entry when reqId is uppercase but map keys are lowercase (bites if normalization removed)', () => {
    // verifiesMap keys are always lowercase (as scanVerifies produces)
    const map: { [k: string]: string[] } = { 'foo-r-001': ['test/foo.test.ts'] }
    // An UPPERCASE lookup must still find the entry — this is what bites when bypassed
    const result = lookupVerifies(map, 'FOO-R-001')
    expect(result).toEqual(['test/foo.test.ts'])
  })

  it('returns empty array when reqId has no entry (any case)', () => {
    const map: { [k: string]: string[] } = { 'foo-r-001': ['test/foo.test.ts'] }
    expect(lookupVerifies(map, 'MISSING-R-001')).toEqual([])
    expect(lookupVerifies(map, 'missing-r-001')).toEqual([])
  })

  it('finds entry when reqId is mixed case', () => {
    const map: { [k: string]: string[] } = { 'foo-r-001': ['test/foo.test.ts'] }
    expect(lookupVerifies(map, 'Foo-R-001')).toEqual(['test/foo.test.ts'])
  })

  it('works correctly with a real scanVerifies() map', () => {
    writeTestFile('test/lookup.test.ts', '// @verifies LOOKUP-R-001\n')
    const map = scanVerifies(rootDir)
    // map key is 'lookup-r-001' (lowercase); lookup with uppercase must work
    expect(lookupVerifies(map, 'LOOKUP-R-001')).toContain('test/lookup.test.ts')
    expect(lookupVerifies(map, 'lookup-r-001')).toContain('test/lookup.test.ts')
  })
})
