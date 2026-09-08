import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run, type Manifest } from '#src/gw/cli/commands/comment-density.js'

const OVER_CAP_TS = [
  'const v1 = 1', 'const v2 = 2', 'const v3 = 3', 'const v4 = 4', 'const v5 = 5',
  'const v6 = 6', 'const v7 = 7', 'const v8 = 8', 'const v9 = 9', 'const v10 = 10',
  'const v11 = 11', 'const v12 = 12', 'const v13 = 13', 'const v14 = 14', 'const v15 = 15',
  'const v16 = 16', 'const v17 = 17', 'const v18 = 18', 'const v19 = 19', 'const v20 = 20',
  'const v21 = 21', 'const v22 = 22', 'const v23 = 23', 'const v24 = 24', 'const v25 = 25',
  'const v26 = 26', 'const v27 = 27', 'const v28 = 28', 'const v29 = 29', 'const v30 = 30',
  'const v31 = 31', 'const v32 = 32', 'const v33 = 33', 'const v34 = 34', 'const v35 = 35',
  'const v36 = 36', 'const v37 = 37',
  '// first comment', '// second comment', '// third comment',
].join('\n')

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
