/**
 * Unit tests for hooks/lib/ensure-git-exclude.mjs.
 *
 * Framework: vitest (same as other hook tests).
 * All tests use isolated temp dirs — the real dev repo is never touched.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// @ts-expect-error — .mjs, no types
import { ensureGroundworkExcluded } from '../hooks/lib/ensure-git-exclude.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `gw-exclude-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Initialise a minimal fake git repo (create .git/info/ structure). */
function initFakeGit(projectDir: string): void {
  mkdirSync(path.join(projectDir, '.git', 'info'), { recursive: true })
}

function readExclude(projectDir: string): string {
  const p = path.join(projectDir, '.git', 'info', 'exclude')
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensureGroundworkExcluded', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // Core behaviour
  // -------------------------------------------------------------------------

  test('writes .groundwork/ to .git/info/exclude in a real git repo', () => {
    initFakeGit(tmpDir)
    ensureGroundworkExcluded(tmpDir)
    const content = readExclude(tmpDir)
    expect(content).toContain('.groundwork/')
  })

  test('idempotent: calling twice does not duplicate the line', () => {
    initFakeGit(tmpDir)
    ensureGroundworkExcluded(tmpDir)
    ensureGroundworkExcluded(tmpDir)
    const content = readExclude(tmpDir)
    const matches = content.split('\n').filter((l) => l.trim() === '.groundwork/')
    expect(matches.length).toBe(1)
  })

  test('creates exclude file if it does not exist', () => {
    initFakeGit(tmpDir)
    const excludePath = path.join(tmpDir, '.git', 'info', 'exclude')
    expect(existsSync(excludePath)).toBe(false)
    ensureGroundworkExcluded(tmpDir)
    expect(existsSync(excludePath)).toBe(true)
  })

  test('appends with a preceding newline when existing exclude file has no trailing newline', () => {
    initFakeGit(tmpDir)
    const excludePath = path.join(tmpDir, '.git', 'info', 'exclude')
    writeFileSync(excludePath, '# some comment')  // no trailing newline
    ensureGroundworkExcluded(tmpDir)
    const content = readFileSync(excludePath, 'utf8')
    // Must not run into the comment: newline inserted before entry
    expect(content).toMatch(/\n\.groundwork\//)
  })

  // -------------------------------------------------------------------------
  // Already-ignored guards
  // -------------------------------------------------------------------------

  test('no-op when .gitignore already contains ".groundwork/"', () => {
    initFakeGit(tmpDir)
    writeFileSync(path.join(tmpDir, '.gitignore'), '.groundwork/\n')
    ensureGroundworkExcluded(tmpDir)
    // exclude should NOT have been written
    const excludePath = path.join(tmpDir, '.git', 'info', 'exclude')
    expect(existsSync(excludePath)).toBe(false)
  })

  test('no-op when .gitignore contains "/.groundwork/" (leading slash variant)', () => {
    initFakeGit(tmpDir)
    writeFileSync(path.join(tmpDir, '.gitignore'), '/.groundwork/\n')
    ensureGroundworkExcluded(tmpDir)
    const excludePath = path.join(tmpDir, '.git', 'info', 'exclude')
    expect(existsSync(excludePath)).toBe(false)
  })

  test('no-op when .gitignore contains ".groundwork" (no trailing slash)', () => {
    initFakeGit(tmpDir)
    writeFileSync(path.join(tmpDir, '.gitignore'), '.groundwork\n')
    ensureGroundworkExcluded(tmpDir)
    const excludePath = path.join(tmpDir, '.git', 'info', 'exclude')
    expect(existsSync(excludePath)).toBe(false)
  })

  test('no-op when exclude already contains ".groundwork/"', () => {
    initFakeGit(tmpDir)
    const excludePath = path.join(tmpDir, '.git', 'info', 'exclude')
    writeFileSync(excludePath, '# comment\n.groundwork/\n')
    ensureGroundworkExcluded(tmpDir)
    const content = readFileSync(excludePath, 'utf8')
    const matches = content.split('\n').filter((l) => l.trim() === '.groundwork/')
    expect(matches.length).toBe(1)
  })

  // -------------------------------------------------------------------------
  // Non-git / edge cases
  // -------------------------------------------------------------------------

  test('non-git dir: no throw, no file created', () => {
    // tmpDir has no .git
    expect(() => ensureGroundworkExcluded(tmpDir)).not.toThrow()
    expect(existsSync(path.join(tmpDir, '.git'))).toBe(false)
  })

  test('.git as a file (worktree pointer): skip, no throw', () => {
    // Simulate a worktree where .git is a file
    writeFileSync(path.join(tmpDir, '.git'), 'gitdir: /some/other/path/.git\n')
    expect(() => ensureGroundworkExcluded(tmpDir)).not.toThrow()
    // No exclude written — .git is a file, not a dir
    const excludePath = path.join(tmpDir, '.git', 'info', 'exclude')
    expect(existsSync(excludePath)).toBe(false)
  })

  test('non-existent projectDir: no throw', () => {
    const ghost = path.join(os.tmpdir(), 'gw-ghost-' + Date.now())
    expect(() => ensureGroundworkExcluded(ghost)).not.toThrow()
  })
})
