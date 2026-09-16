/**
 * S64-GATE-STALENESS: stop-gate voids an APPROVE verdict when the recorded commit
 * no longer matches HEAD, or when no commit was recorded at all.
 *
 * Observable surface under test: exit code + JSON payload from the stop-gate hook.
 * The hook exits 0 on both allow and block paths; the mechanical signal is
 * `decision: "block"` in the JSON and the `reason` text.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ROOT = new URL('../../', import.meta.url).pathname
const BUN = process.env.GW_BUN ?? 'bun'
const STOP_GATE_SRC = join(ROOT, 'src', 'gw', 'cli', 'main.ts')

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@test',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@test',
}

let projectDir: string
let sessionId: string

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'gw-staleness-'))
  sessionId = `test-${randomBytes(4).toString('hex')}`
  mkdirSync(join(projectDir, '.groundwork', 'runs'), { recursive: true })
  spawnSync('git', ['init', '-q'], { cwd: projectDir, encoding: 'utf8' })
  spawnSync(
    'git',
    ['commit', '--allow-empty', '-m', 'chore: initial', '--no-gpg-sign'],
    { cwd: projectDir, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } },
  )
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

function headSha(dir: string): string {
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
}

function addCommit(dir: string): void {
  spawnSync(
    'git',
    ['commit', '--allow-empty', '-m', 'chore: bump', '--no-gpg-sign'],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } },
  )
}

function writeLedger(gate: unknown): void {
  const ledger = {
    id: sessionId,
    session_id: sessionId,
    active: true,
    brief: 'trivial staleness test',
    reinforcements: 0,
    progressSig: '',
    slices: [{ id: 'S1', kind: 'plan', status: 'complete', blocked_by: [], acceptance: [] }],
    gate,
  }
  writeFileSync(
    join(projectDir, '.groundwork', 'runs', `${sessionId}.json`),
    JSON.stringify(ledger, null, 2),
  )
}

type HookOutput = {
  decision?: string
  reason?: string
  continue?: boolean
  hookSpecificOutput?: { additionalContext?: string }
}

function runGate(): { out: HookOutput; exitCode: number } {
  const r = spawnSync(BUN, ['run', STOP_GATE_SRC, 'hook', 'stop-gate'], {
    input: JSON.stringify({ session_id: sessionId }),
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      CLAUDE_PROJECT_DIR: projectDir,
    },
    encoding: 'utf8',
  })
  const out: HookOutput = r.stdout?.trim() ? (JSON.parse(r.stdout) as HookOutput) : {}
  return { out, exitCode: r.status ?? -1 }
}

describe('stop-gate — staleness check', () => {
  it('BLOCKS with stale-verdict message when HEAD has moved since APPROVE was recorded', () => {
    const sha1 = headSha(projectDir)
    writeLedger({ advisor: { verdict: 'APPROVE', citation: 'test:1', commit: sha1 } })
    addCommit(projectDir)
    const sha2 = headSha(projectDir)

    const { out, exitCode } = runGate()

    expect(exitCode).toBe(0)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('Verdict VOID')
    expect(out.reason).toContain('recorded at')
    expect(out.reason).toContain(sha1.slice(0, 7))
    expect(out.reason).toContain('HEAD is now')
    expect(out.reason).toContain(sha2.slice(0, 7))
    expect(out.hookSpecificOutput?.additionalContext).toContain('Verdict VOID')
  })

  it('BLOCKS with no-commit message when advisor has no commit field (pre-staleness-tracking)', () => {
    writeLedger({ advisor: { verdict: 'APPROVE', citation: 'test:1' } })

    const { out, exitCode } = runGate()

    expect(exitCode).toBe(0)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('Verdict VOID')
    expect(out.reason).toContain('no commit recorded')
    expect(out.hookSpecificOutput?.additionalContext).toContain('Verdict VOID')
  })

  it('BLOCKS with no-commit message when advisor is a bare string APPROVE (pre-staleness-tracking)', () => {
    writeLedger({ advisor: 'APPROVE' })

    const { out, exitCode } = runGate()

    expect(exitCode).toBe(0)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('Verdict VOID')
    expect(out.reason).toContain('no commit recorded')
  })

  it('RELEASES when the recorded commit matches HEAD', () => {
    const sha = headSha(projectDir)
    writeLedger({ advisor: { verdict: 'APPROVE', citation: 'test:1', commit: sha } })

    const { out, exitCode } = runGate()

    expect(exitCode).toBe(0)
    expect(out.continue).toBe(true)
    expect(out.decision).toBeUndefined()
  })
})
