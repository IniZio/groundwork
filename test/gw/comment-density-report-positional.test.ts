import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run, type Manifest } from '#src/gw/cli/commands/comment-density.js'

const OVER_CAP_TS = `// This is a redundant comment
// Another redundant comment
// Yet another comment
// More redundant comments
// Still more comments
// Too many comments here
// Even more comments to push well over cap
const x = 1
const y = 2
const z = x + y
export const result = z
`

function makeCleanRepo(): { dir: string; filePath: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'cd-positional-test-'))
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })
  execSync('git config commit.gpgsign false', { cwd: dir, stdio: 'pipe' })
  const filePath = path.join(dir, 'over-cap.ts')
  writeFileSync(filePath, OVER_CAP_TS)
  execSync('git add over-cap.ts', { cwd: dir, stdio: 'pipe' })
  execSync('git commit -m "chore: initial"', { cwd: dir, stdio: 'pipe' })
  return { dir, filePath, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

let savedEnvVars: Record<string, string | undefined> = {}

beforeEach(() => {
  savedEnvVars = {
    GROUNDWORK_COMMENT_DENSITY: process.env['GROUNDWORK_COMMENT_DENSITY'],
    CLAUDE_CODE_SESSION_ID: process.env['CLAUDE_CODE_SESSION_ID'],
    CLAUDE_PROJECT_DIR: process.env['CLAUDE_PROJECT_DIR'],
  }
  delete process.env['GROUNDWORK_COMMENT_DENSITY']
  delete process.env['CLAUDE_CODE_SESSION_ID']
  delete process.env['CLAUDE_PROJECT_DIR']
})

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnvVars)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('gw comment-density report — positional file arguments', () => {
  it('POSITIVE CONTROL: diff-scoped path detects an over-cap untracked file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cd-control-'))
    const cleanup = () => rmSync(dir, { recursive: true, force: true })
    try {
      execSync('git init', { cwd: dir, stdio: 'pipe' })
      execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
      execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })
      execSync('git config commit.gpgsign false', { cwd: dir, stdio: 'pipe' })
      execSync('git commit --allow-empty -m "chore: initial"', { cwd: dir, stdio: 'pipe' })
      writeFileSync(path.join(dir, 'over-cap.ts'), OVER_CAP_TS)
      const result = await run(['report'], dir)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('not ok')
      const manifest = result.data as Manifest
      expect(manifest.files.length).toBeGreaterThan(0)
      expect(manifest.files.some(f => f.path.endsWith('over-cap.ts'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('LOAD-BEARING: committed over-cap file passed positionally produces non-empty report', async () => {
    const { dir, filePath, cleanup } = makeCleanRepo()
    try {
      const relFile = path.relative(dir, filePath)
      const diffResult = await run(['report'], dir)
      expect(diffResult.ok).toBe(true)
      if (!diffResult.ok) throw new Error('not ok')
      const diffManifest = diffResult.data as Manifest
      expect(diffManifest.files.length).toBe(0)

      const result = await run(['report', relFile], dir)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('not ok')
      const manifest = result.data as Manifest
      expect(manifest.files.length).toBeGreaterThan(0)
      expect(manifest.files.some(f => f.path.endsWith('over-cap.ts'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('multiple positionals: all scanned', async () => {
    const { dir, filePath, cleanup } = makeCleanRepo()
    try {
      const relFile = path.relative(dir, filePath)
      const result = await run(['report', relFile, relFile], dir)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('not ok')
      const manifest = result.data as Manifest
      expect(manifest.files.length).toBeGreaterThan(0)
    } finally {
      cleanup()
    }
  })

  it('kill switch GROUNDWORK_COMMENT_DENSITY=0 returns empty even with positionals', async () => {
    const { dir, filePath, cleanup } = makeCleanRepo()
    process.env['GROUNDWORK_COMMENT_DENSITY'] = '0'
    try {
      const relFile = path.relative(dir, filePath)
      const result = await run(['report', relFile], dir)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('not ok')
      const manifest = result.data as Manifest
      expect(manifest.files.length).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('no positionals: diff-based scoping unchanged', async () => {
    const { dir, cleanup } = makeCleanRepo()
    try {
      const result = await run(['report'], dir)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('not ok')
      const manifest = result.data as Manifest
      expect(manifest.files.length).toBe(0)
    } finally {
      cleanup()
    }
  })
})
