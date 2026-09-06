/**
 * test/hooks/comment-density-manifest.test.ts
 *
 * Integration tests for `gw comment-density report` and
 * `gw comment-density remediate-plan` CLI subcommands, spawned via
 * `bin/gw-hook comment-density …` by path.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dir = dirname(__filename)
const REPO_ROOT = join(__dir, '../..')
const GW_HOOK_SHIM = join(REPO_ROOT, 'bin', 'gw-hook')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(os.tmpdir(), 'cd-test-'))
}

const GIT_ENV = {
  ...process.env,
  CLAUDE_CODE_SESSION_ID: 'test-session',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
}

function gitInit(cwd: string): void {
  spawnSync('git', ['init'], { cwd, env: GIT_ENV })
  spawnSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd, env: GIT_ENV })
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Over-cap .ts file: 7 comment lines / 10 total = 70/100 */
const OVER_CAP_CONTENT = `// line 1
// line 2
// line 3
// line 4
// line 5
// line 6
// line 7
const x = 1
const y = 2
const z = 3
`

/** Restating comment under density cap: 1 comment / 25 total lines = 4/100 < 5/100 cap */
const RESTATING_UNDER_CAP_CONTENT = `// myFunc
function myFunc() {
  const a = 1
  const b = 2
  const c = 3
  const d = 4
  const e = 5
  const f = 6
  const g = 7
  const h = 8
  const i = 9
  const j = 10
  const k = 11
  const l = 12
  const m = 13
  const n = 14
  const o = 15
  const p = 16
  const q = 17
  const r = 18
  const s = 19
  const t = 20
  return a
}
`

/** Clean file: no comments, density = 0/100 */
const CLEAN_CONTENT = `const a = 1
const b = 2
`

// ---------------------------------------------------------------------------
// describe: gw comment-density report
// ---------------------------------------------------------------------------

