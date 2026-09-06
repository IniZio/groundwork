import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const REPO_ROOT = '/home/newman/.local/share/groundwork'
const CLI_PATH = path.join(REPO_ROOT, 'src/gw/cli/main.ts')
const WRITE_TOKEN = 'testtoken-density-gate'
const MOTIVE = 'test-density'

const OVER_CAP_CONTENT = `// This is a redundant comment
// Another redundant comment
// Yet another comment
// More redundant comments
// Still more comments
// Too many comments here
// This one too
const x = 1
const y = 2
const z = x + y
export const result = z
`

const cleanupSlice = {
  id: 'CD-001',
  desc: 'haiku cleanup: over-cap.ts — over-cap — model=haiku',
  status: 'pending',
  blocked_by: [],
  acceptance: [],
}

function runGate(
  verdict: string,
  sessionId: string,
  repoDir: string,
  extraEnv: Record<string, string> = {},
) {
  return spawnSync(
    'bun',
    [CLI_PATH, '--json', 'ledger', 'gate', '--motive', MOTIVE, 'advisor', verdict, '--token', WRITE_TOKEN],
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

function writeLedger(repoDir: string, sessionId: string, extraSlices: unknown[] = []) {
  mkdirSync(path.join(repoDir, '.groundwork', 'runs'), { recursive: true })
  const ledger = {
    id: sessionId,
    session_id: sessionId,
    motive: MOTIVE,
    active: true,
    brief: 'trivial test run',
    write_token: WRITE_TOKEN,
    slices: [...extraSlices],
    gate: {},
  }
  writeFileSync(
    path.join(repoDir, '.groundwork', 'runs', `${sessionId}.json`),
    JSON.stringify(ledger, null, 2),
  )
}

function writeLedgerWithBaseCommit(
  repoDir: string,
  sessionId: string,
  baseCommit: string,
  extraSlices: unknown[] = [],
) {
  mkdirSync(path.join(repoDir, '.groundwork', 'runs'), { recursive: true })
  const ledger = {
    id: sessionId,
    session_id: sessionId,
    motive: MOTIVE,
    active: true,
    brief: 'trivial test run',
    write_token: WRITE_TOKEN,
    base_commit: baseCommit,
    slices: [...extraSlices],
    gate: {},
  }
  writeFileSync(
    path.join(repoDir, '.groundwork', 'runs', `${sessionId}.json`),
    JSON.stringify(ledger, null, 2),
  )
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@test',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@test',
}

function gitCommitFile(repoDir: string, filename: string, content: string, msg: string) {
  writeFileSync(path.join(repoDir, filename), content)
  spawnSync('git', ['add', filename], { cwd: repoDir, encoding: 'utf8' })
  spawnSync('git', ['commit', '-m', msg, '--no-gpg-sign'], {
    cwd: repoDir,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV },
  })
}

let repoDir: string
let sessionId: string

beforeEach(() => {
  repoDir = mkdtempSync(path.join(tmpdir(), 'gw-density-gate-'))
  sessionId = `test-${randomBytes(4).toString('hex')}`
  spawnSync('git', ['init', '-q'], { cwd: repoDir, encoding: 'utf8' })
  spawnSync('git', ['commit', '--allow-empty', '-m', 'init', '--no-gpg-sign'], {
    cwd: repoDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@test',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@test',
    },
  })
})

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true })
})

