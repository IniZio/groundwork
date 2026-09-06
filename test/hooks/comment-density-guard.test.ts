/**
 * test/hooks/comment-density-guard.test.ts
 *
 * Invocation-path + behaviour tests for the comment-density-guard hook.
 * Spawns via `bin/gw-hook hook comment-density-guard` — not by module import.
 */

import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import os from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dir = dirname(__filename)
const REPO_ROOT = join(__dir, '../..')
const GW_HOOK_SHIM = join(REPO_ROOT, 'bin', 'gw-hook')

function runHook(
  stdin: string,
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(GW_HOOK_SHIM, ['hook', 'comment-density-guard'], {
    input: stdin,
    encoding: 'utf-8',
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'test', ...env },
    timeout: 10_000,
  })
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status }
}

const OVER_CAP_CONTENT = [
  'const a = 1',
  'const b = 2',
  'const c = 3',
  'const d = 4',
  'const e = 5',
  'const f = 6',
  'const g = 7',
  'const h = 8',
  'const i = 9',
  'const j = 10',
  'const k = 11',
  'const l = 12',
  'const m = 13',
  'const n = 14',
  'const o = 15',
  'const p = 16',
  'const q = 17',
  'const r = 18',
  '// first comment',
  '// second comment',
].join('\n')

const RESTATING_CONTENT = [
  'const a = 1',
  'const b = 2',
  'const c = 3',
  'const d = 4',
  'const e = 5',
  'const f = 6',
  'const g = 7',
  'const h = 8',
  'const i = 9',
  'const j = 10',
  'const k = 11',
  'const l = 12',
  'const m = 13',
  'const n = 14',
  'const o = 15',
  'const p = 16',
  'const q = 17',
  'const r = 18',
  '// foo',
  'function foo() {}',
].join('\n')

const CLEAN_CONTENT = [
  'const a = 1',
  'const b = 2',
  'const c = 3',
  'const d = 4',
  'const e = 5',
  'const f = 6',
  'const g = 7',
  'const h = 8',
  'const i = 9',
  'const j = 10',
  'const k = 11',
  'const l = 12',
  'const m = 13',
  'const n = 14',
  'const o = 15',
  'const p = 16',
  'const q = 17',
  'const r = 18',
  'const s = 19',
  'const t = 20',
].join('\n')

describe('comment-density-guard hook', () => {
  it('TC1: malformed stdin → empty stdout, exit 0', () => {
    const { stdout, status } = runHook('not-valid-json')
    expect(status).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('TC2: kill switch (GROUNDWORK_COMMENT_DENSITY=0) → empty stdout, exit 0', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/gw-cdg-killswitch.ts', content: OVER_CAP_CONTENT },
    })
    const { stdout, status } = runHook(payload, { GROUNDWORK_COMMENT_DENSITY: '0' })
    expect(status).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('TC3: subagent + clean file → non-empty stdout with rule text, no permissionDecision', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/gw-cdg-subagent.ts', content: CLEAN_CONTENT },
      agent_type: 'general-purpose',
    })
    const { stdout, status } = runHook(payload)
    expect(status).toBe(0)
    expect(stdout.trim()).not.toBe('')

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>
    expect(parsed).toHaveProperty('hookSpecificOutput')
    const hso = parsed.hookSpecificOutput as Record<string, unknown>
    expect(hso).toHaveProperty('additionalContext')
    expect(hso.additionalContext as string).toContain('≤5')
    expect(parsed).not.toHaveProperty('permissionDecision')
    expect(hso).not.toHaveProperty('permissionDecision')
  })

  it('TC4: Write pushing file over 5/100 cap → over-cap in additionalContext, no permissionDecision', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/gw-cdg-overcap.ts', content: OVER_CAP_CONTENT },
    })
    const { stdout, status } = runHook(payload)
    expect(status).toBe(0)
    expect(stdout.trim()).not.toBe('')

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>
    expect(parsed).toHaveProperty('hookSpecificOutput')
    const hso = parsed.hookSpecificOutput as Record<string, unknown>
    const ctx = hso.additionalContext as string
    expect(ctx).toContain('over-cap')
    expect(ctx).toContain('gw-cdg-overcap.ts')
    expect(parsed).not.toHaveProperty('permissionDecision')
    expect(hso).not.toHaveProperty('permissionDecision')
  })

  it('TC5: Edit pushing file over cap → over-cap in additionalContext', () => {
    const tmpDir = mkdtempSync(join(os.tmpdir(), 'gw-cdg-edit-'))
    try {
      const filePath = join(tmpDir, 'subject.ts')
      writeFileSync(filePath, CLEAN_CONTENT, 'utf-8')

      const payload = JSON.stringify({
        tool_name: 'Edit',
        tool_input: {
          file_path: filePath,
          old_string: 'const s = 19\nconst t = 20',
          new_string: '// comment one\n// comment two\nconst s = 19\nconst t = 20',
        },
      })
      const { stdout, status } = runHook(payload)
      expect(status).toBe(0)
      expect(stdout.trim()).not.toBe('')

      const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>
      expect(parsed).toHaveProperty('hookSpecificOutput')
      const hso = parsed.hookSpecificOutput as Record<string, unknown>
      expect(hso.additionalContext as string).toContain('over-cap')
      expect(parsed).not.toHaveProperty('permissionDecision')
      expect(hso).not.toHaveProperty('permissionDecision')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('TC6: Write with restating comment, density at cap (not over) → restating in additionalContext', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/gw-cdg-restating.ts', content: RESTATING_CONTENT },
    })
    const { stdout, status } = runHook(payload)
    expect(status).toBe(0)
    expect(stdout.trim()).not.toBe('')

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>
    expect(parsed).toHaveProperty('hookSpecificOutput')
    const hso = parsed.hookSpecificOutput as Record<string, unknown>
    expect(hso.additionalContext as string).toContain('restating')
    expect(parsed).not.toHaveProperty('permissionDecision')
    expect(hso).not.toHaveProperty('permissionDecision')
  })

  it('TC7: clean file, no agent_type → empty stdout (passthrough)', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/gw-cdg-clean.ts', content: CLEAN_CONTENT },
    })
    const { stdout, status } = runHook(payload)
    expect(status).toBe(0)
    expect(stdout.trim()).toBe('')
  })
})
