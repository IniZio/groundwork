/**
 * Unit tests for hooks/session-reminder.mjs session-identity injection.
 *
 * Verifies the SessionStart hook surfaces session_id + transcript_path from
 * stdin into additionalContext, and never crashes on empty/invalid input.
 * Fast, deterministic — runs in milliseconds via bun test.
 */
import { describe, test, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '../hooks/session-reminder.mjs')

interface HookOutput {
  continue: boolean
  hookSpecificOutput?: { hookEventName: string; additionalContext: string }
}

function runHook(input: string): { out: HookOutput; status: number | null } {
  const result = spawnSync('node', [HOOK], {
    input,
    encoding: 'utf8',
    timeout: 5000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Hook exited ${result.status}: ${result.stderr}`)
  }
  return { out: JSON.parse(result.stdout.trim()), status: result.status }
}

describe('session-reminder: session identity injection', () => {
  test('stdin with session_id + transcript_path → both appear in additionalContext', () => {
    const fixture = JSON.stringify({
      session_id: 'abc-123',
      transcript_path: '/home/user/.claude/projects/-foo-bar/abc-123.jsonl',
      cwd: '/foo/bar',
      hook_event_name: 'SessionStart',
      source: 'startup',
    })
    const { out } = runHook(fixture)
    expect(out.continue).toBe(true)
    expect(out.hookSpecificOutput?.hookEventName).toBe('SessionStart')
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('## Session identity')
    expect(ctx).toContain('session_id: abc-123')
    expect(ctx).toContain('transcript_path: /home/user/.claude/projects/-foo-bar/abc-123.jsonl')
    expect(ctx).toContain('/groundwork:handoff')
    // Existing reminder content is preserved
    expect(ctx).toContain('# groundwork — Orchestrator Mode')
  })

  test('empty stdin → valid JSON, reminder intact, no Session identity section, exit 0', () => {
    const { out, status } = runHook('')
    expect(status).toBe(0)
    expect(out.continue).toBe(true)
    expect(out.hookSpecificOutput?.hookEventName).toBe('SessionStart')
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('# groundwork — Orchestrator Mode')
    expect(ctx).not.toContain('## Session identity')
  })

  test('invalid JSON on stdin → still outputs valid reminder without identity', () => {
    const { out, status } = runHook('not json at all')
    expect(status).toBe(0)
    expect(out.continue).toBe(true)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('# groundwork — Orchestrator Mode')
    expect(ctx).not.toContain('## Session identity')
  })
})
