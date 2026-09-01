/**
 * test/hooks/hook-invocation-path.test.ts
 *
 * Invocation-path coverage for hook registrations in hooks/hooks.json.
 *
 * Background: slice T5 rewired 8 hook registrations from bare `.mjs` paths to
 * `${CLAUDE_PLUGIN_ROOT}/bin/gw-hook hook <name>`. The corpus-replay parametric
 * loop only iterates commands ending in `.mjs`, so the 8 gw-hook entries
 * silently fell out of the loop — losing 16 tests (2 per hook: exec-bit +
 * spawn). This file restores that coverage.
 *
 * Design:
 *   - Derived directly from hooks.json so coverage auto-follows future rewires.
 *     If a registration is added or command form changes, the parametric loop
 *     picks it up without manual updates.
 *   - Two assertions per gw-hook registration:
 *       1. bin/gw-hook exec bit set (exit 126 if missing)
 *       2. full literal command spawns without ENOENT / EACCES (exit ≠ 126, ≠ 127)
 *   - One additional describe block for bare-path SessionStart registrations:
 *       3. session-start exits 0 (init hook — non-zero is a crash, not a decision)
 *          Regression guard for T31: session-start exited 1 when dist/gw was
 *          present; the fix delegates to bin/gw-hook directly. Any future
 *          invocation-path regression that causes session-start to exit non-zero
 *          is caught here.
 *   - CLAUDE_PROJECT_DIR is always set to a fresh isolated tmpDir per test;
 *     ambient CLAUDE_PROJECT_DIR from the test runner never reaches the hook.
 *
 * NOT covered here (already handled elsewhere):
 *   - `.mjs` hook exec-bit + shim-spawn: corpus-replay.test.ts parametric loop
 *   - All bare-path exec bits: hooks-registration.test.ts sweep
 *   - Hook decision logic (BLOCK/ALLOW/CONTINUE): corpus-replay.test.ts fixtures
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dir = dirname(__filename)
// test/hooks/ → test/ → repo root
const REPO_ROOT = join(__dir, '../..')
const HOOKS_JSON_PATH = join(REPO_ROOT, 'hooks', 'hooks.json')
const GW_HOOK_SHIM = join(REPO_ROOT, 'bin', 'gw-hook')

// ---------------------------------------------------------------------------
// Parse hooks.json → derive all gw-hook registrations and bare-path registrations
// ---------------------------------------------------------------------------

interface GwHookRegistration {
  /** Hook name (3rd token after "gw-hook hook") */
  hookName: string
  /** Event type: PreToolUse | PostToolUse | Stop | etc. */
  eventType: string
  /** Expanded binary path (CLAUDE_PLUGIN_ROOT resolved to REPO_ROOT) */
  binary: string
  /** Expanded args: ["hook", "<name>"] */
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
        // Match: ${CLAUDE_PLUGIN_ROOT}/bin/gw-hook hook <name>
        const expanded = cmd.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, REPO_ROOT)
        const tokens = expanded.split(/\s+/)
        // Must be: <binary> hook <name>
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

// ---------------------------------------------------------------------------
// Parse hooks.json → derive bare-path registrations (not routed via bin/gw-hook)
// ---------------------------------------------------------------------------

interface BarePathRegistration {
  /** Event type: SessionStart | UserPromptSubmit | PreToolUse | etc. */
  eventType: string
  /** Expanded binary (first token of the command, CLAUDE_PLUGIN_ROOT resolved) */
  binary: string
  /** Remaining tokens after the binary */
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

// ---------------------------------------------------------------------------
// Minimal safe payload per event type
//
// All guards are fail-open: an empty or minimal payload yields a permissive
// decision rather than a crash. We only care that the process executes at all,
// not that it makes any particular decision.
// ---------------------------------------------------------------------------

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
      // PreToolUse, SessionStart, UserPromptSubmit, unknown
      return JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: '/dev/null' },
        session_id: 'invocation-path-test',
        hook_event_name: eventType,
        // Annotate so hook diagnostics reference the test context
        _test_hook: hookName,
      })
  }
}

// ---------------------------------------------------------------------------
// Sanity
// ---------------------------------------------------------------------------

