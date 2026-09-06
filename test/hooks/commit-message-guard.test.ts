import { describe, it, expect } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dir = dirname(__filename)
const REPO_ROOT = join(__dir, '../..')
const GW_HOOK_SHIM = join(REPO_ROOT, 'bin', 'gw-hook')

function runHook(
  stdin: string,
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(GW_HOOK_SHIM, ['hook', 'commit-message-guard'], {
    input: stdin,
    encoding: 'utf-8',
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'test', ...env },
    timeout: 10_000,
  })
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status }
}

function bashPayload(command: string): string {
  return JSON.stringify({ tool_name: 'Bash', tool_input: { command } })
}

describe('commit-message-guard hook', () => {
  it('TC1: valid subject-only message passes through', () => {
    const payload = bashPayload('git commit -m "fix(auth): correct token expiry check"')
    const { stdout, status } = runHook(payload)
    expect(status).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('TC2: message with body is denied', () => {
    const payload = bashPayload(
      'git commit -m "fix(auth): correct token expiry check" -m "This explains the why"',
    )
    const { stdout, status } = runHook(payload)
    expect(status).toBe(0)
    expect(stdout.trim()).not.toBe('')
    const parsed = JSON.parse(stdout.trim()) as {
      hookSpecificOutput: {
        permissionDecision: string
        permissionDecisionReason: string
      }
    }
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toMatch(/line/)
  })

  it('TC3: process vocabulary in subject is denied with line 1 reference', () => {
    const payload = bashPayload('git commit -m "fix(auth): advisor APPROVE gate cycle"')
    const { stdout, status } = runHook(payload)
    expect(status).toBe(0)
    expect(stdout.trim()).not.toBe('')
    const parsed = JSON.parse(stdout.trim()) as {
      hookSpecificOutput: {
        permissionDecision: string
        permissionDecisionReason: string
      }
    }
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toMatch(/line 1/)
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toMatch(/process vocabulary/)
  })

  it('TC4: -F file form passes through', () => {
    const payload = bashPayload('git commit -F /tmp/commit-msg.txt')
    const { stdout, status } = runHook(payload)
    expect(status).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('TC5: editor-driven commit (no -m flag) passes through', () => {
    const payload = bashPayload('git commit --amend')
    const { stdout, status } = runHook(payload)
    expect(status).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('TC6: kill switch GROUNDWORK_COMMIT_LINT=0 suppresses denial', () => {
    const badPayload = bashPayload(
      'git commit -m "fix(auth): correct token expiry check" -m "This explains the why"',
    )

    const withoutKillSwitch = runHook(badPayload)
    expect(withoutKillSwitch.status).toBe(0)
    expect(withoutKillSwitch.stdout.trim()).not.toBe('')
    const parsed = JSON.parse(withoutKillSwitch.stdout.trim()) as {
      hookSpecificOutput: { permissionDecision: string }
    }
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny')

    const withKillSwitch = runHook(badPayload, { GROUNDWORK_COMMIT_LINT: '0' })
    expect(withKillSwitch.status).toBe(0)
    expect(withKillSwitch.stdout.trim()).toBe('')
  })

  it('TC7: non-git-commit Bash command passes through', () => {
    const payload = bashPayload('echo hello')
    const { stdout, status } = runHook(payload)
    expect(status).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('TC8: non-Bash tool name passes through', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { command: 'git commit -m "fix: something bad"' },
    })
    const { stdout, status } = runHook(payload)
    expect(status).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('TC9: attribution trailer is stripped and valid subject passes through', () => {
    const payload = bashPayload(
      'git commit -m "fix(auth): correct token expiry" -m "Claude-Session: https://claude.ai/test"',
    )
    const { stdout, status } = runHook(payload)
    expect(status).toBe(0)
    expect(stdout.trim()).toBe('')
  })
})
