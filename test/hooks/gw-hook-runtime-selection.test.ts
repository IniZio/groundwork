/**
 * bin/gw-hook selects a runtime for the 8 TypeScript-sourced hooks. Two failure
 * modes are guarded here, both observed in production (a herdr worktree pane
 * whose PATH contained node but no bun):
 *
 *   1. bun absent -> the shim fell through to `node --experimental-strip-types`,
 *      which cannot remap the NodeNext ".js" import specifiers in src/gw/** to
 *      ".ts". Every hook invocation printed a raw Node ESM resolver stack
 *      (ERR_MODULE_NOT_FOUND on src/gw/cli/router.js) with no mention of bun.
 *   2. bun installed but off PATH -> the same fallback fired even though a
 *      usable bun sat in a well-known location.
 */

import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync, execFileSync } from 'node:child_process'
import os from 'node:os'

const __dir = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dir, '../..')
const GW_HOOK = join(REPO_ROOT, 'bin', 'gw-hook')

const NODE_DIR = dirname(process.execPath)

/** Absolute path to a real bun binary, or null when this machine has none. */
function findBun(): string | null {
  try {
    const p = execFileSync('bash', ['-lc', 'command -v bun'], { encoding: 'utf8' }).trim()
    return p.length > 0 && existsSync(p) ? p : null
  } catch {
    return null
  }
}

interface RunResult {
  status: number | null
  stdout: string
  stderr: string
}

/**
 * Run bin/gw-hook with a PATH that contains node but NOT bun, and with HOME
 * pointed at `home` so the shim's well-known-location probes see only what the
 * test placed there.
 */
function runWithoutBunOnPath(home: string, args: string[]): RunResult {
  const result = spawnSync(GW_HOOK, args, {
    input: JSON.stringify({
      session_id: 'gw-hook-runtime-selection',
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/dev/null' },
    }),
    encoding: 'utf8',
    env: { // Deliberately minimal: no inherited PATH, no inherited GW_BUN.
      PATH: `${NODE_DIR}:/usr/bin:/bin`,
      HOME: home,
      CLAUDE_PROJECT_DIR: home,
      CLAUDE_SESSION_ID: 'gw-hook-runtime-selection',
    },
    timeout: 15_000,
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

describe('bin/gw-hook runtime selection — bun unreachable', () => {
  it('fails with a legible bun diagnostic, not a raw Node ESM resolver stack', () => {
    const home = mkdtempSync(join(os.tmpdir(), 'gw-hook-nobun-'))
    try {
      const r = runWithoutBunOnPath(home, ['hook', 'nesting-guard'])

      expect(
        r.stderr,
        `gw-hook leaked Node's ESM resolver stack instead of naming the missing runtime.\nstderr was:\n${r.stderr}`,
      ).not.toMatch(/ERR_MODULE_NOT_FOUND|internal\/modules\/esm\/resolve/)

      expect(
        r.stderr.toLowerCase(),
        `gw-hook diagnostic must name bun so the operator knows what to install.\nstderr was:\n${r.stderr}`,
      ).toContain('bun')

      expect(r.stdout, 'gw-hook must emit nothing on stdout').toBe('') // Hook protocols read JSON from stdout; the shim must stay silent there.

      expect(r.status, 'gw-hook must fail loudly, not silently succeed').not.toBe(0)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('bin/gw-hook runtime selection — bun installed but off PATH', () => {
  const bun = findBun()

  it.skipIf(bun === null)('discovers bun under $HOME/.bun/bin and runs the hook', () => {
    const home = mkdtempSync(join(os.tmpdir(), 'gw-hook-offpath-bun-'))
    try {
      mkdirSync(join(home, '.bun', 'bin'), { recursive: true })
      symlinkSync(bun as string, join(home, '.bun', 'bin', 'bun'))

      const r = runWithoutBunOnPath(home, ['hook', 'nesting-guard'])

      expect(
        r.stderr,
        `gw-hook ignored a usable bun at $HOME/.bun/bin/bun.\nstderr was:\n${r.stderr}`,
      ).not.toMatch(/ERR_MODULE_NOT_FOUND|internal\/modules\/esm\/resolve/)

      expect(
        r.status,
        `nesting-guard passthrough must exit 0 when bun is reachable.\nstderr was:\n${r.stderr}`,
      ).toBe(0)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
