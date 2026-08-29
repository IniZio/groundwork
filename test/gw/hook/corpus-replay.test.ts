/**
 * test/gw/hook/corpus-replay.test.ts
 *
 * Corpus-replay parity suite: discovers every .json fixture under
 * test/fixtures/parity-corpus/**\/*.json, imports the corresponding TypeScript
 * hook from src/gw/hook/index.ts (HOOKS map), runs it against the fixture's
 * disk_state_setup + stdin_payload, and asserts the extracted decision matches
 * fixture.decision.
 *
 * Multi-invocation fixtures (struggle-detector) run all invocations
 * sequentially against a shared temp dir then derive SIGNAL / NO-SIGNAL from
 * the detector tally file.
 *
 * A separate describe block tests exec-bit + shim-spawn for stop-gate.mjs.
 *
 * A synthetic new-layout describe block writes next/motives/<motive>/<slice>.md
 * files and verifies stop-gate returns ALLOW for a session with no matching
 * new-layout data (abandoned-session path).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
  existsSync,
} from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { execSync, spawnSync } from 'node:child_process'
import { HOOKS } from '../../../src/gw/hook/index.js'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dir = dirname(__filename)
const REPO_ROOT = join(__dir, '../../..')
const FIXTURE_ROOT = join(REPO_ROOT, 'test/fixtures/parity-corpus')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replace <isolated_temp_dir> and <temp_dir> placeholders with the real tmp path. */
function replacePlaceholders(value: unknown, tmpDir: string): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/<isolated_temp_dir>/g, tmpDir)
      .replace(/<temp_dir>/g, tmpDir)
  }
  if (Array.isArray(value)) return value.map(v => replacePlaceholders(v, tmpDir))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        replacePlaceholders(v, tmpDir),
      ]),
    )
  }
  return value
}

/** Write disk_state_setup entries to tmpDir. */
function setupDiskState(tmpDir: string, diskState: unknown[]): void {
  for (const entry of diskState) {
    if (typeof entry === 'string') {
      // mkdir command: "mkdir -p <temp_dir>/.groundwork/runs"
      const resolved = entry.replace(/<isolated_temp_dir>/g, tmpDir).replace(/<temp_dir>/g, tmpDir)
      // Only handle mkdir -p pattern for safety
      const match = resolved.match(/^mkdir\s+-p\s+(.+)$/)
      if (match) {
        mkdirSync(match[1].trim(), { recursive: true })
      }
    } else if (entry !== null && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>
      const relPath = String(obj.path ?? '')
      const content = obj.content

      if (!relPath || content === undefined) continue

      const absPath = join(tmpDir, relPath)
      mkdirSync(dirname(absPath), { recursive: true })

      if (content !== null && typeof content === 'object') {
        writeFileSync(absPath, JSON.stringify(content, null, 2), 'utf8')
      } else if (typeof content === 'string') {
        writeFileSync(absPath, content, 'utf8')
      }
    }
  }
}

/**
 * Extract decision label from a HookResult.stdout string.
 *
 * Decision mapping:
 *  - empty stdout                                       → PASS
 *  - {decision:"block"}                                 → BLOCK  (stop-gate deny)
 *  - {continue:true}                                    → ALLOW  (stop-gate allow, session-reminder)
 *  - {hookSpecificOutput:{permissionDecision:"deny"}}   → DENY
 *  - {hookSpecificOutput:{permissionDecision:"allow", updatedInput:{...}}} → INJECT
 *  - {hookSpecificOutput:{permissionDecision:"allow"}}  → ALLOW
 *  - {hookSpecificOutput:{additionalContext:"..."}}      → WARN   (orchestrator-impl-guard)
 */
function extractDecision(stdout: string): string {
  const trimmed = (stdout ?? '').trim()
  if (!trimmed) return 'PASS'

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return 'PASS'
  }

  // stop-gate deny — fixtures label this DENY (even though stdout says "block")
  if (parsed.decision === 'block') return 'DENY'

  // stop-gate allow / session-reminder allow
  if (parsed.continue === true) return 'ALLOW'

  // PreToolUse hooks via hookSpecificOutput
  const hso = parsed.hookSpecificOutput as Record<string, unknown> | undefined
  if (hso) {
    const pd = hso.permissionDecision as string | undefined
    if (pd === 'deny') return 'DENY'
    if (pd === 'allow') {
      // agent-model-guard injects a model → INJECT; plain allow → ALLOW
      return hso.updatedInput !== undefined ? 'INJECT' : 'ALLOW'
    }
    // orchestrator-impl-guard / piped-exit-code-guard use additionalContext warn
    if (hso.additionalContext !== undefined) return 'WARN'
  }

  return 'PASS'
}

/**
 * Discover SIGNAL / NO-SIGNAL for struggle-detector by reading the tally
 * file the hook writes to <projectDir>/.groundwork/runs/<sessionId>.detector.json.
 */
