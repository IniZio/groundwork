/**
 * src/gw/hook/session-reminder.ts — Thin wrapper delegating to hooks/session-reminder.mjs.
 *
 * Bridges the new gw-hook dispatch layer to the existing legacy implementation
 * until a full TypeScript port lands (mirrors the pattern used for stop-gate.ts).
 */
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HookFn } from './types.js'

const __dir = dirname(fileURLToPath(import.meta.url))
/**
 * Works from both src/gw/hook/ and dist/gw/hook/ — three levels up reaches the
 * groundwork repo root, then we descend into hooks/.
 */
const LEGACY_MJS = resolve(__dir, '../../../hooks/session-reminder.mjs')

export const run: HookFn = async (input, _env) => {
  const result = spawnSync('node', [LEGACY_MJS], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 30_000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit: result.status ?? 1,
  }
}
