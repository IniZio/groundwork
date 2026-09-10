/**
 * test/ledger-integrity.test.ts
 *
 * Regression tests for AH-02 (reSeal on mutation), AH-06 (parseFlags
 * ambiguous --flag --other), and AH-07 (gate APPROVE citation guard).
 */

import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { run } from '../src/gw/cli/commands/ledger.js'
import {
  canonicalReleaseState,
  computeSeal,
  ensureKey,
  readKey,
} from '../hooks/lib/gate-seal.mjs'

const SESSION_ID = 'integrity-test'
const MOTIVE = 'integrity-motive'
const WRITE_TOKEN = 'test-write-token-abc'

let projectDir: string
let runPath: string
let savedSessionId: string | undefined
let savedProjectDir: string | undefined

function runsDir(): string {
  return join(projectDir, '.groundwork', 'runs')
}

function baseLedger(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    session_id: SESSION_ID,
    motive: MOTIVE,
    active: true,
    write_token: WRITE_TOKEN,
    slices: [],
    gate: {},
    ...overrides,
  }
}

function writeLedger(data: Record<string, unknown>): void {
  mkdirSync(runsDir(), { recursive: true })
  writeFileSync(runPath, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function readLedgerRaw(): Record<string, unknown> {
  return JSON.parse(readFileSync(runPath, 'utf8')) as Record<string, unknown>
}

function errCode(env: Awaited<ReturnType<typeof run>>): string | undefined {
  if (env.ok) return undefined
  return env.error.code
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'ledger-integrity-'))
  runPath = join(runsDir(), `${SESSION_ID}.json`)
  savedSessionId = process.env['CLAUDE_CODE_SESSION_ID']
  savedProjectDir = process.env['CLAUDE_PROJECT_DIR']
  process.env['CLAUDE_CODE_SESSION_ID'] = SESSION_ID
  process.env['CLAUDE_PROJECT_DIR'] = projectDir
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
  if (savedSessionId === undefined) delete process.env['CLAUDE_CODE_SESSION_ID']
  else process.env['CLAUDE_CODE_SESSION_ID'] = savedSessionId
  if (savedProjectDir === undefined) delete process.env['CLAUDE_PROJECT_DIR']
  else process.env['CLAUDE_PROJECT_DIR'] = savedProjectDir
})

// ---------------------------------------------------------------------------
// AH-06: parseFlags ambiguous --flag --other pattern
// ---------------------------------------------------------------------------
describe('AH-06: parseFlags ambiguous --flag followed by --other', () => {
  it('--acceptance --clear: returns USAGE_ERROR (not INTERNAL_ERROR / crash)', async () => {
    writeLedger(baseLedger())
    const result = await run(
      ['add', '--motive', MOTIVE, 'sid', '--acceptance', '--clear'],
      projectDir,
    )
    expect(result.ok).toBe(false)
    expect(errCode(result)).toBe('USAGE_ERROR')
  })

  it('--acceptance=value starting with --: treated as string, slice written', async () => {
    writeLedger(baseLedger())
    const result = await run(
      ['add', '--motive', MOTIVE, 'sid2', '--acceptance=--clear foo'],
      projectDir,
    )
    expect(result.ok).toBe(true)
    const disk = readLedgerRaw()
    const added = (disk.slices as Array<Record<string, unknown>>).find(s => s.id === 'sid2')
    expect(added).toBeDefined()
    expect(added!['acceptance']).toEqual(['--clear foo'])
  })

  it('--acceptance with non-flag next arg: consumed as value, no error', async () => {
    writeLedger(baseLedger())
    const result = await run(
      ['add', '--motive', MOTIVE, 'sid3', '--acceptance', 'must pass'],
      projectDir,
    )
    expect(result.ok).toBe(true)
    const disk = readLedgerRaw()
    const added = (disk.slices as Array<Record<string, unknown>>).find(s => s.id === 'sid3')
    expect(added!['acceptance']).toEqual(['must pass'])
  })
})

