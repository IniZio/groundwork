import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const REPO_ROOT = '/home/newman/.local/share/groundwork'
const SHIM_PATH = path.join(REPO_ROOT, 'bin/gw-hook')
const WRITE_TOKEN = 'testtoken-commit-lint-gate'
const MOTIVE = 'test-commit-lint'

const BAD_MSG = 'just a plain description without type or colon'
const GOOD_MSG = 'chore: add test fixture'

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@test',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@test',
}

function writeLedger(repoDir: string, sessionId: string, baseCommit?: string) {
  mkdirSync(path.join(repoDir, '.groundwork', 'runs'), { recursive: true })
  const ledger = {
    id: sessionId,
    session_id: sessionId,
    motive: MOTIVE,
    active: true,
    brief: 'commit-lint gate test',
    write_token: WRITE_TOKEN,
    slices: [],
    gate: {},
    ...(baseCommit !== undefined ? { base_commit: baseCommit } : {}),
  }
  writeFileSync(
    path.join(repoDir, '.groundwork', 'runs', `${sessionId}.json`),
    JSON.stringify(ledger, null, 2),
  )
}

function runGate(
  verdict: string,
  sessionId: string,
  repoDir: string,
  extraEnv: Record<string, string> = {},
) {
  return spawnSync(
    SHIM_PATH,
    ['--json', 'ledger', 'gate', '--motive', MOTIVE, 'advisor', verdict, '--token', WRITE_TOKEN],
    {
      cwd: repoDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_CODE_SESSION_ID: sessionId,
        CLAUDE_PROJECT_DIR: repoDir,
        ...extraEnv,
      },
    },
  )
}

function gitCommit(repoDir: string, msg: string) {
  spawnSync('git', ['commit', '--allow-empty', '-m', msg, '--no-gpg-sign'], {
    cwd: repoDir,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV },
  })
}

function getHead(repoDir: string): string {
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).stdout.trim()
}

function readLedgerJson(repoDir: string, sessionId: string) {
  return JSON.parse(
    readFileSync(path.join(repoDir, '.groundwork', 'runs', `${sessionId}.json`), 'utf8'),
  )
}

let repoDir: string
let sessionId: string

beforeEach(() => {
  repoDir = mkdtempSync(path.join(tmpdir(), 'gw-cl-gate-'))
  sessionId = `test-${randomBytes(4).toString('hex')}`
  spawnSync('git', ['init', '-q'], { cwd: repoDir, encoding: 'utf8' })
  spawnSync('git', ['commit', '--allow-empty', '-m', 'chore: initial', '--no-gpg-sign'], {
    cwd: repoDir,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV },
  })
})

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true })
})

describe('ledger gate commit-lint AC-8: gate block', () => {
  it('positive control: APPROVE refused when commit in range violates convention', () => {
    const base = getHead(repoDir)
    gitCommit(repoDir, BAD_MSG)
    const shortSha = getHead(repoDir).slice(0, 7)
    writeLedger(repoDir, sessionId, base)
    const r = runGate('APPROVE', sessionId, repoDir)
    expect(r.status).not.toBe(0)
    const out = r.stdout + r.stderr
    expect(out).toContain('COMMIT_LINT_BLOCKED')
    expect(out).toContain('gw commit-lint remediate-plan')
    expect(out).toContain(shortSha)
    expect(readLedgerJson(repoDir, sessionId).gate?.advisor).toBeUndefined()
  })

  it('APPROVE passes when all commits in range are clean', () => {
    const base = getHead(repoDir)
    gitCommit(repoDir, GOOD_MSG)
    writeLedger(repoDir, sessionId, base)
    const r = runGate('APPROVE', sessionId, repoDir)
    expect(r.status).toBe(0)
    const ledger = readLedgerJson(repoDir, sessionId)
    const advisorVal = ledger.gate?.advisor
    const verdict = typeof advisorVal === 'string' ? advisorVal : advisorVal?.verdict
    expect(verdict).toBe('APPROVE')
  })

  it('APPROVE passes when range is empty (no commits after base_commit)', () => {
    const base = getHead(repoDir)
    writeLedger(repoDir, sessionId, base)
    const r = runGate('APPROVE', sessionId, repoDir)
    expect(r.status).toBe(0)
  })

  it('missing base_commit: APPROVE refused with COMMIT_LINT_NO_BASE_COMMIT and remediation', () => {
    gitCommit(repoDir, BAD_MSG)
    writeLedger(repoDir, sessionId)
    const r = runGate('APPROVE', sessionId, repoDir, { GROUNDWORK_COMMENT_DENSITY: '0' })
    expect(r.status).not.toBe(0)
    const out = r.stdout + r.stderr
    expect(out).toContain('COMMIT_LINT_NO_BASE_COMMIT')
    expect(out).toContain('gw ledger set --motive')
    expect(out).toContain('--base-commit')
    expect(readLedgerJson(repoDir, sessionId).gate?.advisor).toBeUndefined()
  })

  it('combination cell: density disabled + commit-lint active + no base_commit → refuses APPROVE', () => {
    gitCommit(repoDir, BAD_MSG)
    writeLedger(repoDir, sessionId)
    const r = runGate('APPROVE', sessionId, repoDir, { GROUNDWORK_COMMENT_DENSITY: '0' })
    expect(r.status).not.toBe(0)
    expect(r.stdout + r.stderr).toContain('COMMIT_LINT_NO_BASE_COMMIT')
  })

  it('kill-switch: GROUNDWORK_COMMIT_LINT=0 with missing base_commit still passes APPROVE', () => {
    gitCommit(repoDir, BAD_MSG)
    writeLedger(repoDir, sessionId)
    const r = runGate('APPROVE', sessionId, repoDir, {
      GROUNDWORK_COMMENT_DENSITY: '0',
      GROUNDWORK_COMMIT_LINT: '0',
    })
    expect(r.status).toBe(0)
  })

  it('CORRECTION records regardless of commit violations', () => {
    gitCommit(repoDir, BAD_MSG)
    writeLedger(repoDir, sessionId)
    const r = runGate('CORRECTION', sessionId, repoDir, { GROUNDWORK_COMMENT_DENSITY: '0' })
    expect(r.status).toBe(0)
  })
})

