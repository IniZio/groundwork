/**
 * Tests for hooks/lib/hook-io.mjs — isEmbeddedAgent() — and its behavioural
 * effect on session-reminder.mjs.
 *
 * Covers existing behaviour:
 *   - sdk-py and sdk-js return true (embedded SDK agents; injection suppressed)
 *   - cli and unset return false (interactive session; injection fires)
 *
 * sdk-cli (non-interactive print mode, CLAUDE_CODE_ENTRYPOINT=sdk-cli) is
 * deliberately NOT asserted here.  Empirically, `claude -p` run from within the
 * groundwork repo reports CLAUDE_CODE_ENTRYPOINT=sdk-cli (finding 4,
 * tickets/s0-eval-design.md, 2026-08-30).  Whether isEmbeddedAgent() should
 * guard sdk-cli is a guard-semantics question that is out of scope for the
 * obsidian-native-groundwork motive and is deferred to the
 * eval-probe-persona-leak motive.
 */

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HOOK_IO = '../../hooks/lib/hook-io.mjs'
const SESSION_REMINDER = path.resolve(import.meta.dirname, '../../hooks/session-reminder.mjs')

let originalEntrypoint: string | undefined

beforeEach(() => {
  originalEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
})

afterEach(() => {
  if (originalEntrypoint === undefined) {
    delete process.env.CLAUDE_CODE_ENTRYPOINT
  } else {
    process.env.CLAUDE_CODE_ENTRYPOINT = originalEntrypoint
  }
})

describe('isEmbeddedAgent() — unit', () => {
  it('returns false for interactive cli sessions', async () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    const { isEmbeddedAgent } = await import(HOOK_IO)
    expect(isEmbeddedAgent()).toBe(false)
  })

  it('returns false when CLAUDE_CODE_ENTRYPOINT is unset', async () => {
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    const { isEmbeddedAgent } = await import(HOOK_IO)
    expect(isEmbeddedAgent()).toBe(false)
  })

  it('returns true for Python SDK embedded agents', async () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'sdk-py'
    const { isEmbeddedAgent } = await import(HOOK_IO)
    expect(isEmbeddedAgent()).toBe(true)
  })

  it('returns true for JavaScript SDK embedded agents', async () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'sdk-js'
    const { isEmbeddedAgent } = await import(HOOK_IO)
    expect(isEmbeddedAgent()).toBe(true)
  })
})

describe('session-reminder.mjs — injection suppression (behavioural)', () => {
  /**
   * Run session-reminder.mjs as a subprocess with the given CLAUDE_CODE_ENTRYPOINT.
   * Returns { stdout, exitCode }.
   */
  function runSessionReminder(entrypoint: string | undefined): { stdout: string; exitCode: number } {
    const env = { ...process.env }
    if (entrypoint === undefined) {
      delete env.CLAUDE_CODE_ENTRYPOINT
    } else {
      env.CLAUDE_CODE_ENTRYPOINT = entrypoint
    }
    try {
      const stdout = execFileSync('node', [SESSION_REMINDER], {
        input: '{}',
        encoding: 'utf8',
        env,
        cwd: '/tmp',
      })
      return { stdout, exitCode: 0 }
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException & { stdout?: string; status?: number }
      return { stdout: e.stdout ?? '', exitCode: e.status ?? 1 }
    }
  }

  it('emits no stdout for sdk-py (pre-existing behaviour)', () => {
    const { stdout, exitCode } = runSessionReminder('sdk-py')
    expect(exitCode).toBe(0)
    expect(stdout).toBe('')
  })

  it('emits injection JSON for interactive cli sessions', () => {
    const { stdout } = runSessionReminder('cli')
    // The hook outputs JSON with continue:true and additionalContext
    const parsed = JSON.parse(stdout)
    expect(parsed).toMatchObject({ continue: true })
    expect(parsed.hookSpecificOutput?.additionalContext).toBeTruthy()
  })
})
