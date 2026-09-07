import { describe, it, expect } from 'vitest'
import { spawnSync, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { renderCommitMsgHook, HOOK_MARKER, isGroundworkHook } from '../../hooks/lib/commit-msg-template.mjs'
import { getHooksLibPath } from '../../hooks/lib/groundwork-resolver.mjs'
import { conformingHistory, seedHistory } from './host-convention-harness.js'

const REAL_HOOKS_LIB = getHooksLibPath()
const TEST_VERSION = '0.0.0-test'

// withHistory seeds commits that conform to groundwork's convention: the hook only
// enforces that convention in a repo whose own history has confirmed it fits.
function makeRepo(withHistory = false): string {
  const dir = mkdtempSync(join(tmpdir(), 'gw-cmhook-'))
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })
  execSync('git config commit.gpgsign false', { cwd: dir, stdio: 'pipe' })
  if (withHistory) seedHistory(dir, conformingHistory(30))
  return dir
}

function installHook(repoDir: string, hookContent: string): void {
  const hookPath = join(repoDir, '.git', 'hooks', 'commit-msg')
  writeFileSync(hookPath, hookContent)
  chmodSync(hookPath, 0o755)
}

function tryCommit(repoDir: string, message: string) {
  writeFileSync(join(repoDir, 'f.txt'), String(Date.now()))
  execSync('git add f.txt', { cwd: repoDir, stdio: 'pipe' })
  return spawnSync('git', ['commit', '-m', message], {
    cwd: repoDir,
    encoding: 'utf8',
    env: { ...process.env, HOME: process.env.HOME ?? '/root' },
  })
}

describe('commit-msg-template', () => {
  it('case 1 — violating message is REJECTED (bite proof)', () => {
    const noHookRepo = makeRepo()
    const controlResult = tryCommit(noHookRepo, 'bad message without conventional type')
    expect(controlResult.status).toBe(0)

    const hookRepo = makeRepo(true)
    installHook(hookRepo, renderCommitMsgHook({ hooksLibPath: REAL_HOOKS_LIB, version: TEST_VERSION }))
    const result = tryCommit(hookRepo, 'bad message without conventional type')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/commit-msg/)
  })

  it('case 2 — conforming subject-only message is ACCEPTED', () => {
    const repo = makeRepo()
    installHook(repo, renderCommitMsgHook({ hooksLibPath: REAL_HOOKS_LIB, version: TEST_VERSION }))
    const result = tryCommit(repo, 'feat: add portable commit-msg hook template')
    expect(result.status).toBe(0)
  })

  it('case 3 — attribution trailers are STRIPPED from stored message', () => {
    const repo = makeRepo()
    installHook(repo, renderCommitMsgHook({ hooksLibPath: REAL_HOOKS_LIB, version: TEST_VERSION }))
    const msg = 'feat: something\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
    const result = tryCommit(repo, msg)
    expect(result.status).toBe(0)
    const stored = execSync('git log -1 --pretty=%B', { cwd: repo, encoding: 'utf8' })
    expect(stored).not.toMatch(/Co-Authored-By.*Claude/i)
  })

  it('case 4 — FAIL SAFE: non-existent groundwork path → commit succeeds with warning', () => {
    // Case 1 proved the hook rejects when groundwork is present; this proves
    // a missing groundwork never blocks a commit (fail-safe exit 0).
    const repo = makeRepo(true)
    installHook(
      repo,
      renderCommitMsgHook({ hooksLibPath: '/nonexistent/groundwork/hooks/lib', version: TEST_VERSION }),
    )
    const result = tryCommit(repo, 'bad message without conventional type')
    expect(result.status).toBe(0)
    expect(result.stderr).toMatch(/groundwork not found/)
  })

  it('case 5 — GROUNDWORK_COMMIT_LINT=0 is full passthrough', () => {
    const repo = makeRepo(true)
    installHook(repo, renderCommitMsgHook({ hooksLibPath: REAL_HOOKS_LIB, version: TEST_VERSION }))
    writeFileSync(join(repo, 'g.txt'), String(Date.now()))
    execSync('git add g.txt', { cwd: repo, stdio: 'pipe' })
    const result = spawnSync('git', ['commit', '-m', 'bad message without conventional type'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, GROUNDWORK_COMMIT_LINT: '0', HOME: process.env.HOME ?? '/root' },
    })
    expect(result.status).toBe(0)
  })

  it('case 6 — marker is detectable; foreign commit-msg is distinguishable', () => {
    const hook = renderCommitMsgHook({ hooksLibPath: REAL_HOOKS_LIB, version: TEST_VERSION })
    expect(isGroundworkHook(hook)).toBe(true)
    expect(hook.split('\n')[1]).toBe(`# ${HOOK_MARKER} v${TEST_VERSION}`)

    const foreignHook = '#!/bin/bash\n# custom hook by someone else\nexit 0\n'
    expect(isGroundworkHook(foreignHook)).toBe(false)

    const almostHook = '#!/bin/bash\n# NOT-GROUNDWORK-COMMIT-MSG v1.0\nexit 0\n'
    expect(isGroundworkHook(almostHook)).toBe(false)
  })
})
