/**
 * src/gw/hook/session-reminder.ts — Thin wrapper delegating to hooks/session-reminder.mjs.
 *
 * Bridges the new gw-hook dispatch layer to the existing legacy implementation
 * until a full TypeScript port lands (mirrors the pattern used for stop-gate.ts).
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HookFn } from './types.js'

const __dir = dirname(fileURLToPath(import.meta.url))
/**
 * Repo root: prefer GW_REPO_ROOT (set by gw-hook when running the committed
 * bundle, where import.meta.url resolves to dist/gw.mjs rather than the
 * original src/gw/hook/ location), then fall back to three-levels-up for
 * direct source execution.
 */
const _repoRoot = process.env.GW_REPO_ROOT ?? resolve(__dir, '../../../')
const LEGACY_MJS = resolve(_repoRoot, 'hooks/session-reminder.mjs')
/** Committed bundle — no node_modules needed. Preferred over source on remote installs. */
const BUNDLE = resolve(_repoRoot, 'dist/hooks-session-reminder.mjs')

export const run: HookFn = async (input, _env) => {
  // Prefer the committed bundle (runs with zero node_modules on remote installs).
  // Fall back to node + source when the bundle is absent (local dev, fresh clone).
  const useBundle = existsSync(BUNDLE)
  const runtime = useBundle ? 'bun' : 'node'
  const script = useBundle ? BUNDLE : LEGACY_MJS
  const result = spawnSync(runtime, [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 30_000,
    // Ensure CLAUDE_PLUGIN_ROOT is always set so schema-io resolves schemas/
    // correctly when running the bundle (import.meta.url points to dist/, not source).
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT ?? _repoRoot },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit: result.status ?? 1,
  }
}
