/**
 * test/gw/parity/cli-hook-path.seam.test.ts
 *
 * Seam test: CLI ↔ hook project-dir resolution parity.
 *
 * Before the Half-1 fix the CLI used `??` (nullish-coalescing) while the hook
 * always used logical-OR. The divergence appeared when CLAUDE_PROJECT_DIR was
 * exported but empty: `??` kept the empty string as the projectDir while `||`
 * fell back to cwd, producing different ledger paths.
 *
 * This test spans the REAL surfaces:
 *   CLI side  — spawns bin/gw-hook and parses the "no ledger at <PATH>" message
 *   Hook side — calls resolveLedgerPath() imported directly from hooks/lib/ledger-io.mjs
 *
 * Five representative cases. Each asserts CLI path === hook path AND the
 * specific expected value.
 */

import { spawnSync } from 'child_process'
import * as fs from 'fs'
import { describe, it, expect } from 'vitest'
import { resolveLedgerPath } from '../../../hooks/lib/ledger-io.mjs'

const GW_HOOK = '/home/newman/.local/share/groundwork/bin/gw-hook'
const SESSION = 'seam-probe-sess'
const MOTIVE = 'seam-probe'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cliLedgerPath(env: NodeJS.ProcessEnv, cwd: string): string {
  const result = spawnSync(GW_HOOK, ['ledger', 'status', '--motive', MOTIVE, '--session', SESSION], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
  const combined = (result.stderr ?? '') + (result.stdout ?? '')
  const m = combined.match(/no ledger at (.+)/)
  if (!m) {
    throw new Error(
      `could not parse path from CLI output:\nstderr=${result.stderr}\nstdout=${result.stdout}`,
    )
  }
  return m[1].trim()
}

function hookLedgerPath(projectDir: string): string {
  return resolveLedgerPath({ projectDir, sessionId: SESSION })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cli-hook project-dir seam', () => {
  it('case 1: CLAUDE_PROJECT_DIR set to a real dir — both use the env value', () => {
    const dir = '/tmp/seam-test-normal'
    fs.mkdirSync(dir, { recursive: true })

    const cliPath = cliLedgerPath({ CLAUDE_PROJECT_DIR: dir }, '/tmp')
    const hookPath = hookLedgerPath(dir)

    expect(cliPath).toBe(hookPath)
    expect(cliPath).toContain(dir)
  })

  it('case 2: monorepo — CLAUDE_PROJECT_DIR is inner dir, outer has .git', () => {
    const outer = '/tmp/seam-test-mono/outer'
    const inner = `${outer}/inner`
    fs.mkdirSync(`${outer}/.git`, { recursive: true })
    fs.mkdirSync(inner, { recursive: true })

    const cliPath = cliLedgerPath({ CLAUDE_PROJECT_DIR: inner }, inner)
    const hookPath = hookLedgerPath(inner)

    expect(cliPath).toBe(hookPath)
    expect(cliPath).toContain(inner)
    expect(cliPath).not.toContain(`${outer}/.groundwork`)
  })

  it('case 3: git worktree — .git is a FILE, not a directory', () => {
    const worktree = '/tmp/seam-test-worktree'
    fs.mkdirSync(worktree, { recursive: true })
    fs.writeFileSync(`${worktree}/.git`, 'gitdir: /fake/path\n', 'utf8')

    const cliPath = cliLedgerPath({ CLAUDE_PROJECT_DIR: worktree }, worktree)
    const hookPath = hookLedgerPath(worktree)

    expect(cliPath).toBe(hookPath)
    expect(cliPath).toContain(worktree)
  })

  it('case 4: CLAUDE_PROJECT_DIR absent — both fall back to cwd', () => {
    const cwd = '/tmp/seam-test-unset'
    fs.mkdirSync(cwd, { recursive: true })

    const env: NodeJS.ProcessEnv = { ...process.env }
    delete env['CLAUDE_PROJECT_DIR']

    const result = spawnSync(GW_HOOK, ['ledger', 'status', '--motive', MOTIVE, '--session', SESSION], {
      cwd,
      env,
      encoding: 'utf8',
    })
    const combined = (result.stderr ?? '') + (result.stdout ?? '')
    const m = combined.match(/no ledger at (.+)/)
    if (!m) {
      throw new Error(
        `could not parse path from CLI output:\nstderr=${result.stderr}\nstdout=${result.stdout}`,
      )
    }
    const cliPath = m[1].trim()
    const hookPath = hookLedgerPath(cwd)

    expect(cliPath).toBe(hookPath)
    expect(cliPath).toContain(cwd)
  })

  it('case 5 (bug case): CLAUDE_PROJECT_DIR exported but EMPTY — both fall back to cwd', () => {
    const cwd = '/tmp/seam-test-empty-env'
    fs.mkdirSync(cwd, { recursive: true })

    const cliPath = cliLedgerPath({ CLAUDE_PROJECT_DIR: '' }, cwd)
    const hookPath = hookLedgerPath(cwd)

    // Post-fix: CLI falls back to cwd (same as hook).
    // Pre-fix (??): CLI uses empty string as projectDir → relative path → diverges.
    expect(cliPath).toBe(hookPath)
    expect(cliPath).toContain(cwd)
    // Confirm the path is NOT what the empty-string formula would produce.
    expect(cliPath).not.toBe(resolveLedgerPath({ projectDir: '', sessionId: SESSION }))
  })
})