describe('AC-9: kill-switch Layer (a) — PreToolUse commit-message-guard', () => {
  it('positive control: guard denies bad commit message when kill-switch absent', () => {
    const payload = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: `git commit -m "${BAD_MSG}"` },
    })
    const r = spawnSync(SHIM_PATH, ['hook', 'commit-message-guard'], {
      input: payload,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_CODE_SESSION_ID: 'test',
        CLAUDE_PROJECT_DIR: repoDir,
      },
      timeout: 10_000,
    })
    expect(r.status).toBe(0)
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>
    const hso = parsed['hookSpecificOutput'] as Record<string, unknown>
    expect(hso['permissionDecision']).toBe('deny')
  })

  it('kill-switch: guard passes through when GROUNDWORK_COMMIT_LINT=0', () => {
    const payload = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: `git commit -m "${BAD_MSG}"` },
    })
    const r = spawnSync(SHIM_PATH, ['hook', 'commit-message-guard'], {
      input: payload,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_CODE_SESSION_ID: 'test',
        CLAUDE_PROJECT_DIR: repoDir,
        GROUNDWORK_COMMIT_LINT: '0',
      },
      timeout: 10_000,
    })
    expect(r.status).toBe(0)
    const out = r.stdout.trim()
    if (out) {
      const parsed = JSON.parse(out) as Record<string, unknown>
      const hso = (parsed['hookSpecificOutput'] as Record<string, unknown> | undefined) ?? {}
      expect(hso['permissionDecision']).not.toBe('deny')
    }
  })
})

describe('AC-9: kill-switch Layer (b) — gw commit-lint report CLI', () => {
  it('positive control: report lists violations when kill-switch absent', () => {
    const base = getHead(repoDir)
    gitCommit(repoDir, BAD_MSG)
    const range = `${base}..HEAD`
    const r = spawnSync(SHIM_PATH, ['--json', 'commit-lint', 'report', '--range', range], {
      cwd: repoDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_CODE_SESSION_ID: sessionId,
        CLAUDE_PROJECT_DIR: repoDir,
      },
      timeout: 10_000,
    })
    const parsed = JSON.parse(r.stdout) as { ok: boolean; data: { totalViolations: number } }
    expect(parsed.data.totalViolations).toBeGreaterThan(0)
  })

  it('kill-switch: report returns zero violations when GROUNDWORK_COMMIT_LINT=0', () => {
    const base = getHead(repoDir)
    gitCommit(repoDir, BAD_MSG)
    const range = `${base}..HEAD`
    const r = spawnSync(SHIM_PATH, ['--json', 'commit-lint', 'report', '--range', range], {
      cwd: repoDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_CODE_SESSION_ID: sessionId,
        CLAUDE_PROJECT_DIR: repoDir,
        GROUNDWORK_COMMIT_LINT: '0',
      },
      timeout: 10_000,
    })
    const parsed = JSON.parse(r.stdout) as { ok: boolean; data: { totalViolations: number } }
    expect(parsed.data.totalViolations).toBe(0)
  })
})

describe('AC-9: kill-switch Layer (c) — gate block', () => {
  it('positive control: gate APPROVE blocked with violations when kill-switch absent', () => {
    const base = getHead(repoDir)
    gitCommit(repoDir, BAD_MSG)
    writeLedger(repoDir, sessionId, base)
    const r = runGate('APPROVE', sessionId, repoDir)
    expect(r.status).not.toBe(0)
    expect(r.stdout + r.stderr).toContain('COMMIT_LINT_BLOCKED')
  })

  it('kill-switch: gate APPROVE passes when GROUNDWORK_COMMIT_LINT=0', () => {
    const base = getHead(repoDir)
    gitCommit(repoDir, BAD_MSG)
    writeLedger(repoDir, sessionId, base)
    const r = runGate('APPROVE', sessionId, repoDir, { GROUNDWORK_COMMIT_LINT: '0' })
    expect(r.status).toBe(0)
  })
})
