import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync, spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { conformingHistory, seedHistory } from './host-convention-harness.js'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const GW_HOOK = join(REPO_ROOT, 'bin', 'gw-hook')

const tempDirs: string[] = []

function makeTempRepo(opts?: { coreHooksPath?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), 'gw-installer-test-'))
  tempDirs.push(dir)
  execSync('git init', { cwd: dir })
  execSync('git config user.email "test@example.com"', { cwd: dir })
  execSync('git config user.name "Test Runner"', { cwd: dir })
  if (opts?.coreHooksPath) {
    execSync(`git config core.hooksPath "${opts.coreHooksPath}"`, { cwd: dir })
  }
  writeFileSync(join(dir, 'README.md'), 'init')
  execSync('git add README.md', { cwd: dir })
  execSync('git commit --no-verify -m "chore: init"', { cwd: dir })
  seedHistory(dir, conformingHistory(30))
  return dir
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gw-installer-test-'))
  tempDirs.push(dir)
  return dir
}

function runTrigger(cwd: string, extraEnv: Record<string, string> = {}) {
  return spawnSync(GW_HOOK, ['hook', 'session-commit-msg-installer'], {
    cwd,
    input: JSON.stringify({ hook_event_name: 'SessionStart' }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...extraEnv },
    timeout: 10000,
  })
}

function parseAdditionalContext(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout.trim())
    return parsed?.hookSpecificOutput?.additionalContext ?? ''
  } catch {
    return ''
  }
}

describe('session-commit-msg-installer hook', () => {
  beforeAll(() => {
    chmodSync(GW_HOOK, 0o755)
  })

  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('case 1: clean repo → hook installed, announced, bad commit rejected', () => {
    const dir = makeTempRepo()
    const commitMsgHook = join(dir, '.git', 'hooks', 'commit-msg')

    const result = runTrigger(dir)
    expect(result.status).toBe(0)
    expect(parseAdditionalContext(result.stdout).toLowerCase()).toContain('install')
    expect(existsSync(commitMsgHook)).toBe(true)
    expect(statSync(commitMsgHook).mode & 0o111).not.toBe(0)

    writeFileSync(join(dir, 'bite.txt'), 'bite')
    execSync('git add bite.txt', { cwd: dir })
    const badCommit = spawnSync('git', ['commit', '-m', 'notavalidtype: bad message'], {
      cwd: dir,
      encoding: 'utf8',
    })
    expect(badCommit.status).not.toBe(0)
  })

  it('case 2: second session start on same repo → no-op, not announced', () => {
    const dir = makeTempRepo()
    const commitMsgHook = join(dir, '.git', 'hooks', 'commit-msg')

    runTrigger(dir)
    expect(existsSync(commitMsgHook)).toBe(true)

    const result2 = runTrigger(dir)
    expect(result2.status).toBe(0)
    expect(parseAdditionalContext(result2.stdout)).toBe('')
    expect(existsSync(commitMsgHook)).toBe(true)
  })

  it('case 3: foreign commit-msg hook → left byte-identical, session start succeeds', () => {
    const dir = makeTempRepo()
    const commitMsgHook = join(dir, '.git', 'hooks', 'commit-msg')
    const foreignContent = '#!/bin/bash\nexit 0\n'
    writeFileSync(commitMsgHook, foreignContent, { mode: 0o755 })

    const result = runTrigger(dir)
    expect(result.status).toBe(0)
    expect(parseAdditionalContext(result.stdout)).toBe('')
    expect(readFileSync(commitMsgHook, 'utf8')).toBe(foreignContent)
  })

  it('case 4: core.hooksPath set → skipped, no .git/hooks/commit-msg written', () => {
    // bite proof: case 1 (same trigger, no core.hooksPath) → file IS written;
    // here (core.hooksPath set) → file must NOT be written.
    const dir = makeTempRepo({ coreHooksPath: '/tmp/custom-hooks' })
    const commitMsgHook = join(dir, '.git', 'hooks', 'commit-msg')

    const result = runTrigger(dir)
    expect(result.status).toBe(0)
    expect(parseAdditionalContext(result.stdout)).toBe('')
    expect(existsSync(commitMsgHook)).toBe(false)
  })

  it('case 5: kill-switch GROUNDWORK_COMMIT_MSG_HOOK=0 → nothing written, nothing announced', () => {
    const controlDir = makeTempRepo()
    runTrigger(controlDir)
    expect(existsSync(join(controlDir, '.git', 'hooks', 'commit-msg'))).toBe(true)

    const dir = makeTempRepo()
    const commitMsgHook = join(dir, '.git', 'hooks', 'commit-msg')

    const result = runTrigger(dir, { GROUNDWORK_COMMIT_MSG_HOOK: '0' })
    expect(result.status).toBe(0)
    expect(parseAdditionalContext(result.stdout)).toBe('')
    expect(existsSync(commitMsgHook)).toBe(false)
  })

  it('case 6: not a git repo → clean no-op, no throw', () => {
    const dir = makeTempDir()

    const result = runTrigger(dir)

    expect(result.status).toBe(0)
    expect(result.error).toBeUndefined()
    expect(existsSync(join(dir, '.git'))).toBe(false)
  })
})