describe('gw comment-density report', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('AC1: manifest entry has absolute path, 1-based lines, reason kind, and cap', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    writeFileSync(join(tmpDir, 'over-cap.ts'), OVER_CAP_CONTENT)

    const result = spawnSync(GW_HOOK_SHIM, ['comment-density', 'report', '--json'], {
      cwd: tmpDir,
      env: GIT_ENV,
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(126) // exec bit present
    expect(result.status).not.toBe(127) // binary found

    const envelope = JSON.parse(result.stdout)
    expect(envelope.ok).toBe(true)

    const manifest = envelope.data
    expect(manifest.cap.file).toBe(5)
    expect(manifest.cap.aggregate).toBe(2)
    expect(Array.isArray(manifest.files)).toBe(true)
    expect(manifest.files.length).toBeGreaterThanOrEqual(1)

    const entry = manifest.files.find((f: { path: string }) => f.path.endsWith('over-cap.ts'))
    expect(entry).toBeDefined()
    expect(entry.path.startsWith('/')).toBe(true) // absolute path

    expect(Array.isArray(entry.reasons)).toBe(true)
    expect(entry.reasons.length).toBeGreaterThanOrEqual(1)

    const overCapReason = entry.reasons.find((r: { kind: string }) => r.kind === 'over-cap')
    expect(overCapReason).toBeDefined()
    expect(Array.isArray(overCapReason.lines)).toBe(true)
    expect(overCapReason.lines.every((n: number) => n >= 1)).toBe(true)
  })

  it('AC5: restating comment below density cap → manifest lists file with reason kind "restating"', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    writeFileSync(join(tmpDir, 'restating.ts'), RESTATING_UNDER_CAP_CONTENT)

    const result = spawnSync(
      GW_HOOK_SHIM,
      ['comment-density', 'report', '--json', '--files', 'restating.ts'],
      {
        cwd: tmpDir,
        env: GIT_ENV,
        encoding: 'utf8',
      },
    )

    expect(result.status).not.toBe(126)
    expect(result.status).not.toBe(127)

    const envelope = JSON.parse(result.stdout)
    expect(envelope.ok).toBe(true)

    const manifest = envelope.data
    const entry = manifest.files.find((f: { path: string }) => f.path.endsWith('restating.ts'))
    expect(entry).toBeDefined()

    const restatingReason = entry.reasons.find((r: { kind: string }) => r.kind === 'restating')
    expect(restatingReason).toBeDefined()
    expect(Array.isArray(restatingReason.lines)).toBe(true)
    expect(restatingReason.lines).toContain(1) // comment is on line 1 (1-based)
    expect(restatingReason.detail).toContain('// myFunc') // detail quotes the comment
  })

  it('AC3: clean file (density at cap) → files: []', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    writeFileSync(join(tmpDir, 'clean.ts'), CLEAN_CONTENT)

    const result = spawnSync(GW_HOOK_SHIM, ['comment-density', 'report', '--json'], {
      cwd: tmpDir,
      env: GIT_ENV,
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(126)
    expect(result.status).not.toBe(127)

    const envelope = JSON.parse(result.stdout)
    expect(envelope.ok).toBe(true)
    expect(envelope.data.files.length).toBe(0)
  })

  it('AC4: kill switch GROUNDWORK_COMMENT_DENSITY=0 → files: []', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    writeFileSync(join(tmpDir, 'over-cap.ts'), OVER_CAP_CONTENT)

    const result = spawnSync(GW_HOOK_SHIM, ['comment-density', 'report', '--json'], {
      cwd: tmpDir,
      env: { ...GIT_ENV, GROUNDWORK_COMMENT_DENSITY: '0' },
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(126)
    expect(result.status).not.toBe(127)

    const envelope = JSON.parse(result.stdout)
    expect(envelope.ok).toBe(true)
    expect(envelope.data.files.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// describe: gw comment-density remediate-plan
// ---------------------------------------------------------------------------

describe('gw comment-density remediate-plan', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('AC2: 2-file manifest → exactly 2 gw ledger add lines, same wave, no --blocked-by, each contains "model=haiku"', () => {
    tmpDir = makeTmpDir()

    const manifest = {
      cap: { file: 5, aggregate: 2 },
      aggregatePer100: 10,
      files: [
        {
          path: '/tmp/foo/a.ts',
          totalLines: 10,
          commentLines: 7,
          commentsPer100: 70,
          reasons: [{ kind: 'over-cap', lines: [1, 2, 3, 4, 5, 6, 7], detail: '70/100 > 5/100' }],
        },
        {
          path: '/tmp/foo/b.ts',
          totalLines: 10,
          commentLines: 6,
          commentsPer100: 60,
          reasons: [{ kind: 'restating', lines: [1], detail: 'restating myFunc' }],
        },
      ],
    }

    const manifestPath = join(tmpDir, 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    const result = spawnSync(
      GW_HOOK_SHIM,
      ['comment-density', 'remediate-plan', '--motive', 'test-motive', '--manifest', manifestPath, '--wave', '3'],
      {
        cwd: tmpDir,
        env: GIT_ENV,
        encoding: 'utf8',
      },
    )

    expect(result.status).not.toBe(126)
    expect(result.status).not.toBe(127)

    const lines = result.stdout.split('\n')
    const ledgerLines = lines.filter((l) => l.startsWith('gw ledger add'))

    expect(ledgerLines).toHaveLength(2)
    expect(ledgerLines[0]).toContain('--wave 3')
    expect(ledgerLines[1]).toContain('--wave 3')

    expect(ledgerLines[0]).toContain('model=haiku')
    expect(ledgerLines[1]).toContain('model=haiku')

    expect(ledgerLines[0]).not.toContain('--blocked-by')
    expect(ledgerLines[1]).not.toContain('--blocked-by')

    expect(ledgerLines[0]).toContain('CD-001')
    expect(ledgerLines[1]).toContain('CD-002')

    expect(ledgerLines[0]).toContain('--covers-ac AC10')
    expect(ledgerLines[1]).toContain('--covers-ac AC10')

    expect(ledgerLines[0]).toContain('--decisions D-9')
    expect(ledgerLines[1]).toContain('--decisions D-9')
  })
})
