/**
 * Tests for scripts/check-bookkeeping-separation.mjs (AC-6 / P-E enforcement).
 *
 * Strategy: all tests run the CLI via spawnSync against a fixture tree
 * created in a temp directory. The real committed repo is NEVER touched —
 * every test creates its own isolated subtree.
 *
 * We assert the PRINTED output and exit code (not just an internal predicate),
 * because a check that computes a finding but never emits it is a known
 * failure mode in this repo.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

// Path to the checker CLI — resolve relative to this test file's directory.
const CHECKER = path.resolve(__dirname, '..', 'scripts', 'check-bookkeeping-separation.mjs')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `gw-sep-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Invoke the checker CLI with an array of target dirs; returns status + output. */
function runChecker(dirs: string[]): { status: number; stdout: string } {
  const result = spawnSync('node', [CHECKER, ...dirs], { encoding: 'utf8' })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
  }
}

/** Write a fixture .md file inside the given dir, creating subdirs as needed. */
function writeFixture(dir: string, relPath: string, content: string): void {
  const full = path.join(dir, relPath)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = makeTempDir()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Clean cases — checker must exit 0 and report "clean"
// ---------------------------------------------------------------------------

describe('clean cases (exit 0)', () => {
  test('empty fixture tree', () => {
    mkdirSync(path.join(tmpDir, 'doc'), { recursive: true })
    const r = runChecker([path.join(tmpDir, 'doc')])
    expect(r.status, `stdout: ${r.stdout}`).toBe(0)
    expect(r.stdout).toContain('clean')
  })

  test('marker inside single-backtick inline code span is allowed', () => {
    writeFixture(tmpDir, 'doc/clean.md', [
      '# Title',
      'The `TASK_COMPLETE` event fires when a task finishes.',
      'Annotate tests with `@verifies ARTIFACT-R-001`.',
    ].join('\n') + '\n')
    const r = runChecker([path.join(tmpDir, 'doc')])
    expect(r.status, `stdout: ${r.stdout}`).toBe(0)
  })

  test('marker inside double-backtick inline code span is allowed', () => {
    writeFixture(tmpDir, 'doc/double.md', [
      '# Title',
      'Use ``TASK_COMPLETE`` or ``@verifies`` in code annotations.',
    ].join('\n') + '\n')
    const r = runChecker([path.join(tmpDir, 'doc')])
    expect(r.status, `stdout: ${r.stdout}`).toBe(0)
  })

  test('marker inside a fenced code block is allowed', () => {
    writeFixture(tmpDir, 'doc/fence.md', [
      '# Example',
      '```',
      'TASK_COMPLETE',
      '@verifies ARTIFACT-R-001',
      '```',
    ].join('\n') + '\n')
    const r = runChecker([path.join(tmpDir, 'doc')])
    expect(r.status, `stdout: ${r.stdout}`).toBe(0)
  })

  test('marker inside code span within a table cell is allowed', () => {
    writeFixture(tmpDir, 'doc/table.md', [
      '| Event | Description |',
      '|---|---|',
      '| `TASK_COMPLETE` | A task finished |',
      '| `@verifies` | Traceability tag |',
    ].join('\n') + '\n')
    const r = runChecker([path.join(tmpDir, 'doc')])
    expect(r.status, `stdout: ${r.stdout}`).toBe(0)
  })

  test('non-.md files in the fixture are not scanned', () => {
    // A bare marker in a JSON file should not trigger a violation
    writeFixture(tmpDir, 'doc/data.json', '{"event": "TASK_COMPLETE"}')
    const r = runChecker([path.join(tmpDir, 'doc')])
    expect(r.status, `stdout: ${r.stdout}`).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Violation cases — checker must exit 1 and name the file:line
// ---------------------------------------------------------------------------

describe('violation cases (exit 1)', () => {
  // FAILABILITY PROOF PART 1 — bare TASK_COMPLETE

  test('[PROOF] bare TASK_COMPLETE on its own line is flagged', () => {
    writeFixture(tmpDir, 'doc/violation.md', [
      '# Status',
      'TASK_COMPLETE',
    ].join('\n') + '\n')
    const r = runChecker([path.join(tmpDir, 'doc')])
    // Exit code must be non-zero
    expect(r.status, `stdout: ${r.stdout}`).toBe(1)
    // Output must name the file
    expect(r.stdout).toContain('violation.md')
    // Output must include the line number
    expect(r.stdout).toContain(':2:')
    // Output must include the marker text
    expect(r.stdout).toContain('TASK_COMPLETE')
    // Output must include the violation count
    expect(r.stdout).toContain('1 violation')
  })

  test('[PROOF] bare @verifies on a line is flagged', () => {
    writeFixture(tmpDir, 'skills/flagged.md', [
      '# Notes',
      '@verifies ARTIFACT-R-001',
    ].join('\n') + '\n')
    const r = runChecker([path.join(tmpDir, 'skills')])
    expect(r.status, `stdout: ${r.stdout}`).toBe(1)
    expect(r.stdout).toContain('flagged.md')
    expect(r.stdout).toContain(':2:')
    expect(r.stdout).toContain('@verifies')
    expect(r.stdout).toContain('1 violation')
  })

  test('marker embedded in prose (not in code span) is flagged', () => {
    writeFixture(tmpDir, 'doc/prose.md', [
      '# Doc',
      'This task is done. @verifies ARTIFACT-R-007 — see below.',
    ].join('\n') + '\n')
    const r = runChecker([path.join(tmpDir, 'doc')])
    expect(r.status, `stdout: ${r.stdout}`).toBe(1)
    expect(r.stdout).toContain('prose.md')
    expect(r.stdout).toContain(':2:')
  })

  test('output format includes file path, colon-separated line number, and line text', () => {
    const file = path.join(tmpDir, 'doc', 'annotated.md')
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '# Title\nsome text TASK_COMPLETE here\n', 'utf8')
    const r = runChecker([path.join(tmpDir, 'doc')])
    expect(r.status).toBe(1)
    // The pattern: <absolute-path>:<lineNo>: <text>
    expect(r.stdout).toMatch(/annotated\.md:2: /)
  })

  test('violation in nested subdirectory is found', () => {
    writeFixture(tmpDir, 'doc/nested/deep/leaf.md', 'TASK_COMPLETE\n')
    const r = runChecker([path.join(tmpDir, 'doc')])
    expect(r.status, `stdout: ${r.stdout}`).toBe(1)
    expect(r.stdout).toContain('leaf.md')
  })

  test('multiple violations across files are all reported', () => {
    writeFixture(tmpDir, 'doc/a.md', 'TASK_COMPLETE\n')
    writeFixture(tmpDir, 'doc/b.md', '@verifies ARTIFACT-R-001\n')
    const r = runChecker([path.join(tmpDir, 'doc')])
    expect(r.status, `stdout: ${r.stdout}`).toBe(1)
    expect(r.stdout).toContain('a.md')
    expect(r.stdout).toContain('b.md')
    expect(r.stdout).toContain('2 violations')
  })
})

// ---------------------------------------------------------------------------
// FAILABILITY PROOF PART 2 — fix a violation by wrapping in backticks
// ---------------------------------------------------------------------------

describe('failability proof: fix a violation makes it pass', () => {
  test('replacing bare marker with backtick-wrapped version changes exit 1 → 0', () => {
    const file = path.join(tmpDir, 'doc', 'fixed.md')
    mkdirSync(path.dirname(file), { recursive: true })

    // Plant the violation
    writeFileSync(file, '# Status\nTASK_COMPLETE\n', 'utf8')
    const failing = runChecker([path.join(tmpDir, 'doc')])
    expect(failing.status, `expected fail — stdout: ${failing.stdout}`).toBe(1)
    expect(failing.stdout).toContain('TASK_COMPLETE')

    // Fix it: wrap in backticks
    writeFileSync(file, '# Status\nThe `TASK_COMPLETE` event fires when done.\n', 'utf8')
    const passing = runChecker([path.join(tmpDir, 'doc')])
    expect(passing.status, `expected pass — stdout: ${passing.stdout}`).toBe(0)
    expect(passing.stdout).toContain('clean')
  })

  test('replacing bare @verifies with backtick-wrapped version changes exit 1 → 0', () => {
    const file = path.join(tmpDir, 'skills', 'fixed.md')
    mkdirSync(path.dirname(file), { recursive: true })

    // Plant the violation
    writeFileSync(file, '# Notes\n@verifies ARTIFACT-R-001\n', 'utf8')
    const failing = runChecker([path.join(tmpDir, 'skills')])
    expect(failing.status, `expected fail — stdout: ${failing.stdout}`).toBe(1)

    // Fix it
    writeFileSync(file, '# Notes\nAnnotate with `@verifies ARTIFACT-R-001` in code.\n', 'utf8')
    const passing = runChecker([path.join(tmpDir, 'skills')])
    expect(passing.status, `expected pass — stdout: ${passing.stdout}`).toBe(0)
    expect(passing.stdout).toContain('clean')
  })
})
