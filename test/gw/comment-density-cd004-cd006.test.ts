/**
 * Tests for CD-004 (remediate-plan brief content) and CD-006 (per-file density exposure).
 *
 * CD-004: Brief must name exempt channels, protect content classes, instruct MOVE not delete,
 *         and require a KEPT list from the worker.
 * CD-006: Per-file effectiveCommentsPer100 must be inspectable for all scanned files, not
 *         only flagged files. --file (singular) must not be silently ignored.
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run, type Manifest } from '#src/gw/cli/commands/comment-density.js'

// 37 code lines + 3 comments = 7.5/100 effective — over the 5/100 cap
const OVER_CAP_TS = [
  ...Array.from({ length: 37 }, (_, i) => `const v${i + 1} = ${i + 1}`),
  '// first comment',
  '// second comment',
  '// third comment',
].join('\n')

// 37 code lines + 1 comment = 2.7/100 effective — UNDER the 5/100 cap
const UNDER_CAP_TS = [
  ...Array.from({ length: 37 }, (_, i) => `const v${i + 1} = ${i + 1}`),
  '// only one comment',
].join('\n')

function makeGitRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'cd-cd004-cd006-'))
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })
  execSync('git config commit.gpgsign false', { cwd: dir, stdio: 'pipe' })
  execSync('git commit --allow-empty -m "chore: initial"', { cwd: dir, stdio: 'pipe' })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// ─── env isolation ────────────────────────────────────────────────────────────

let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  savedEnv = {
    GROUNDWORK_COMMENT_DENSITY: process.env['GROUNDWORK_COMMENT_DENSITY'],
    CLAUDE_CODE_SESSION_ID: process.env['CLAUDE_CODE_SESSION_ID'],
    CLAUDE_PROJECT_DIR: process.env['CLAUDE_PROJECT_DIR'],
  }
  delete process.env['GROUNDWORK_COMMENT_DENSITY']
  delete process.env['CLAUDE_CODE_SESSION_ID']
  delete process.env['CLAUDE_PROJECT_DIR']
})

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

// ─── CD-006: per-file density in scannedFiles ────────────────────────────────

describe('CD-006 — per-file density exposure', () => {
  it('scannedFiles carries effectiveCommentsPer100 for ALL scanned files, not just flagged ones', async () => {
    const { dir, cleanup } = makeGitRepo()
    try {
      writeFileSync(path.join(dir, 'under-cap.ts'), UNDER_CAP_TS)
      writeFileSync(path.join(dir, 'over-cap.ts'), OVER_CAP_TS)
      const result = await run(['report', 'under-cap.ts', 'over-cap.ts'], dir)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('not ok')
      const manifest = result.data as Manifest & { scannedFiles?: Array<{ path: string; effectiveCommentsPer100: number }> }

      // Only over-cap file appears in flagged list
      expect(manifest.files.some(f => f.path.endsWith('over-cap.ts'))).toBe(true)
      expect(manifest.files.some(f => f.path.endsWith('under-cap.ts'))).toBe(false)

      // Both files must appear in scannedFiles so density is inspectable for all
      expect(manifest.scannedFiles).toBeDefined()
      expect(manifest.scannedFiles!.some(f => f.path.endsWith('under-cap.ts'))).toBe(true)
      expect(manifest.scannedFiles!.some(f => f.path.endsWith('over-cap.ts'))).toBe(true)

      // effectiveCommentsPer100 must be a number (not undefined) for the under-cap file
      const underCapEntry = manifest.scannedFiles!.find(f => f.path.endsWith('under-cap.ts'))
      expect(typeof underCapEntry!.effectiveCommentsPer100).toBe('number')
    } finally {
      cleanup()
    }
  })

  it('--file (singular) is not silently ignored — same result as positional', async () => {
    const { dir, cleanup } = makeGitRepo()
    try {
      writeFileSync(path.join(dir, 'over-cap.ts'), OVER_CAP_TS)

      const positionalResult = await run(['report', 'over-cap.ts'], dir)
      const flagResult      = await run(['report', '--file', 'over-cap.ts'], dir)

      expect(positionalResult.ok).toBe(true)
      expect(flagResult.ok).toBe(true)
      if (!positionalResult.ok || !flagResult.ok) throw new Error('not ok')

      const positionalManifest = positionalResult.data as Manifest
      const flagManifest       = flagResult.data as Manifest

      // --file must scan the same set as the positional form
      expect(flagManifest.files.length).toBe(positionalManifest.files.length)
      expect(flagManifest.files.some(f => f.path.endsWith('over-cap.ts'))).toBe(true)
    } finally {
      cleanup()
    }
  })
})

// ─── CD-004: remediate-plan brief content ────────────────────────────────────

describe('CD-004 — remediate-plan brief names exempt channels and protected classes', () => {
  /**
   * Helper: run remediate-plan by piping a minimal manifest JSON via --manifest flag.
   */
  async function remediatePlan(dir: string, manifestJson: string): Promise<string> {
    const manifestPath = path.join(dir, 'manifest.json')
    writeFileSync(manifestPath, manifestJson)
    const result = await run(['remediate-plan', '--motive', 'test-motive', '--wave', '1', '--manifest', manifestPath], dir)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('not ok')
    const data = result.data as { content: string }
    return data.content
  }

  function makeMinimalManifest(filePath: string): string {
    return JSON.stringify({
      cap: { file: 5, aggregate: 2 },
      aggregatePer100: 7.5,
      files: [{
        path: filePath,
        totalLines: 40,
        commentLines: 3,
        commentsPer100: 7.5,
        effectiveCommentLines: 3,
        effectiveCommentsPer100: 7.5,
        reasons: [{ kind: 'over-cap', lines: [38, 39, 40], detail: '7.5/100 exceeds cap of 5/100' }],
      }],
    })
  }

  it('brief names JSDoc as an exempt channel', async () => {
    const { dir, cleanup } = makeGitRepo()
    try {
      const brief = await remediatePlan(dir, makeMinimalManifest('/repo/src/foo.ts'))
      expect(brief.toLowerCase()).toMatch(/jsdoc/i)
    } finally {
      cleanup()
    }
  })

  it('brief names trailing inline comments as an exempt channel', async () => {
    const { dir, cleanup } = makeGitRepo()
    try {
      const brief = await remediatePlan(dir, makeMinimalManifest('/repo/src/foo.ts'))
      expect(brief).toMatch(/trailing\s+inline|inline\s+comment.*code\s+precedes|code\s+precedes/i)
    } finally {
      cleanup()
    }
  })

  it('brief names section dividers (// ──) as an exempt channel', async () => {
    const { dir, cleanup } = makeGitRepo()
    try {
      const brief = await remediatePlan(dir, makeMinimalManifest('/repo/src/foo.ts'))
      expect(brief).toMatch(/section.divider|─{2,}|[-=]{4,}/i)
    } finally {
      cleanup()
    }
  })

  it('brief names id references (D-nn, AC-n, PACING-R-nnn) as protected content', async () => {
    const { dir, cleanup } = makeGitRepo()
    try {
      const brief = await remediatePlan(dir, makeMinimalManifest('/repo/src/foo.ts'))
      // Must call out D-nn / AC-n / PACING-R style references
      expect(brief).toMatch(/D-\d+|AC-\d+|PACING-R/i)
    } finally {
      cleanup()
    }
  })

  it('brief names format literals (uuid::SLICE-ID) as protected content', async () => {
    const { dir, cleanup } = makeGitRepo()
    try {
      const brief = await remediatePlan(dir, makeMinimalManifest('/repo/src/foo.ts'))
      expect(brief).toMatch(/uuid.*SLICE|<uuid>::/i)
    } finally {
      cleanup()
    }
  })

  it('brief instructs MOVE into exempt channel rather than DELETE', async () => {
    const { dir, cleanup } = makeGitRepo()
    try {
      const brief = await remediatePlan(dir, makeMinimalManifest('/repo/src/foo.ts'))
      expect(brief).toMatch(/move.*exempt|exempt.*channel.*instead\s+of\s+delet|move.*jsdoc|not\s+delete/i)
    } finally {
      cleanup()
    }
  })

  it('brief requires worker to report a KEPT list with channel per item', async () => {
    const { dir, cleanup } = makeGitRepo()
    try {
      const brief = await remediatePlan(dir, makeMinimalManifest('/repo/src/foo.ts'))
      expect(brief).toMatch(/KEPT/i)
      expect(brief).toMatch(/channel/i)
    } finally {
      cleanup()
    }
  })
})
