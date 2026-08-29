/**
 * test/gw/parity/runner.ts
 *
 * Execution helpers for the parity test suite.
 * Provides temp-dir setup, env construction, gw hook invocation, and
 * decision classification that matches the corpus capture scripts.
 */

import { spawnSync, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { REPO_ROOT, type DiskSetupEntry } from './corpus-loader.js'

export interface RunResult {
  stdout: string
  stderr: string
  exit: number
}

/** Replace all temp-dir placeholders in a string with the real temp dir path. */
function interpolate(s: string, tempDir: string): string {
  // Corpus uses <temp_dir> (struggle-detector) and <isolated_temp_dir> (stop-gate)
  return s.replace(/<(?:temp_dir|isolated_temp_dir)>/g, tempDir)
}

/**
 * Create an isolated temp dir and apply disk_state_setup entries.
 *
 * Supports two entry shapes:
 *   - string  : shell command with <temp_dir> / <isolated_temp_dir> replaced
 *   - object  : { path, content } — write JSON file at path relative to temp dir
 *
 * Returns the tempDir path and a cleanup function (always safe to call).
 */
export function setupTempDir(diskSetup: DiskSetupEntry[]): {
  tempDir: string
  cleanup: () => void
} {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'gw-parity-'))

  for (const entry of diskSetup) {
    if (typeof entry === 'string') {
      execSync(interpolate(entry, tempDir), { cwd: tempDir })
    } else {
      const obj = entry as { path: string; content_summary?: string; content: unknown }
      const relativePath = interpolate(obj.path, tempDir)
      const fullPath = path.join(tempDir, relativePath)
      mkdirSync(path.dirname(fullPath), { recursive: true })
      const body =
        typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content, null, 2)
      writeFileSync(fullPath, body, 'utf8')
    }
  }

  return {
    tempDir,
    cleanup: () => {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
    },
  }
}

/**
 * Merge fixture env into process.env, replacing temp-dir placeholders.
 * CLAUDE_PROJECT_DIR is always set to tempDir unless the fixture env overrides it.
 */
export function buildEnv(
  fixtureEnv: Record<string, string>,
  tempDir: string,
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_PROJECT_DIR: tempDir,
  }
  for (const [k, v] of Object.entries(fixtureEnv)) {
    merged[k] = interpolate(v, tempDir)
  }
  return merged
}

const GW_MAIN = path.join(REPO_ROOT, 'src/gw/cli/main.ts')

/**
 * Invoke `bun <gw-main> hook <hookName>` with stdinPayload piped to stdin.
 * This is the "gw path" surface for parity.
 */
export function runGwHook(
  hookName: string,
  stdinPayload: unknown,
  env: Record<string, string | undefined>,
): RunResult {
  const result = spawnSync('bun', [GW_MAIN, 'hook', hookName], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env,
    timeout: 15_000,
  })

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit: result.status ?? (result.error ? 1 : 0),
  }
}

/**
 * Classify a hook invocation result as a corpus decision string.
 *
 * Decision vocabulary (from corpus):
 *   PASS       — exit 0, empty stdout (true passthrough)
 *   DENY       — permissionDecision:'deny' in stdout JSON (PreToolUse hooks)
 *   INJECT     — permissionDecision:'allow' + updatedInput.model (agent-model-guard)
 *   ALLOW      — stop-gate exit 0 with {continue:true}, or session-reminder non-empty output
 *   WARN       — orchestrator-impl-guard: additionalContext present, no permissionDecision
 *   SIGNAL     — struggle-detector: any invocation produced non-empty stdout
 *   NO-SIGNAL  — struggle-detector: all invocations produced empty stdout
 *
 * NOTE: struggle-detector uses multi-invocation; pass 'signal-emitted' as a pre-computed
 * boolean via classifyStruggleDecision() instead.
 */
export function classifyDecision(hookName: string, result: RunResult): string {
  const trimmed = result.stdout.trim()

  // ── stop-gate (Stop event) ──────────────────────────────────────────────────
  // All stop-gate fixtures have exit_code 0.  Decision comes from stdout JSON.
  if (hookName === 'stop-gate') {
    if (!trimmed) return 'ALLOW'  // fail-open
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      if (parsed['decision'] === 'block') return 'DENY'
      if (parsed['continue'] === true) return 'ALLOW'
    } catch {
      /* non-JSON: fail-open */
    }
    return 'ALLOW'
  }

  // ── session-reminder (SessionStart) ────────────────────────────────────────
  // Always exits 0.  Non-empty stdout (injection text) = ALLOW.
  if (hookName === 'session-reminder') {
    return trimmed ? 'ALLOW' : 'PASS'
  }

  // ── struggle-detector (PostToolUse, multi-invocation) ─────────────────────
  // Handled by classifyStruggleDecision(); this branch should not be reached.
  if (hookName === 'struggle-detector') {
    return trimmed ? 'SIGNAL' : 'NO-SIGNAL'
  }

  // ── All PreToolUse guards ──────────────────────────────────────────────────
  if (!trimmed && result.exit === 0) return 'PASS'
  if (result.exit !== 0) return 'DENY'

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const hs = parsed?.['hookSpecificOutput'] as Record<string, unknown> | undefined
    if (!hs) return 'PASS'

    const permDecision = hs['permissionDecision']
    if (permDecision === 'deny') return 'DENY'
    if (permDecision === 'allow') {
      const updated = hs['updatedInput'] as Record<string, unknown> | undefined
      if (updated?.['model']) return 'INJECT'
      return 'ALLOW'
    }

    // orchestrator-impl-guard WARN: additionalContext present, no permissionDecision field
    if (hs['additionalContext']) return 'WARN'
  } catch {
    /* non-JSON passthrough */
  }

  return 'PASS'
}

/**
 * Run all invocations of a multi-invocation fixture sequentially
 * (required for struggle-detector's stateful disk writes).
 * Returns the classified decision: SIGNAL if any invocation emitted a signal.
 */
export function runMultiInvocations(
  hookName: string,
  invocations: Array<{ stdin_payload: unknown }>,
  env: Record<string, string | undefined>,
): string {
  let signalEmitted = false
  for (const inv of invocations) {
    const result = runGwHook(hookName, inv.stdin_payload, env)
    if (result.stdout.trim()) signalEmitted = true
  }
  return signalEmitted ? 'SIGNAL' : 'NO-SIGNAL'
}