// ---------------------------------------------------------------------------
// AH-02: reSeal after mutation
// ---------------------------------------------------------------------------
describe('AH-02: reSeal after mutation', () => {
  it('add command rewrites gate.seal to match new canonical state', async () => {
    const base = baseLedger()
    ensureKey({ projectDir, sessionId: SESSION_ID })
    const key = readKey({ projectDir, sessionId: SESSION_ID })
    const initSeal = computeSeal(canonicalReleaseState(base), key)
    writeLedger({ ...base, gate: { seal: initSeal } })

    const result = await run(
      ['add', '--motive', MOTIVE, 'new-slice', '--desc', 'a test slice'],
      projectDir,
    )
    expect(result.ok).toBe(true)

    const disk = readLedgerRaw()
    expect((disk.slices as unknown[]).length).toBe(1)
    const expectedSeal = computeSeal(canonicalReleaseState(disk), key)
    expect((disk.gate as Record<string, unknown>)['seal']).toBe(expectedSeal)
  })

  it('stale seal is replaced (old seal no longer matches after mutation)', async () => {
    const base = baseLedger()
    ensureKey({ projectDir, sessionId: SESSION_ID })
    const key = readKey({ projectDir, sessionId: SESSION_ID })
    const initSeal = computeSeal(canonicalReleaseState(base), key)
    writeLedger({ ...base, gate: { seal: initSeal } })

    await run(['add', '--motive', MOTIVE, 'added-slice'], projectDir)

    const disk = readLedgerRaw()
    expect((disk.gate as Record<string, unknown>)['seal']).not.toBe(initSeal)
  })
})

// ---------------------------------------------------------------------------
// AH-07: gate APPROVE requires --citation with a resolvable file:line reference
// ---------------------------------------------------------------------------
describe('AH-07: gate APPROVE citation guard (file:line control)', () => {
  const repoRoot = new URL('../', import.meta.url).pathname.replace(/\/$/, '')

  beforeEach(() => {
    writeLedger(baseLedger({ base_commit: 'HEAD' }))
  })

  it('APPROVE without --citation returns GATE_CITATION_REQUIRED', async () => {
    const result = await run(
      ['gate', '--motive', MOTIVE, 'advisor', 'APPROVE', '--token', WRITE_TOKEN],
      projectDir,
    )
    expect(result.ok).toBe(false)
    expect(errCode(result)).toBe('GATE_CITATION_REQUIRED')
  })

  it('APPROVE with arbitrary string (no file:line) returns GATE_CITATION_REQUIRED', async () => {
    const result = await run(
      ['gate', '--motive', MOTIVE, 'advisor', 'APPROVE', '--token', WRITE_TOKEN,
       '--citation', 'provisional probe'],
      projectDir,
    )
    expect(result.ok).toBe(false)
    expect(errCode(result)).toBe('GATE_CITATION_REQUIRED')
  })

  it('APPROVE with "HEAD" (no file:line pattern) returns GATE_CITATION_REQUIRED', async () => {
    const result = await run(
      ['gate', '--motive', MOTIVE, 'advisor', 'APPROVE', '--token', WRITE_TOKEN,
       '--citation', 'HEAD'],
      projectDir,
    )
    expect(result.ok).toBe(false)
    expect(errCode(result)).toBe('GATE_CITATION_REQUIRED')
  })

  it('APPROVE with real advisor citation hooks/lib/motive-map.mjs:443 is not citation-blocked', async () => {
    const result = await run(
      ['gate', '--motive', MOTIVE, 'advisor', 'APPROVE', '--token', WRITE_TOKEN,
       '--citation', 'hooks/lib/motive-map.mjs:443'],
      repoRoot,
    )
    expect(errCode(result)).not.toBe('GATE_CITATION_REQUIRED')
  })

  it('APPROVE with real advisor citation hooks/lib/comment-density.mjs:197 is not citation-blocked', async () => {
    const result = await run(
      ['gate', '--motive', MOTIVE, 'advisor', 'APPROVE', '--token', WRITE_TOKEN,
       '--citation', 'hooks/lib/comment-density.mjs:197-198 and :227 (JSDoc + inline comments exempt)'],
      repoRoot,
    )
    expect(errCode(result)).not.toBe('GATE_CITATION_REQUIRED')
  })

  it('CORRECTION without --citation is not blocked', async () => {
    const result = await run(
      ['gate', '--motive', MOTIVE, 'advisor', 'CORRECTION', '--token', WRITE_TOKEN],
      projectDir,
    )
    expect(errCode(result)).not.toBe('GATE_CITATION_REQUIRED')
  })
})
