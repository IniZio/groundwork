import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const REPO_ROOT = '/home/newman/.local/share/groundwork'
const GW_HOOK = path.join(REPO_ROOT, 'bin/gw-hook')

function runGwHook(args: string[]) {
  const result = spawnSync(GW_HOOK, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

describe('gw ledger help', () => {
  it('exits 0 and prints usage listing when called without arguments', () => {
    const { status, stdout } = runGwHook(['ledger', 'help'])
    expect(status).toBe(0)
    expect(stdout).toContain('gw ledger')
  })

  it('exits 0 and prints init usage when called with init', () => {
    const { status, stdout } = runGwHook(['ledger', 'help', 'init'])
    expect(status).toBe(0)
    expect(stdout).toContain('init')
  })

  it('exits 2 and mentions unknown subcommand name when called with an unknown subcommand', () => {
    const { status, stdout, stderr } = runGwHook(['ledger', 'help', 'nope'])
    expect(status).toBe(2)
    expect(stdout + stderr).toContain('nope')
  })
})
