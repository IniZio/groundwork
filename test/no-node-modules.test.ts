/**
 * Regression test: every plugin entrypoint must exit cleanly without node_modules.
 *
 * The repo ships committed bundles (dist/) so remote plugin installs with no
 * node_modules can run. This test rsync-copies the repo (excluding node_modules)
 * to a temp dir and asserts every entrypoint exits cleanly:
 *
 *   - bin/* wrappers — use dist/ bundles
 *   - Directly-registered hooks/*.mjs — registered bare in hooks.json
 *   - Hooks dispatched via bin/gw-hook — go through dist/gw.mjs
 *   - hooks/session-start shim — delegates to bin/gw-hook → dist/gw.mjs
 *
 * Excluded from coverage (intentional):
 *   - hooks/*.mjs source files that are NOT in hooks.json and have no exec bit
 *     (exit 126 when called bare); they are only ever invoked through their
 *     bundled bin/ or gw-hook paths, both of which are covered above.
 *   - hooks/ledger.mjs and hooks/session-reminder.mjs: have exec bits but are
 *     not registered in hooks.json; their production paths go through
 *     dist/hooks-ledger.mjs and dist/gw.mjs→dist/hooks-session-reminder.mjs.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../')

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'gw-no-nm-test-'))
  const result = spawnSync(
    'rsync',
    ['-a', '--exclude=node_modules', '--exclude=.git', `${repoRoot}/`, `${tmpDir}/`],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error(`rsync failed (exit ${result.status}): ${result.stderr}`)
  }
})

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

// Helper: register a test that spawns an entrypoint after tmpDir is set.
// IMPORTANT: `file` and `args` are evaluated lazily inside the test callback
// so that `tmpDir` is already populated by beforeAll when they run.
function assertExits0(
  label: string,
  getFile: () => string,
  getArgs: () => string[],
  opts: { input?: string } = {},
): void {
  test(label, () => {
    const file = getFile()
    const args = getArgs()
    const result = spawnSync(file, args, {
      env: { PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
      input: opts.input,
    })
    expect(
      result.status,
      `${label} exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0)
  })
}

// ── bin/* wrappers ────────────────────────────────────────────────────────────
describe('bin CLIs without node_modules', () => {
  assertExits0(
    'bin/ledger exits 0',
    () => `${tmpDir}/bin/ledger`,
    () => ['help'],
  )
  assertExits0(
    'bin/spec exits 0',
    () => `${tmpDir}/bin/spec`,
    () => ['help'],
  )
  assertExits0(
    'bin/journal exits 0',
    () => `${tmpDir}/bin/journal`,
    () => ['help'],
  )
  assertExits0(
    'bin/gw-hook exits 0',
    () => `${tmpDir}/bin/gw-hook`,
    () => ['help'],
  )
})

// ── Directly-registered hooks (registered bare in hooks.json) ─────────────────
// These are invoked by Claude Code as-is on every matching tool call.
// They MUST work without node_modules.
describe('directly-registered hooks without node_modules', () => {
  const EMPTY_HOOK = '{}'
  const directHooks = [
    'hooks/spec-guard.mjs',
    'hooks/deslop-guard.mjs',
    'hooks/prose-negation-guard.mjs',
    'hooks/prose-modality-guard.mjs',
    'hooks/doc-read-guard.mjs',
    'hooks/doc-size-guard.mjs',
    'hooks/keyword-router.mjs',
  ]
  for (const rel of directHooks) {
    // Capture rel in a closure to avoid loop-variable capture bug
    const capturedRel = rel
    assertExits0(
      `${capturedRel} exits 0`,
      () => `${tmpDir}/${capturedRel}`,
      () => [],
      { input: EMPTY_HOOK },
    )
  }
})

// ── gw-hook dispatched hooks (all go through dist/gw.mjs) ────────────────────
// Registered in hooks.json as: ${CLAUDE_PLUGIN_ROOT}/bin/gw-hook hook <name>
// The dist/gw.mjs bundle carries all dependencies inline.
describe('gw-hook dispatched hooks without node_modules', () => {
  const EMPTY_HOOK = '{}'
  const subCommands = [
    'agent-model-guard',
    'nesting-guard',
    'ledger-guard',
    'ledger-bash-guard',
    'piped-exit-code-guard',
    'orchestrator-impl-guard',
    'struggle-detector',
    'stop-gate',
  ]
  for (const sub of subCommands) {
    const capturedSub = sub
    assertExits0(
      `bin/gw-hook hook ${capturedSub} exits 0`,
      () => `${tmpDir}/bin/gw-hook`,
      () => ['hook', capturedSub],
      { input: EMPTY_HOOK },
    )
  }
})

// ── session-start shim ────────────────────────────────────────────────────────
// Registered as: ${CLAUDE_PLUGIN_ROOT}/hooks/session-start
// Shim delegates to bin/gw-hook → dist/gw.mjs
describe('session-start shim without node_modules', () => {
  assertExits0(
    'hooks/session-start exits 0',
    () => `${tmpDir}/hooks/session-start`,
    () => [],
    { input: JSON.stringify({ session_id: 'test', type: 'startup' }) },
  )
})
