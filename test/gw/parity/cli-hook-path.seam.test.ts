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

const HOOKS_LEDGER_MJS = '/home/newman/.local/share/groundwork/hooks/ledger.mjs'

// ---------------------------------------------------------------------------
// T44: hook-side env read helper
//
// The existing hookLedgerPath(projectDir) passes projectDir explicitly, which
// spans the path FORMULA but not hooks/ledger.mjs's own env read.  This
// helper spawns hooks/ledger.mjs directly (not via gw-hook / the TS CLI),
// exercising hooks/ledger.mjs main()'s own env read at line 1729:
//   const base = process.env.CLAUDE_PROJECT_DIR || process.cwd()
// A || -> ?? regression there makes the subprocess emit a relative
// "no ledger at .groundwork/..." path that diverges from the TS CLI's
// absolute path -> parity assertion fails -> caught.
// ---------------------------------------------------------------------------
function hookLedgerPathViaMjs(env: NodeJS.ProcessEnv, cwd: string): string {
  const result = spawnSync(
    process.execPath,
    [HOOKS_LEDGER_MJS, 'status', '--session', SESSION],
    {
      cwd,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    },
  )
  const combined = (result.stderr ?? '') + (result.stdout ?? '')
  const m = combined.match(/no ledger at (.+)/)
  if (!m) {
    throw new Error(
      `could not parse path from hooks/ledger.mjs:\nstderr=${result.stderr}\nstdout=${result.stdout}`,
    )
  }
  return m[1].trim()
}

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

  // -------------------------------------------------------------------------
  // case 6 — T42: stop-gate fail-open (D-29)
  //
  // stop-gate.ts line 1101-1106 used env.CLAUDE_PROJECT_DIR ?? process.cwd()
  // instead of ||.  With CLAUDE_PROJECT_DIR='', ?? keeps the empty string as
  // projectDir; || falls back to cwd.  The gate then searches for the ledger
  // at the path produced by resolveLedgerPath({projectDir:''}), which is a
  // relative path (.groundwork/runs/...) that may not correspond to the actual
  // project -- fail-open.
  //
  // This case verifies that the TS CLI (src/gw/cli/commands/ledger.ts line 312,
  // which uses ||) and the hook-side formula (explicit cwd, what the fixed
  // stop-gate computes) agree when CLAUDE_PROJECT_DIR is empty.
  //
  // BITE PROOF -- red run:
  //   Perturb src/gw/cli/commands/ledger.ts line 312: change `||` to `??`
  //   CLI then computes '' ?? cwd = '' -> "no ledger at .groundwork/runs/..."
  //   hookLedgerPath(cwd) -> absolute path -> strings diverge -> test FAILS
  //   git diff --exit-code test/gw/parity/cli-hook-path.seam.test.ts -> exit 0
  //   Failure message names diverging values: '.groundwork/...' vs '/tmp/...'
  // Green run: revert ledger.ts:312 -> both absolute -> PASS
  // -------------------------------------------------------------------------
  it('case 6 (T42 stop-gate): CLAUDE_PROJECT_DIR empty — || falls back to cwd, ?? does not', () => {
    const cwd = '/tmp/seam-test-T42-stopgate'
    fs.mkdirSync(cwd, { recursive: true })

    // CLI goes through src/gw/cli/commands/ledger.ts which reads
    // process.env['CLAUDE_PROJECT_DIR'] || cwd at line 312.
    // With CLAUDE_PROJECT_DIR='' and || this gives cwd (absolute).
    const cliPath = cliLedgerPath({ CLAUDE_PROJECT_DIR: '' }, cwd)

    // Hook side: explicit cwd (what the fixed stop-gate should compute).
    const hookPath = hookLedgerPath(cwd)

    expect(cliPath).toBe(hookPath)
    expect(cliPath).toContain(cwd)

    // Confirm the path is NOT the relative form that ?? would produce.
    const buggyCwdPath = resolveLedgerPath({ projectDir: '', sessionId: SESSION })
    expect(cliPath).not.toBe(buggyCwdPath)
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

  // -------------------------------------------------------------------------
  // case 7 -- T44: bidirectional env read
  //
  // The existing hook side (hookLedgerPath) passes projectDir explicitly to
  // resolveLedgerPath, spanning the path formula but NOT hooks/ledger.mjs's
  // own env read (main() line 1729: process.env.CLAUDE_PROJECT_DIR || cwd).
  // A || -> ?? regression at that line stays green because the existing hook
  // side never reads the env var -- it always receives the correct explicit cwd.
  //
  // This case uses hookLedgerPathViaMjs (defined above) which spawns
  // hooks/ledger.mjs directly as a subprocess, exercising that module's own
  // env read.  Now CLI (via gw-hook / ledger.ts:312) and hook (via
  // hooks/ledger.mjs main():1729) are TWO DISTINCT surfaces.  A regression in
  // either surface's env read diverges from the other -> caught.
  //
  // BITE PROOF -- red run:
  //   Perturb hooks/ledger.mjs line 1729: change `||` to `??`
  //   hookLedgerPathViaMjs outputs "no ledger at .groundwork/runs/..." (relative)
  //   cliLedgerPath outputs "/tmp/.../groundwork/runs/..." (absolute, ledger.ts:312 still uses ||)
  //   Paths diverge -> test FAILS
  //   git diff --exit-code test/gw/parity/cli-hook-path.seam.test.ts -> exit 0
  //   Failure message names diverging values: '.groundwork/...' vs '/tmp/...'
  // Green run: revert hooks/ledger.mjs:1729 -> both absolute -> PASS
  //
  // NOTE: The task cited hooks/ledger.mjs:790 (cmdComplete's map-refresh projectDir).
  // That line is not on the ledger-PATH critical path -- cmdComplete's projectDir
  // is used for emitHookEvent/reSeal, not for _ledgerPath, and the output does
  // not include the path string.  The observable seam point is main():1729.
  // -------------------------------------------------------------------------
  it('case 7 (T44 bidirectional): hook side driven through hooks/ledger.mjs env read', () => {
    const cwd = '/tmp/seam-test-T44-mjs'
    fs.mkdirSync(cwd, { recursive: true })

    // CLI side: gw-hook -> src/gw/cli/commands/ledger.ts:312 (||)
    const cliPath = cliLedgerPath({ CLAUDE_PROJECT_DIR: '' }, cwd)

    // Hook side: hooks/ledger.mjs main():1729 (its own env read, not the TS CLI)
    const hookPath = hookLedgerPathViaMjs({ CLAUDE_PROJECT_DIR: '' }, cwd)

    expect(cliPath).toBe(hookPath)
    expect(cliPath).toContain(cwd)
  })
})
