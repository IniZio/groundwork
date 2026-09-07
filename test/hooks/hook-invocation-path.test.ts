// corpus-replay.test.ts only iterates commands ending in .mjs, so the 8
// ${CLAUDE_PLUGIN_ROOT}/bin/gw-hook registrations fall outside it — losing
// 16 tests (exec-bit + spawn per hook). This file restores that coverage.

import { describe, it, expect } from 'vitest'
import { readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import os from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dir = dirname(__filename)
// test/hooks/ → test/ → repo root
const REPO_ROOT = join(__dir, '../..')
const HOOKS_JSON_PATH = join(REPO_ROOT, 'hooks', 'hooks.json')
const GW_HOOK_SHIM = join(REPO_ROOT, 'bin', 'gw-hook')

interface GwHookRegistration {
  hookName: string
  eventType: string
  binary: string
  args: string[]
}

function parseGwHookRegistrations(): GwHookRegistration[] {
  const json = JSON.parse(readFileSync(HOOKS_JSON_PATH, 'utf8')) as {
    hooks: Record<string, Array<{ hooks?: Array<{ command: string }> }>>
  }
  const results: GwHookRegistration[] = []
  const seenNames = new Set<string>()

  for (const [eventType, groupList] of Object.entries(json.hooks)) {
    for (const group of groupList) {
      for (const entry of group.hooks ?? []) {
        const cmd = entry.command
        const expanded = cmd.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, REPO_ROOT)
        const tokens = expanded.split(/\s+/)
        if (!tokens[0].endsWith('/bin/gw-hook') || tokens[1] !== 'hook' || !tokens[2]) {
          continue
        }
        const hookName = tokens[2]
        // De-duplicate: same hook name may appear in multiple matchers
        if (seenNames.has(hookName)) continue
        seenNames.add(hookName)

        results.push({
          hookName,
          eventType,
          binary: tokens[0],
          args: tokens.slice(1),
        })
      }
    }
  }
  return results
}

const GW_HOOK_REGISTRATIONS = parseGwHookRegistrations()

interface BarePathRegistration {
  eventType: string
  binary: string
  args: string[]
}

function parseBarePathRegistrations(): BarePathRegistration[] {
  const json = JSON.parse(readFileSync(HOOKS_JSON_PATH, 'utf8')) as {
    hooks: Record<string, Array<{ hooks?: Array<{ command: string }> }>>
  }
  const results: BarePathRegistration[] = []
  const seen = new Set<string>()

  for (const [eventType, groupList] of Object.entries(json.hooks)) {
    for (const group of groupList) {
      for (const entry of group.hooks ?? []) {
        const expanded = entry.command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, REPO_ROOT)
        const tokens = expanded.split(/\s+/)
        // Skip gw-hook registrations — already covered by GW_HOOK_REGISTRATIONS
        if (tokens[0].endsWith('/bin/gw-hook')) continue
        const key = expanded
        if (seen.has(key)) continue
        seen.add(key)
        results.push({ eventType, binary: tokens[0], args: tokens.slice(1) })
      }
    }
  }
  return results
}

const BARE_PATH_REGISTRATIONS = parseBarePathRegistrations()

function minimalPayload(eventType: string, hookName: string): string {
  switch (eventType) {
    case 'Stop':
      return JSON.stringify({
        session_id: 'invocation-path-test',
        hook_event_name: 'Stop',
      })
    case 'PostToolUse':
      return JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'echo hi' },
        tool_response: { stdout: 'hi', exit_code: 0 },
        session_id: 'invocation-path-test',
        hook_event_name: 'PostToolUse',
      })
    default:
      return JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: '/dev/null' },
        session_id: 'invocation-path-test',
        hook_event_name: eventType,
        _test_hook: hookName,
      })
  }
}

describe('gw-hook registrations — sanity', () => {
  it('hooks.json contains at least 8 gw-hook registrations', () => {
    // If this drops, a rewire removed entries without updating coverage
    expect(GW_HOOK_REGISTRATIONS.length).toBeGreaterThanOrEqual(8)
  })
})

describe('gw-hook shim exec bit — per registration', () => {
  for (const reg of GW_HOOK_REGISTRATIONS) {
    it(`bin/gw-hook exec bit set [${reg.hookName}]`, () => {
      const mode = statSync(GW_HOOK_SHIM).mode
      expect(
        mode & 0o111,
        `bin/gw-hook lacks exec bit — ${reg.hookName} would exit 126 in production`,
      ).toBeGreaterThan(0)
    })
  }
})

describe('gw-hook literal command spawn — exit ≠ 126, ≠ 127', () => {
  for (const reg of GW_HOOK_REGISTRATIONS) {
    it(`${reg.hookName} spawns via literal command string (exit ≠ 126, ≠ 127)`, () => {
      const tmpDir = mkdtempSync(join(os.tmpdir(), `gw-invpath-${reg.hookName}-`))
      try {
        const result = spawnSync(reg.binary, reg.args, {
          input: minimalPayload(reg.eventType, reg.hookName),
          encoding: 'utf8',
          env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: tmpDir,
            CLAUDE_SESSION_ID: 'invocation-path-test',
          },
          timeout: 10_000,
        })

        expect(
          result.error?.message ?? null,
          `${reg.hookName}: spawn error (ENOENT means bin/gw-hook not found)`,
        ).toBeNull()

        expect(
          result.status,
          `${reg.hookName}: exit 126 means bin/gw-hook is not executable (chmod -x)`,
        ).not.toBe(126)

        expect(
          result.status,
          `${reg.hookName}: exit 127 means the interpreter (bun/node) was not found`,
        ).not.toBe(127)
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  }
})

describe('bare-path SessionStart registrations — exit 0 and real hook output', () => {
  const sessionStartRegs = BARE_PATH_REGISTRATIONS.filter(
    (r) => r.eventType === 'SessionStart',
  )

  it('hooks.json contains at least one bare-path SessionStart registration', () => {
    expect(sessionStartRegs.length).toBeGreaterThanOrEqual(1)
  })

  for (const reg of sessionStartRegs) {
    const label = reg.binary.split('/').pop() ?? reg.binary
    it(`${label} exits 0 and emits additionalContext on a clean SessionStart`, () => {
      const tmpDir = mkdtempSync(join(os.tmpdir(), `gw-invpath-bare-`))
      try {
        const result = spawnSync(reg.binary, reg.args, {
          input: JSON.stringify({
            session_id: 'invocation-path-test',
            hook_event_name: 'SessionStart',
            transcript_path: '/dev/null',
          }),
          encoding: 'utf8',
          env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: tmpDir,
            CLAUDE_SESSION_ID: 'invocation-path-test',
          },
          timeout: 10_000,
        })

        expect(
          result.error?.message ?? null,
          `${label}: spawn error — binary not found or not executable`,
        ).toBeNull()

        expect(
          result.status,
          `${label}: expected exit 0 (SessionStart init hook must not crash); got ${result.status}.\nstderr: ${result.stderr}`,
        ).toBe(0)

        expect(
          result.stdout,
          `${label}: stdout must contain "additionalContext" — the real session-reminder emits this; a no-op shim cannot`,
        ).toContain('"additionalContext"')
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  }
})