describe('ledger gate comment-density AC3', () => {
  it('APPROVE is refused when touched file exceeds density cap and no cleanup slice exists', () => {
    writeFileSync(path.join(repoDir, 'over-cap.ts'), OVER_CAP_CONTENT)
    writeLedger(repoDir, sessionId) // no cleanup slice
    const r = runGate('APPROVE', sessionId, repoDir)
    expect(r.status).not.toBe(0)
    const out = r.stdout + r.stderr
    expect(out).toContain('over-cap.ts')
    const ledger = JSON.parse(
      readFileSync(path.join(repoDir, '.groundwork', 'runs', `${sessionId}.json`), 'utf8'),
    )
    expect(ledger.gate?.advisor).toBeUndefined()
  })

  it('APPROVE records when a matching cleanup slice is registered', () => {
    writeFileSync(path.join(repoDir, 'over-cap.ts'), OVER_CAP_CONTENT)
    writeLedger(repoDir, sessionId, [cleanupSlice])
    const r = runGate('APPROVE', sessionId, repoDir)
    expect(r.status).toBe(0)
    const ledger = JSON.parse(
      readFileSync(path.join(repoDir, '.groundwork', 'runs', `${sessionId}.json`), 'utf8'),
    )
    const advisorVal = ledger.gate?.advisor
    const verdict = typeof advisorVal === 'string' ? advisorVal : advisorVal?.verdict
    expect(verdict).toBe('APPROVE')
  })

  it('APPROVE records when no files are touched', () => {
    writeLedger(repoDir, sessionId)
    const r = runGate('APPROVE', sessionId, repoDir)
    expect(r.status).toBe(0)
  })

  it('APPROVE records when GROUNDWORK_COMMENT_DENSITY=0 (kill switch)', () => {
    writeFileSync(path.join(repoDir, 'over-cap.ts'), OVER_CAP_CONTENT)
    writeLedger(repoDir, sessionId) // no cleanup slice
    const r = runGate('APPROVE', sessionId, repoDir, { GROUNDWORK_COMMENT_DENSITY: '0' })
    expect(r.status).toBe(0)
  })

  it('CORRECTION verdict records regardless of density violations', () => {
    writeFileSync(path.join(repoDir, 'over-cap.ts'), OVER_CAP_CONTENT)
    writeLedger(repoDir, sessionId) // no cleanup slice — CORRECTION is not gated
    const r = runGate('CORRECTION', sessionId, repoDir)
    expect(r.status).toBe(0)
  })
})

describe('ledger gate comment-density C9: base_commit mechanism', () => {
  it('APPROVE is refused when over-cap file is committed AFTER base_commit, tree clean', () => {
    // Capture HEAD before the over-cap file is committed — this is the base_commit
    const baseResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' })
    const baseCommit = baseResult.stdout.trim()

    // Write ledger with base_commit recorded at this point
    writeLedgerWithBaseCommit(repoDir, sessionId, baseCommit)

    // Commit the over-cap file AFTER ledger creation (tree will be clean after commit)
    gitCommitFile(repoDir, 'over-cap.ts', OVER_CAP_CONTENT, 'add over-cap')

    // Tree is clean — gitFiles alone would return empty, making the check vacuous.
    // touchedFilesSince must detect the file via base_commit diff and refuse.
    const r = runGate('APPROVE', sessionId, repoDir)
    expect(r.status).not.toBe(0)
    const out = r.stdout + r.stderr
    expect(out).toContain('over-cap.ts')
  })

  it('APPROVE passes when cleanup slice is registered for the post-base_commit file', () => {
    const baseResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' })
    const baseCommit = baseResult.stdout.trim()
    gitCommitFile(repoDir, 'over-cap.ts', OVER_CAP_CONTENT, 'add over-cap')
    writeLedgerWithBaseCommit(repoDir, sessionId, baseCommit, [cleanupSlice])

    const r = runGate('APPROVE', sessionId, repoDir)
    expect(r.status).toBe(0)
    const ledger = JSON.parse(
      readFileSync(path.join(repoDir, '.groundwork', 'runs', `${sessionId}.json`), 'utf8'),
    )
    const advisorVal = ledger.gate?.advisor
    const verdict = typeof advisorVal === 'string' ? advisorVal : advisorVal?.verdict
    expect(verdict).toBe('APPROVE')
  })

  it('file committed BEFORE base_commit is not considered at gate', () => {
    // Commit the over-cap file BEFORE recording base_commit
    gitCommitFile(repoDir, 'pre-ledger.ts', OVER_CAP_CONTENT, 'pre-ledger file')

    // Record HEAD now — this becomes the base_commit (the over-cap file is already in history)
    const baseResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' })
    const baseCommit = baseResult.stdout.trim()

    // Write ledger with base_commit AFTER the over-cap file was committed
    writeLedgerWithBaseCommit(repoDir, sessionId, baseCommit)

    // Tree is clean; pre-ledger.ts committed before base_commit → not in touched set
    const r = runGate('APPROVE', sessionId, repoDir)
    expect(r.status).toBe(0)
  })
})
