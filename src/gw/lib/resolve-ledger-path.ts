/**
 * Shared by src/gw/cli/commands/ledger.ts and src/gw/hook/stop-gate.ts.
 * A deliberate mirror also lives in hooks/lib/ledger-io.mjs — that file is
 * intentionally separate (hooks/ cannot import from src/) and must be kept in
 * sync manually. The parity test in test/resolve-ledger-path-parity.test.ts
 * enforces agreement between the two.
 */
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

/** Path-traversal guard — sessionId must match this before being interpolated into a path. */
export const LEDGER_SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

export function resolveLedgerPath({
  projectDir,
  sessionId,
}: {
  projectDir: string
  sessionId?: string
}): string {
  const legacyPath = path.join(projectDir, '.groundwork', 'run.json')
  if (!sessionId || typeof sessionId !== 'string') return legacyPath
  if (!LEDGER_SAFE_ID.test(sessionId)) return legacyPath

  const perSessionPath = path.join(projectDir, '.groundwork', 'runs', `${sessionId}.json`)

  // Per-session file already exists → use it (new session or resumed).
  if (existsSync(perSessionPath)) return perSessionPath

  // Per-session file doesn't exist yet — check legacy back-compat:
  if (existsSync(legacyPath)) {
    let legacy: Record<string, unknown> | null = null
    try {
      legacy = JSON.parse(readFileSync(legacyPath, 'utf8')) as Record<string, unknown>
    } catch {
      // ignore
    }
    const legacyOwner = legacy?.session_id
    if (!legacyOwner || legacyOwner === sessionId) return legacyPath
  }

  // New run — use per-session path.
  return perSessionPath
}