function detectSignal(tmpDir: string, sessionId: string): string {
  const tallyPath = join(tmpDir, '.groundwork', 'runs', `${sessionId}.detector.json`)
  if (!existsSync(tallyPath)) return 'NO-SIGNAL'
  try {
    const tally = JSON.parse(readFileSync(tallyPath, 'utf8')) as Record<string, unknown>
    const emitted = tally.emitted as Record<string, unknown> | undefined
    if (emitted && Object.keys(emitted).length > 0) return 'SIGNAL'
  } catch {
    // fall through
  }
  return 'NO-SIGNAL'
}

/** Collect all .json fixture paths under FIXTURE_ROOT. */
function discoverFixtures(): string[] {
  const results: string[] = []

  function walk(dir: string): void {
    let entries: string[]
    try {
      entries = execSync(`find "${dir}" -name "*.json" ! -name "capture.mjs" -not -path "*/capture*"`, {
        encoding: 'utf8',
      })
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
    } catch {
      return
    }
    results.push(...entries)
  }

  walk(FIXTURE_ROOT)
  return results
}

// ---------------------------------------------------------------------------
// Build the test suite dynamically
// ---------------------------------------------------------------------------

const allFixtures = discoverFixtures()

// Group by hook name for reporting
const byHook: Record<string, string[]> = {}
for (const fp of allFixtures) {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(fp, 'utf8')) as Record<string, unknown>
  } catch {
    continue
  }
  const hookName = String(raw.hook ?? '').replace(/\.mjs$/, '')
  if (!byHook[hookName]) byHook[hookName] = []
  byHook[hookName].push(fp)
}

// Emit one describe block per hook so vitest shows pass/fail counts per hook
for (const [hookName, fixturePaths] of Object.entries(byHook)) {
  describe(`corpus-replay / ${hookName}`, () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = mkdtempSync(join(os.tmpdir(), 'gw-corpus-'))
    })

    afterEach(() => {
      try {
        rmSync(tmpDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    })

    for (const fixturePath of fixturePaths) {
      const scenarioName = basename(fixturePath, '.json')

      it(scenarioName, async () => {
        // Parse fixture (skip unparseable)
        let fixture: Record<string, unknown>
        try {
          fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>
        } catch (err) {
          console.warn(`[corpus-replay] Skipping unparseable fixture: ${fixturePath}`)
          return
        }

        const expectedDecision = fixture.decision as string
        if (!expectedDecision) {
          console.warn(`[corpus-replay] No decision field in fixture: ${fixturePath}`)
          return
        }

        // Resolve hook function
        const hookFn = HOOKS[hookName]
        if (!hookFn) {
          console.warn(`[corpus-replay] No TS hook for "${hookName}" — skipping ${fixturePath}`)
          return
        }

        // Prepare disk state
        const diskState = (fixture.disk_state_setup as unknown[]) ?? []
        const resolvedDiskState = replacePlaceholders(diskState, tmpDir) as unknown[]
        setupDiskState(tmpDir, resolvedDiskState)

        // Prepare env
        const rawEnv = (fixture.env as Record<string, string>) ?? {}
        const resolvedEnv = replacePlaceholders(rawEnv, tmpDir) as Record<string, string>
        const env: Record<string, string | undefined> = {
          CLAUDE_PROJECT_DIR: tmpDir,
          CLAUDE_SESSION_ID: 'test-session',
          ...resolvedEnv,
        }

        // Multi-invocation (struggle-detector)
        // NOTE: struggle-detector.ts reads process.env.CLAUDE_PROJECT_DIR directly
        // (ignores the _env parameter). Set it for the duration of the invocations.
        if (Array.isArray(fixture.invocations)) {
          const invocations = fixture.invocations as Array<{
            stdin_payload: unknown
          }>

          // struggle-detector reads process.env directly — propagate all fixture env vars
          const prevEnv: Record<string, string | undefined> = {}
          const envOverrides = { CLAUDE_PROJECT_DIR: tmpDir, ...resolvedEnv }
          for (const [k, v] of Object.entries(envOverrides)) {
            prevEnv[k] = process.env[k]
            process.env[k] = v
          }
          try {
            for (const inv of invocations) {
              const payload = replacePlaceholders(inv.stdin_payload, tmpDir)
              await hookFn(payload, env)
            }
          } finally {
            for (const [k, prev] of Object.entries(prevEnv)) {
              if (prev === undefined) {
                delete process.env[k]
              } else {
                process.env[k] = prev
              }
            }
          }

          // Derive session_id for tally lookup from first invocation's stdin_payload
          const firstPayload = invocations[0]?.stdin_payload as Record<string, unknown> | undefined
          const sessionId = String(firstPayload?.session_id ?? env.CLAUDE_SESSION_ID ?? 'test-session')
          const actual = detectSignal(tmpDir, sessionId)
          expect(actual).toBe(expectedDecision)
          return
        }

        // Single invocation
        const stdinPayload = replacePlaceholders(fixture.stdin_payload, tmpDir)
        const result = await hookFn(stdinPayload, env)
        const actual = extractDecision(result.stdout)
        expect(actual).toBe(expectedDecision)
      })
    }
  })
}

