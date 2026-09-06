import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const HOOKS_DIR = join(REPO_ROOT, 'hooks')

let tempRepo: string
let fileCounter = 0

function nextFile(): [string, string] {
  const name = `file${++fileCounter}.txt`
  return [name, join(tempRepo, name)]
}

function tryCommit(extraEnv: Record<string, string> = {}): ReturnType<typeof spawnSync> {
  const [name, path] = nextFile()
  writeFileSync(path, String(fileCounter))
  execSync(`git add ${name}`, { cwd: tempRepo })
  return spawnSync('git', ['commit', '-m', 'feat: test pre-commit hook'], {
    cwd: tempRepo,
    env: { ...process.env, GROUNDWORK_COMMIT_LINT: '0', ...extraEnv },
    encoding: 'utf8',
  })
}

function makeFakeDelegate(root: string, exitCode = 0, stderr = ''): void {
  const hookDir = join(root, '.git', 'hooks')
  mkdirSync(hookDir, { recursive: true })
  const script = stderr
    ? `#!/bin/sh\necho "${stderr}" >&2\nexit ${exitCode}\n`
    : `#!/bin/sh\nexit ${exitCode}\n`
  writeFileSync(join(hookDir, 'pre-commit'), script)
  chmodSync(join(hookDir, 'pre-commit'), 0o755)
}

beforeAll(() => {
  tempRepo = mkdtempSync(join(tmpdir(), 'gw-pre-commit-test-'))
  execSync('git init', { cwd: tempRepo })
  execSync('git config user.email "test@example.com"', { cwd: tempRepo })
  execSync('git config user.name "Test Runner"', { cwd: tempRepo })
  execSync(`git config core.hooksPath "${HOOKS_DIR}"`, { cwd: tempRepo })
  writeFileSync(join(tempRepo, 'README.md'), 'init')
  execSync('git add README.md', { cwd: tempRepo })
  execSync('git commit --no-verify -m "init"', { cwd: tempRepo })
})

afterAll(() => {
  rmSync(tempRepo, { recursive: true, force: true })
})

describe('pre-commit hook', () => {
  it('positive control: harness captures stderr from delegate (proves the channel is live)', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'gw-pc-ctrl-'))
    try {
      makeFakeDelegate(fakeRoot, 0, 'POSITIVE_CONTROL_STDERR_SENTINEL')
      const result = tryCommit({ GROUNDWORK_PLUGIN_ROOT: fakeRoot })
      expect(result.status).toBe(0)
      expect(result.stderr).toContain('POSITIVE_CONTROL_STDERR_SENTINEL')
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true })
    }
  })

  it('delegate present → invoked, exit code propagated, commit succeeds', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'gw-pc-present-'))
    try {
      makeFakeDelegate(fakeRoot, 0)
      const result = tryCommit({ GROUNDWORK_PLUGIN_ROOT: fakeRoot })
      expect(result.status).toBe(0)
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true })
    }
  })

  it('delegate absent → warning on stderr names missing path, exit 0 (commit succeeds)', () => {
    const result = tryCommit({ GROUNDWORK_PLUGIN_ROOT: '/nonexistent-plugin-root-for-test' })
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('/nonexistent-plugin-root-for-test')
    expect(result.stderr).toContain('graph indexing is not running')
  })

  it('env var unset, delegate at default path present → invoked, sentinel observed', () => {
    const defaultRoot = mkdtempSync(join(tmpdir(), 'gw-pc-default-'))
    try {
      makeFakeDelegate(defaultRoot, 0, 'DEFAULT_PATH_SENTINEL')
      const [name, path] = nextFile()
      writeFileSync(path, String(fileCounter))
      execSync(`git add ${name}`, { cwd: tempRepo })
      const { GROUNDWORK_PLUGIN_ROOT: _omit, ...rest } = process.env
      const result = spawnSync('git', ['commit', '-m', 'feat: test pre-commit hook'], {
        cwd: tempRepo,
        env: { ...rest, GROUNDWORK_COMMIT_LINT: '0', _GW_TEST_DEFAULT_ROOT: defaultRoot },
        encoding: 'utf8',
      })
      expect(result.status).toBe(0)
      expect(result.stderr).toContain('DEFAULT_PATH_SENTINEL')
    } finally {
      rmSync(defaultRoot, { recursive: true, force: true })
    }
  })

  it('env var unset, default absent → no warning, exit 0', () => {
    const [name, path] = nextFile()
    writeFileSync(path, String(fileCounter))
    execSync(`git add ${name}`, { cwd: tempRepo })
    const { GROUNDWORK_PLUGIN_ROOT: _omit, ...rest } = process.env
    const result = spawnSync('git', ['commit', '-m', 'feat: test pre-commit hook'], {
      cwd: tempRepo,
      env: { ...rest, GROUNDWORK_COMMIT_LINT: '0', _GW_TEST_DEFAULT_ROOT: '/nonexistent-default-for-test' },
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stderr).not.toContain('graph indexing is not running')
  })
})
