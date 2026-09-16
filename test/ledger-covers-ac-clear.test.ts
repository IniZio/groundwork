/**
 * test/ledger-covers-ac-clear.test.ts
 *
 * Asserts that `gw ledger set --covers-ac ""` clears covers_ac, and that
 * `gw ledger set --covers-ac` (no value) is rejected with an observable error.
 * Tests spawn the CLI directly to observe real exit code and message text.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const ROOT = new URL('../', import.meta.url).pathname
const GW_MAIN = join(ROOT, 'src', 'gw', 'cli', 'main.ts')
const SESSION_ID = 'covers-ac-clear-test-session'
const MOTIVE = 'test-motive-covers-ac'

let projectDir: string
let runPath: string

function makeEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    CLAUDE_PROJECT_DIR: projectDir,
    CLAUDE_CODE_SESSION_ID: SESSION_ID,
    GROUNDWORK_COMMENT_DENSITY: '0',
    GROUNDWORK_COMMIT_LINT: '0',
  }
}

function gw(subcmdArgs: string[]): ReturnType<typeof spawnSync> {
  return spawnSync('bun', ['run', GW_MAIN, 'ledger', ...subcmdArgs, '--json'], {
    env: makeEnv(),
    encoding: 'utf8',
  })
}

function writeFixture(): void {
  const data = JSON.stringify({
    active: true,
    motive: MOTIVE,
    session_id: SESSION_ID,
    write_token: 'test-token',
    slices: [{ id: 'S1', wave: 0, status: 'pending', covers_ac: ['AC-5'] }],
    gate: {},
  }, null, 2)
  writeFileSync(runPath, data, 'utf8')
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'gw-covers-ac-clear-'))
  mkdirSync(join(projectDir, '.groundwork', 'runs'), { recursive: true })
  runPath = join(projectDir, '.groundwork', 'runs', `${SESSION_ID}.json`)
  writeFixture()
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

describe('covers-ac clear via empty sentinel', () => {
  it('--covers-ac="" exits 0 and clears covers_ac to empty', () => {
    const setResult = gw(['set', '--motive', MOTIVE, 'S1', '--covers-ac='])
    expect(setResult.status, 'set exit code').toBe(0)
    const setEnvelope = JSON.parse(setResult.stdout as string) as { ok: boolean; data: { content: string } }
    expect(setEnvelope.ok).toBe(true)
    expect(setEnvelope.data.content).toContain('covers-ac=')

    const showResult = gw(['show', '--motive', MOTIVE, 'S1'])
    expect(showResult.status, 'show exit code').toBe(0)
    const showEnvelope = JSON.parse(showResult.stdout as string) as { ok: boolean; data: { content: string } }
    expect(showEnvelope.ok).toBe(true)
    expect(showEnvelope.data.content).toContain('covers_ac:  (none)')
  })

  it('--covers-ac (no value) exits non-zero with USAGE_ERROR', () => {
    const r = gw(['set', '--motive', MOTIVE, 'S1', '--covers-ac'])
    expect(r.status, 'exit code').not.toBe(0)
    const envelope = JSON.parse(r.stdout as string) as { ok: boolean; error: { code: string; message: string } }
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe('USAGE_ERROR')
    expect(envelope.error.message).toContain('covers-ac')
  })
})
