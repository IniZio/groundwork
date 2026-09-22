/**
 * test/gw/hook/posttooluse-reserved-keys.test.ts
 *
 * Guards against any PostToolUse hook emitting a reserved Claude Code hook
 * JSON key on stdout — which causes a user-visible runtime error:
 *   "PostToolUse hook error — Hook JSON output validation failed"
 *
 * Positive control: comment-density-guard emits JSON on a dense file, proving
 * the detection infrastructure can see real hook output. A bite-proof test
 * confirms the same hook is silent on a sparse file.
 *
 * Reads PostToolUse registrations from hooks/hooks.json and iterates them,
 * so a future PostToolUse hook inherits the guard automatically.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
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

  it('comment-density-guard emits non-empty JSON when density threshold exceeded', () => {
    const denseFile = join(tmpDir, 'dense-comments.ts')
    const codeLines = Array.from({length: 30}, (_, i) => `const v${i} = ${i}`)
    const commentLines = Array.from({length: 10}, (_, i) => `// comment line ${i + 1}`)
    const highDensity = [...commentLines.slice(0, 5), ...codeLines.slice(0, 15), ...commentLines.slice(5), ...codeLines.slice(15)].join('\n') + '\n'
    writeFileSync(denseFile, highDensity)

    const bin = join(REPO_ROOT, 'bin', 'gw-hook')
    const payload = JSON.stringify({
      tool_name: 'Edit',
      tool_input: {
        file_path: denseFile,
        old_string: 'const a = 1',
        new_string: 'const a = 1 // still dense',
      },
      session_id: SESSION_ID,
      cwd: tmpDir,
    })

    const r = spawnSync(bin, ['hook', 'comment-density-guard'], {
      input: payload,
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env },
    })
    expect(r.error, `comment-density-guard spawn failed: ${r.error?.message ?? ''}`).toBeUndefined()
    expect(r.status).toBe(0)

    const out = (r.stdout ?? '').trim()
    expect(out.length, 'comment-density-guard produced no output on dense file — positive control failed').toBeGreaterThan(0)
    expect(() => JSON.parse(out), `comment-density-guard output is not valid JSON: ${out}`).not.toThrow()
  })

  it('comment-density-guard is silent on low-density file (bite proof)', () => {
    const sparseFile = join(tmpDir, 'sparse.ts')
    writeFileSync(sparseFile, 'const a = 1\nconst b = 2\nconst c = 3\n')

    const bin = join(REPO_ROOT, 'bin', 'gw-hook')
    const payload = JSON.stringify({
      tool_name: 'Edit',
      tool_input: {
        file_path: sparseFile,
        old_string: 'const a = 1',
        new_string: 'const a = 1',
      },
      session_id: SESSION_ID,
      cwd: tmpDir,
    })
    const r = spawnSync(bin, ['hook', 'comment-density-guard'], {
      input: payload,
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env },
    })
    expect(r.status).toBe(0)
    expect((r.stdout ?? '').trim()).toBe('')
  })

  for (const { command, matcher } of postToolUseHooks) {
    const resolvedCmd = resolveCommand(command)
    const { bin, args } = parseArgv(resolvedCmd)
    const hookLabel = resolvedCmd.replace(REPO_ROOT + '/', '')

    describe(`hook: ${hookLabel} (matcher: ${matcher})`, () => {
      it('emits no reserved PostToolUse key on stdout', () => {
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
        if (!stdout) return

        const lines = stdout.split('\n').filter(l => l.trim() !== '')
        for (const line of lines) {
          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(line) as Record<string, unknown>
          } catch {
            continue
          }

          for (const key of RESERVED_POSTTOOLUSE_KEYS) {
            expect(
              Object.prototype.hasOwnProperty.call(parsed, key),
              `hook "${hookLabel}" emitted reserved PostToolUse key "${key}" ` +
              `in stdout object — Claude Code will reject it. ` +
              `Object was: ${JSON.stringify(parsed)}`,
            ).toBe(false)
          }
        }
      })
    })
  }
})
