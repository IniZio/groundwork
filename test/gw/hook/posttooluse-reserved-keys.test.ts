/**
 * test/gw/hook/posttooluse-reserved-keys.test.ts
 *
 * Guards against any PostToolUse hook emitting a reserved Claude Code hook
 * JSON key on stdout — which causes a user-visible runtime error:
 *   "PostToolUse hook error — Hook JSON output validation failed"
 *
 * Background: struggle-detector.ts:387 previously emitted `decision: 'SIGNAL'`.
 * `decision` is a reserved PostToolUse field validated against "approve"|"block",
 * so every fired signal produced the error above. It was fixed to `signal: 'SIGNAL'`.
 * Nothing in the suite would catch reintroduction; this test closes that gap.
 *
 * Design:
 *  1. Drive the REAL DEPLOYED PATH via spawnSync on ./bin/gw-hook — the bug
 *     only manifests through the registered invocation path, not the TS module.
 *  2. Fire an actual signal: GROUNDWORK_STRUGGLE_THRESHOLD=2, temp CLAUDE_PROJECT_DIR,
 *     same Bash payload twice so repeat-command trips.
 *  3. POSITIVE CONTROL FIRST: assert stdout is non-empty and every line parses
 *     as JSON. Without this, a hook that silently stops emitting would make the
 *     negative assertion vacuous.
 *  4. Then assert no emitted object has a reserved PostToolUse top-level key.
 *  5. GENERALIZE: reads PostToolUse registrations from hooks/hooks.json and
 *     iterates them, so a future PostToolUse hook inherits the guard automatically.
 *     Hooks whose stdout is legitimately non-JSON (e.g. doc-size-guard.mjs) are
 *     handled by skipping non-JSON lines — without making the whole test vacuous.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dir = dirname(__filename)
const REPO_ROOT = join(__dir, '../../..')

// ---------------------------------------------------------------------------
// Reserved PostToolUse top-level keys (Claude Code hook protocol).
// Any of these in hook stdout causes:
//   "PostToolUse hook error — Hook JSON output validation failed"
// ---------------------------------------------------------------------------

const RESERVED_POSTTOOLUSE_KEYS: string[] = [
  'decision',
  'continue',
  'stopReason',
  'suppressOutput',
  'systemMessage',
  'reason',
  'hookSpecificOutput',
]

// ---------------------------------------------------------------------------
// hooks.json loading
// ---------------------------------------------------------------------------

interface HookEntry {
  type: string
  command: string
  async?: boolean
}
interface HookGroup {
  matcher: string
  hooks: HookEntry[]
}
interface HooksJson {
  hooks: Record<string, HookGroup[] | undefined>
}

interface RegisteredHook {
  command: string
  matcher: string
}

function loadPostToolUseHooks(): RegisteredHook[] {
  const hooksJsonPath = join(REPO_ROOT, 'hooks', 'hooks.json')
  const raw = JSON.parse(readFileSync(hooksJsonPath, 'utf8')) as HooksJson
  const groups = raw.hooks['PostToolUse'] ?? []
  const result: RegisteredHook[] = []
  for (const group of groups) {
    for (const hook of group.hooks) {
      if (hook.type === 'command') {
        result.push({ command: hook.command, matcher: group.matcher })
      }
    }
  }
  return result
}

function resolveCommand(cmd: string): string {
  return cmd.replace('${CLAUDE_PLUGIN_ROOT}', REPO_ROOT)
}

function parseArgv(cmd: string): { bin: string; args: string[] } {
  const parts = cmd.trim().split(/\s+/)
  return { bin: parts[0]!, args: parts.slice(1) }
}

// ---------------------------------------------------------------------------
// Fixture payload — a Bash tool-use that will trip repeat-command at threshold=2
// ---------------------------------------------------------------------------

const SESSION_ID = 'posttooluse-guard-test-session'

const BASH_PAYLOAD = JSON.stringify({
  tool_name: 'Bash',
  tool_use_id: 'test-tool-use-1',
  session_id: SESSION_ID,
  tool_input: { command: 'git status' },
  tool_response: { exit_code: 0, stdout: 'nothing to commit', stderr: '' },
})

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('PostToolUse hooks — no reserved Claude Code keys on stdout', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'gw-ptu-guard-'))
  })

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  const postToolUseHooks = loadPostToolUseHooks()

  // Sanity: the hooks.json must contain at least one PostToolUse hook.
  // If this fails, the generalization silently guards nothing.
  it('hooks/hooks.json has at least one PostToolUse registration', () => {
    expect(postToolUseHooks.length).toBeGreaterThan(0)
  })

  // Sanity: struggle-detector must be among them so the positive control fires.
  it('struggle-detector is registered as a PostToolUse hook', () => {
    const found = postToolUseHooks.some(h => h.command.includes('struggle-detector'))
    expect(found, 'struggle-detector not found in PostToolUse registrations in hooks/hooks.json').toBe(true)
  })

  for (const { command, matcher } of postToolUseHooks) {
    const resolvedCmd = resolveCommand(command)
    const { bin, args } = parseArgv(resolvedCmd)
    const hookLabel = resolvedCmd.replace(REPO_ROOT + '/', '')
    const isStruggleDetector = resolvedCmd.includes('struggle-detector')

    describe(`hook: ${hookLabel} (matcher: ${matcher})`, () => {
      it('emits no reserved PostToolUse key on stdout', () => {
        if (isStruggleDetector) {
          // ──────────────────────────────────────────────────────────────
          // struggle-detector: fire a real signal and apply positive control
          // ──────────────────────────────────────────────────────────────

          // First invocation: count reaches 1 (below threshold=2, no signal yet)
          const r1 = spawnSync(bin, args, {
            input: BASH_PAYLOAD,
            encoding: 'utf8',
            env: {
              ...process.env,
              CLAUDE_PROJECT_DIR: tmpDir,
              GROUNDWORK_STRUGGLE_THRESHOLD: '2',
            },
            timeout: 10000,
          })
          expect(
            r1.error,
            `struggle-detector first spawn failed: ${r1.error?.message ?? ''}`,
          ).toBeUndefined()
          expect(r1.status).toBe(0)

          // Second invocation: count reaches 2 == threshold → repeat-command signal fired
          const r2 = spawnSync(bin, args, {
            input: BASH_PAYLOAD,
            encoding: 'utf8',
            env: {
              ...process.env,
              CLAUDE_PROJECT_DIR: tmpDir,
              GROUNDWORK_STRUGGLE_THRESHOLD: '2',
            },
            timeout: 10000,
          })
          expect(
            r2.error,
            `struggle-detector second spawn failed: ${r2.error?.message ?? ''}`,
          ).toBeUndefined()
          expect(r2.status).toBe(0)

          // POSITIVE CONTROL (step 3): stdout must be non-empty and every line
          // must parse as JSON. If the hook silently stops emitting, an
          // all-negative test would vacuously pass — this assertion prevents that.
          const lines = (r2.stdout ?? '').trim().split('\n').filter(l => l.trim() !== '')
          expect(
            lines.length,
            'struggle-detector must emit at least one JSON line when threshold is crossed — ' +
            `stdout was: ${JSON.stringify(r2.stdout)}`,
          ).toBeGreaterThan(0)

          for (const line of lines) {
            let parsed: Record<string, unknown>
            try {
              parsed = JSON.parse(line) as Record<string, unknown>
            } catch {
              throw new Error(
                `struggle-detector stdout line is not valid JSON: ${JSON.stringify(line)}`,
              )
            }

            // Step 4: assert no reserved PostToolUse key is present
            for (const key of RESERVED_POSTTOOLUSE_KEYS) {
              expect(
                Object.prototype.hasOwnProperty.call(parsed, key),
                `struggle-detector emitted reserved PostToolUse key "${key}" ` +
                `in stdout object — Claude Code will reject it. ` +
                `Object was: ${JSON.stringify(parsed)}`,
              ).toBe(false)
            }
          }
        } else {
          // ──────────────────────────────────────────────────────────────
          // Other PostToolUse hooks (e.g. doc-size-guard.mjs).
          // doc-size-guard emits plain-text violation messages (not JSON)
          // for over-budget doc-class files, and is silent otherwise.
          // We skip non-JSON lines rather than failing to avoid false
          // positives — but we still assert the exit code so the hook at
          // least runs successfully through the deployed path.
          // ──────────────────────────────────────────────────────────────
          const result = spawnSync(bin, args, {
            input: BASH_PAYLOAD,
            encoding: 'utf8',
            env: {
              ...process.env,
              CLAUDE_PROJECT_DIR: tmpDir,
            },
            timeout: 10000,
          })
          expect(
            result.error,
            `hook "${hookLabel}" spawn failed: ${result.error?.message ?? ''}`,
          ).toBeUndefined()
          expect(result.status).toBe(0)

          const stdout = (result.stdout ?? '').trim()
          if (!stdout) return // silent output → no JSON keys to check

          const lines = stdout.split('\n').filter(l => l.trim() !== '')
          for (const line of lines) {
            let parsed: Record<string, unknown>
            try {
              parsed = JSON.parse(line) as Record<string, unknown>
            } catch {
              // Not JSON — skip. Hooks like doc-size-guard.mjs legitimately
              // emit human-readable plain-text violation messages, not JSON
              // objects, so a parse failure here is not a bug.
              continue
            }

            // If a line IS valid JSON, assert no reserved PostToolUse key
            for (const key of RESERVED_POSTTOOLUSE_KEYS) {
              expect(
                Object.prototype.hasOwnProperty.call(parsed, key),
                `hook "${hookLabel}" emitted reserved PostToolUse key "${key}" ` +
                `in stdout object — Claude Code will reject it. ` +
                `Object was: ${JSON.stringify(parsed)}`,
              ).toBe(false)
            }
          }
        }
      })
    })
  }
})