// ---------------------------------------------------------------------------
// Exec-bit + shim-spawn tests (parametric over all hooks in hooks/hooks.json)
// ---------------------------------------------------------------------------

// Parse hooks.json at module load time to derive the unique set of .mjs filenames.
const HOOKS_JSON_PATH = join(REPO_ROOT, 'hooks/hooks.json')
const _hooksJson = JSON.parse(readFileSync(HOOKS_JSON_PATH, 'utf8')) as {
  hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
}
const _allHookFiles: string[] = []
for (const eventHooks of Object.values(_hooksJson.hooks)) {
  for (const entry of eventHooks) {
    for (const h of entry.hooks) {
      if (h.command && h.command.endsWith('.mjs')) {
        // Strip the variable prefix to get the bare filename
        const filename = h.command.replace(/.*\/hooks\//, '')
        if (!_allHookFiles.includes(filename)) {
          _allHookFiles.push(filename)
        }
      }
    }
  }
}

describe('hook exec-bit and shim-spawn', () => {
  for (const hookFile of _allHookFiles) {
    it(`hooks/${hookFile} has exec bit set`, () => {
      const hookPath = join(REPO_ROOT, 'hooks', hookFile)
      const mode = statSync(hookPath).mode
      // at least one of owner/group/other exec bits must be set
      expect(mode & 0o111).toBeGreaterThan(0)
    })

    it(`hooks/${hookFile} spawns correctly when invoked by bare path`, () => {
      const hookPath = join(REPO_ROOT, 'hooks', hookFile)
      const tmpDir = mkdtempSync(join(os.tmpdir(), 'gw-spawn-'))
      try {
        const result = spawnSync(hookPath, [], {
          input: '{}',
          encoding: 'utf8',
          env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
          timeout: 5000,
        })
        // Success criterion: the process executed — no spawn error (e.g. not a 126 EACCES).
        // Exit code may be 0 or non-zero depending on the hook's validation logic.
        expect(result.error).toBeUndefined()
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  }
})

// stop-gate-specific test: verify the allow path returns continue:true
describe('stop-gate.mjs shim-spawn (allow path)', () => {
  it('hooks/stop-gate.mjs spawns correctly when invoked by path (not node <path>)', () => {
    const hookPath = join(REPO_ROOT, 'hooks/stop-gate.mjs')
    const tmpDir = mkdtempSync(join(os.tmpdir(), 'gw-stopgate-spawn-'))
    try {
      const payload = JSON.stringify({ session_id: 'spawn-test-session', hook_event_name: 'Stop' })
      const result = spawnSync(hookPath, [], {
        input: payload,
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
        timeout: 5000,
      })
      // Should exit 0 (fail-open, no active run)
      expect(result.status).toBe(0)
      // stdout should have continue:true (no active run → allow)
      if (result.stdout && result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>
        expect(parsed.continue).toBe(true)
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// New-layout scenario
// ---------------------------------------------------------------------------

describe('stop-gate / new-layout (next/motives/<motive>/<slice>.md)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'gw-newlayout-'))
  })

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('returns ALLOW for a session with no matching new-layout slices (abandoned-session path)', async () => {
    const hookFn = HOOKS['stop-gate']
    expect(hookFn, 'stop-gate hook must exist in HOOKS').toBeDefined()

    // Write new-layout slice notes for a DIFFERENT session
    const motiveDir = join(tmpDir, '.groundwork', 'next', 'motives', 'my-motive')
    mkdirSync(motiveDir, { recursive: true })

    // Slice belonging to other-session (not our test session)
    const sliceContent = `---
id: s1
session: other-session-id
status: complete
kind: impl
wave: 1
behavior: "some work"
blocked_by: []
covers_ac: []
decisions: []
---

Slice note body.
`
    writeFileSync(join(motiveDir, 's1.md'), sliceContent, 'utf8')

    // Our test session has no matching slices → bySession returns 0
    // → findNewLayoutLedger returns null → no legacy ledger → ALLOW
    const testSessionId = 'abandoned-new-layout-test-session'
    const env: Record<string, string | undefined> = {
      CLAUDE_PROJECT_DIR: tmpDir,
      CLAUDE_SESSION_ID: testSessionId,
    }
    const payload = {
      session_id: testSessionId,
      hook_event_name: 'Stop',
    }

    const result = await hookFn(payload, env)
    const decision = extractDecision(result.stdout)

    // No active run for this session → fail-open → ALLOW
    expect(decision).toBe('ALLOW')
  })
})
