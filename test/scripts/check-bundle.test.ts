import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { collectBundleSourceFiles } from '../../scripts/bundle-hash-inputs.mjs'

const CHECKER = path.resolve(__dirname, '..', '..', 'scripts', 'check-bundle.mjs')

function makeTempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `check-bundle-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeFixture(dir: string, relPath: string, content: string): void {
  const full = path.join(dir, relPath)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

function computeHash(root: string): string {
  const hash = createHash('sha256')
  for (const f of collectBundleSourceFiles(root)) {
    hash.update(readFileSync(f))
  }
  return hash.digest('hex')
}

function stampedBundle(hash: string): string {
  return `// @bundle-source-hash: ${hash}\nconsole.log('stub')\n`
}

function run(root: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [CHECKER, '--root', root], { encoding: 'utf8' })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

let tmpDir: string

beforeEach(() => {
  tmpDir = makeTempDir()
  writeFixture(tmpDir, 'src/gw/main.ts', 'export const x = 1\n')
  writeFixture(tmpDir, 'hooks/lib/helper.mjs', 'export const y = 2\n')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('check-bundle freshness', () => {
  test('exits 0 when bundle hash matches sources', () => {
    const hash = computeHash(tmpDir)
    writeFixture(tmpDir, 'dist/gw.mjs', stampedBundle(hash))
    const r = run(tmpDir)
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)
    expect(r.stdout).toContain('fresh')
  })

  test('exits 1 when a src/gw ts file changes after stamp', () => {
    const hash = computeHash(tmpDir)
    writeFixture(tmpDir, 'dist/gw.mjs', stampedBundle(hash))
    appendFileSync(path.join(tmpDir, 'src/gw/main.ts'), '// change\n')
    const r = run(tmpDir)
    expect(r.status, `stderr: ${r.stderr}`).toBe(1)
    expect(r.stderr).toContain('STALE')
  })

  test('exits 1 when a hooks/lib mjs file changes after stamp', () => {
    const hash = computeHash(tmpDir)
    writeFixture(tmpDir, 'dist/gw.mjs', stampedBundle(hash))
    appendFileSync(path.join(tmpDir, 'hooks/lib/helper.mjs'), '// change\n')
    const r = run(tmpDir)
    expect(r.status, `stderr: ${r.stderr}`).toBe(1)
    expect(r.stderr).toContain('STALE')
  })

  test('exits 1 when dist/gw.mjs is missing', () => {
    const r = run(tmpDir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('missing')
  })

  test('exits 1 when dist/gw.mjs has no hash line', () => {
    writeFixture(tmpDir, 'dist/gw.mjs', 'console.log("no hash")\n')
    const r = run(tmpDir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('no source hash')
  })
})