describe('gw-hook registrations — sanity', () => {
  it('hooks.json contains at least 8 gw-hook registrations', () => {
    // If this drops, a rewire removed entries without updating coverage
    expect(GW_HOOK_REGISTRATIONS.length).toBeGreaterThanOrEqual(8)
  })
})

// ---------------------------------------------------------------------------
// Describe block 1: exec bit — one test per gw-hook registration
//
// Each registration depends on bin/gw-hook being executable. A missing exec
// bit causes all 8 hooks to silently exit 126. One test per registration name
// (not one shared test) makes the parametric structure visible in test output
// and ensures 8 distinct test IDs exist — matching the 8 entries that were
// originally covered by the .mjs parametric loop.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Describe block 2: literal command spawn — one test per gw-hook registration
//
// Spawns the EXACT command string from hooks.json (with ${CLAUDE_PLUGIN_ROOT}
// expanded). Asserts exit ≠ 126 (EACCES, shim not executable) and ≠ 127
// (shim or interpreter not found). The hook may exit 0 or non-zero for
// decision/validation reasons — that is not this test's concern.
//
// CLAUDE_PROJECT_DIR isolation: each test creates a fresh tmpDir and passes it
// explicitly, overriding any ambient CLAUDE_PROJECT_DIR in the test runner env.
// ---------------------------------------------------------------------------

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
            // Explicitly override ambient CLAUDE_PROJECT_DIR — prevents vacuous
            // assertions that pass only because the real project tree is present.
            CLAUDE_PROJECT_DIR: tmpDir,
            CLAUDE_SESSION_ID: 'invocation-path-test',
          },
          timeout: 10_000,
        })

        // ENOENT: binary not found — spawn itself failed
        expect(
          result.error?.message ?? null,
          `${reg.hookName}: spawn error (ENOENT means bin/gw-hook not found)`,
        ).toBeNull()

        // Exit 126: EACCES — the shim file is not executable
        expect(
          result.status,
          `${reg.hookName}: exit 126 means bin/gw-hook is not executable (chmod -x)`,
        ).not.toBe(126)

        // Exit 127: interpreter not found (bun/node missing) or shim not in PATH
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

// ---------------------------------------------------------------------------
// Describe block 3: bare-path SessionStart registrations — must exit 0
//
// SessionStart hooks are initialisation hooks, not decision hooks. They MUST
// exit 0 on a normal session invocation. A non-zero exit is a crash, not a
// block decision.
//
// Regression guard for T31: hooks/session-start exited 1 when dist/gw was
// present (stale compiled artefact changed the invocation path). The fix
// rewrote session-start to exec bin/gw-hook directly, bypassing dist/gw.
// This assert would have caught that regression — and catches any future
// code path that causes a bare-path SessionStart hook to exit non-zero.
//
// The ≠126/≠127 guards in describe block 2 only cover gw-hook registrations
// and do not reach bare-path hooks; this block fills that gap.
// ---------------------------------------------------------------------------

describe('bare-path SessionStart registrations — exit 0', () => {
  const sessionStartRegs = BARE_PATH_REGISTRATIONS.filter(
    (r) => r.eventType === 'SessionStart',
  )

  it('hooks.json contains at least one bare-path SessionStart registration', () => {
    expect(sessionStartRegs.length).toBeGreaterThanOrEqual(1)
  })

  for (const reg of sessionStartRegs) {
    const label = reg.binary.split('/').pop() ?? reg.binary
    it(`${label} exits 0 on a clean SessionStart (bare-path registration)`, () => {
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

        // Spawn itself must succeed (no ENOENT / EACCES)
        expect(
          result.error?.message ?? null,
          `${label}: spawn error — binary not found or not executable`,
        ).toBeNull()

        // SessionStart hooks are init hooks, not decision hooks — exit 0 is mandatory.
        // A non-zero exit means an invocation-path crash (e.g. wrong runtime, stale
        // dist/gw being consulted). The exit-1 regression class (T31) is caught here.
        expect(
          result.status,
          `${label}: expected exit 0 (SessionStart init hook must not crash); got ${result.status}.\nstderr: ${result.stderr}`,
        ).toBe(0)
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  }
})
