/**
 * test/resolve-ledger-path-parity.test.ts
 *
 * Parity test: verifies that the TypeScript shared module
 * (src/gw/lib/resolve-ledger-path.ts) and the ESM mirror
 * (hooks/lib/ledger-io.mjs) produce identical results for all
 * edge-case inputs.
 *
 * Strategy: UNIT — the functions call existsSync, so fixture files
 * must exist on disk.  Each test gets a fresh temp dir torn down in
 * afterEach.  Both implementations are imported at the top level (no
 * dynamic import) so the seam is the real exported function, not a copy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { resolveLedgerPath as tsResolveLedgerPath } from '#src/gw/lib/resolve-ledger-path.js'
import { resolveLedgerPath as mjsResolveLedgerPath } from '../hooks/lib/ledger-io.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gw-parity-'))
  mkdirSync(path.join(dir, '.groundwork', 'runs'), { recursive: true })
  return dir
}

function assertParity(args: { projectDir: string; sessionId?: string }): string {
  const tsResult = tsResolveLedgerPath(args)
  const mjsResult = mjsResolveLedgerPath(args)
  expect(tsResult).toBe(mjsResult)
  return tsResult
}

// ---------------------------------------------------------------------------
// Fixture state
// ---------------------------------------------------------------------------

let projectDir: string

beforeEach(() => {
  projectDir = makeProject()
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe('resolveLedgerPath parity — mjs mirror vs TS shared module', () => {
  it('absent sessionId → both return legacy path', () => {
    const result = assertParity({ projectDir, sessionId: undefined })
    expect(result).toBe(path.join(projectDir, '.groundwork', 'run.json'))
  })

  it('invalid sessionId (path-traversal chars) → both return legacy path', () => {
    const result = assertParity({ projectDir, sessionId: '../etc/passwd' })
    expect(result).toBe(path.join(projectDir, '.groundwork', 'run.json'))
  })

  it('invalid sessionId (too long, 129 chars) → both return legacy path', () => {
    const result = assertParity({ projectDir, sessionId: 'a'.repeat(129) })
    expect(result).toBe(path.join(projectDir, '.groundwork', 'run.json'))
  })

  it('valid sessionId, per-session file exists → both return per-session path', () => {
    const sessionId = 'abc-123'
    const perSessionPath = path.join(projectDir, '.groundwork', 'runs', `${sessionId}.json`)
    writeFileSync(perSessionPath, JSON.stringify({ session_id: sessionId }))

    const result = assertParity({ projectDir, sessionId })
    expect(result).toBe(perSessionPath)
  })

  it('valid sessionId, per-session absent, legacy absent → both return per-session path', () => {
    const sessionId = 'new-session-id'
    const result = assertParity({ projectDir, sessionId })
    expect(result).toBe(path.join(projectDir, '.groundwork', 'runs', `${sessionId}.json`))
  })

  it('valid sessionId, per-session absent, legacy exists with no session_id → both return legacy path', () => {
    const sessionId = 'my-session'
    const legacyPath = path.join(projectDir, '.groundwork', 'run.json')
    writeFileSync(legacyPath, JSON.stringify({ motive: 'test' })) // no session_id field

    const result = assertParity({ projectDir, sessionId })
    expect(result).toBe(legacyPath)
  })

  it('valid sessionId, per-session absent, legacy exists with same owner → both return legacy path', () => {
    const sessionId = 'my-session'
    const legacyPath = path.join(projectDir, '.groundwork', 'run.json')
    writeFileSync(legacyPath, JSON.stringify({ session_id: sessionId }))

    const result = assertParity({ projectDir, sessionId })
    expect(result).toBe(legacyPath)
  })

  it('valid sessionId, per-session absent, legacy exists with different owner → both return per-session path', () => {
    const sessionId = 'new-session'
    const legacyPath = path.join(projectDir, '.groundwork', 'run.json')
    writeFileSync(legacyPath, JSON.stringify({ session_id: 'other-session' }))

    const result = assertParity({ projectDir, sessionId })
    expect(result).toBe(path.join(projectDir, '.groundwork', 'runs', `${sessionId}.json`))
  })
})
