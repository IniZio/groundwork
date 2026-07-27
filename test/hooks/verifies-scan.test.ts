/**
 * Tests for hooks/lib/verifies-scan.mjs
 *
 * Covers:
 *   1. Comment-form annotations (`// @verifies FOO-R-001`)
 *   2. Title-string annotations (`it('// @verifies FOO-R-001', ...)`)
 *   3. Multi-id annotations on one line (space- and comma-separated)
 *   4. Malformed ids that must NOT match
 *   5. Files with no annotations produce no entries
 *   6. Multiple test files annotating the same requirement
 *   7. Files in both test/ and tests/ are scanned
 *   8. node_modules and worktrees/ dirs are ignored
 *   9. verifiedIds() returns a Set of all annotated req ids
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

const { scanVerifies, verifiedIds } = await import(pathToFileURL(VERIFIES_SCAN).href)

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
    expect(mapping['FOO-R-001']).toBeDefined()
    expect(mapping['FOO-R-001']).toContain('test/foo.test.ts')
  })

  it('returns path relative to rootDir, not absolute', () => {
    writeTestFile('test/bar.test.ts', '// @verifies BAR-R-001\n')

    const mapping = scanVerifies(rootDir)
    expect(mapping['BAR-R-001'][0]).not.toContain(rootDir)
    expect(mapping['BAR-R-001'][0]).toBe('test/bar.test.ts')
  })

  it('handles a multi-segment subdirectory path', () => {
    writeTestFile('test/hooks/deep.test.ts', '// @verifies DEEP-R-001\n')

    const mapping = scanVerifies(rootDir)
    expect(mapping['DEEP-R-001']).toContain(path.join('test', 'hooks', 'deep.test.ts'))
  })
})

// ---------------------------------------------------------------------------
// Suite 2: title-string annotation
// ---------------------------------------------------------------------------

describe('scanVerifies — title-string annotation', () => {
  it('extracts id from a @verifies token inside a describe/it title string', () => {
    writeTestFile('test/title.test.ts', [
      'describe("// @verifies TITLE-R-001: the feature works", () => {',
      '  it("passes", () => {})',
      '})',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    expect(mapping['TITLE-R-001']).toBeDefined()
    expect(mapping['TITLE-R-001']).toContain('test/title.test.ts')
  })

  it('extracts id from @verifies in an it() title string', () => {
    writeTestFile('test/it-title.test.ts', [
      'it("@verifies IT-R-002 — blocks when incomplete", () => {})',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    expect(mapping['IT-R-002']).toBeDefined()
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
    expect(mapping['MULTI-R-001']).toContain('test/multi.test.ts')
    expect(mapping['MULTI-R-002']).toContain('test/multi.test.ts')
  })

  it('extracts multiple space-separated ids from one line', () => {
    writeTestFile('test/space-sep.test.ts', [
      '// @verifies SPACE-R-001 SPACE-R-002 SPACE-R-003',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    expect(mapping['SPACE-R-001']).toBeDefined()
    expect(mapping['SPACE-R-002']).toBeDefined()
    expect(mapping['SPACE-R-003']).toBeDefined()
  })

  it('handles mixed comma-and-space separation', () => {
    writeTestFile('test/mixed-sep.test.ts', [
      '// @verifies MIXED-R-001, MIXED-R-002 MIXED-R-003',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    expect(Object.keys(mapping).filter(k => k.startsWith('MIXED-'))).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// Suite 4: malformed ids that must NOT match
// ---------------------------------------------------------------------------

describe('scanVerifies — malformed ids are not extracted', () => {
  it('does not extract lowercase requirement ids', () => {
    writeTestFile('test/lowercase.test.ts', [
      '// @verifies foo-r-001',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    expect(mapping['foo-r-001']).toBeUndefined()
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

  it('does not pick up ids that appear before @verifies on the same line', () => {
    // Only ids AFTER @verifies should be captured
    writeTestFile('test/before.test.ts', [
      '// BEFORE-R-001 is mentioned then @verifies AFTER-R-001',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    expect(mapping['BEFORE-R-001']).toBeUndefined()
    expect(mapping['AFTER-R-001']).toBeDefined()
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
    expect(mapping['SHARED-R-001']).toHaveLength(2)
    expect(mapping['SHARED-R-001']).toContain('test/alpha.test.ts')
    expect(mapping['SHARED-R-001']).toContain('test/beta.test.ts')
  })

  it('does not duplicate a file that has @verifies on multiple lines for the same id', () => {
    writeTestFile('test/dup-annot.test.ts', [
      '// @verifies DUP-R-001',
      '// @verifies DUP-R-001',
    ].join('\n'))

    const mapping = scanVerifies(rootDir)
    expect(mapping['DUP-R-001']).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Suite 7: tests/ directory is also scanned
// ---------------------------------------------------------------------------

describe('scanVerifies — tests/ directory', () => {
  it('finds annotations in the tests/ directory (plural)', () => {
    writeTestFile('tests/plural.test.ts', '// @verifies PLURAL-R-001\n')

    const mapping = scanVerifies(rootDir)
    expect(mapping['PLURAL-R-001']).toBeDefined()
    expect(mapping['PLURAL-R-001'][0]).toMatch(/^tests\//)
  })

  it('merges results from both test/ and tests/ directories', () => {
    writeTestFile('test/alpha.test.ts', '// @verifies BOTH-R-001\n')
    writeTestFile('tests/beta.test.ts', '// @verifies BOTH-R-001\n')

    const mapping = scanVerifies(rootDir)
    expect(mapping['BOTH-R-001']).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Suite 8: ignored directories
// ---------------------------------------------------------------------------

describe('scanVerifies — ignored directories', () => {
  it('does not scan files inside node_modules/', () => {
    writeTestFile('test/node_modules/hidden.test.ts', '// @verifies HIDDEN-R-001\n')

    const mapping = scanVerifies(rootDir)
    expect(mapping['HIDDEN-R-001']).toBeUndefined()
  })

  it('does not scan files inside worktrees/', () => {
    writeTestFile('test/worktrees/branch.test.ts', '// @verifies WORKTREE-R-001\n')

    const mapping = scanVerifies(rootDir)
    expect(mapping['WORKTREE-R-001']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Suite 9: verifiedIds()
// ---------------------------------------------------------------------------

describe('verifiedIds()', () => {
  it('returns a Set of all requirement ids that appear in @verifies annotations', () => {
    writeTestFile('test/ids.test.ts', [
      '// @verifies IDS-R-001, IDS-R-002',
      '// @verifies IDS-R-003',
    ].join('\n'))

    const ids = verifiedIds(rootDir)
    expect(ids).toBeInstanceOf(Set)
    expect(ids.has('IDS-R-001')).toBe(true)
    expect(ids.has('IDS-R-002')).toBe(true)
    expect(ids.has('IDS-R-003')).toBe(true)
    expect(ids.size).toBe(3)
  })

  it('returns an empty Set when no annotations exist', () => {
    const ids = verifiedIds(rootDir)
    expect(ids.size).toBe(0)
  })
})
