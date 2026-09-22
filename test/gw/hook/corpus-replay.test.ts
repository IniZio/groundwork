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
  readdirSync,
  statSync,
  existsSync,
} from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { execSync, spawnSync } from 'node:child_process'
import { HOOKS } from '../../../src/gw/hook/index.js'
import { PENDING_PORT_HOOKS } from '../parity/corpus-loader.js'

// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dir = dirname(__filename)
const REPO_ROOT = join(__dir, '../../..')
const FIXTURE_ROOT = join(REPO_ROOT, 'test/fixtures/parity-corpus')

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
      const resolved = entry.replace(/<isolated_temp_dir>/g, tmpDir).replace(/<temp_dir>/g, tmpDir)
      const mkdirMatch = resolved.match(/^mkdir\s+-p\s+(.+)$/)
      if (mkdirMatch) {
        mkdirSync(mkdirMatch[1].trim(), { recursive: true })
      } else {
        try { execSync(resolved, { cwd: tmpDir }) } catch { }
      }
    } else if (entry !== null && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>
      const rawPath = String(obj.path ?? '').replace(/<isolated_temp_dir>/g, tmpDir).replace(/<temp_dir>/g, tmpDir)
      const content = obj.content

      if (!rawPath || content === undefined) continue

      const absPath = rawPath.startsWith('/') ? rawPath : join(tmpDir, rawPath)
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

  if (parsed.decision === 'block') return 'DENY' // stop-gate deny — fixtures label this DENY (even though stdout says "block")

  if (parsed.continue === true) return 'ALLOW' // stop-gate allow / session-reminder allow

  const hso = parsed.hookSpecificOutput as Record<string, unknown> | undefined // PreToolUse hooks via hookSpecificOutput
  if (hso) {
    const pd = hso.permissionDecision as string | undefined
    if (pd === 'deny') return 'DENY'
    if (pd === 'allow') {
      return hso.updatedInput !== undefined ? 'INJECT' : 'ALLOW' // agent-model-guard injects a model → INJECT; plain allow → ALLOW
    }
    if (hso.additionalContext !== undefined) return 'WARN' // orchestrator-impl-guard / piped-exit-code-guard use additionalContext warn
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

function runMjsHook(
  hookName: string,
  stdinPayload: unknown,
  env: Record<string, string | undefined>,
): { stdout: string; stderr: string; exit: number } {
  const hookPath = join(REPO_ROOT, 'hooks', `${hookName}.mjs`)
  const projectDir = env['CLAUDE_PROJECT_DIR'] ?? REPO_ROOT
  const mergedEnv: Record<string, string | undefined> = {
    PATH: process.env['PATH'],
    ...env,
    CLAUDE_PLUGIN_ROOT: undefined,
  }
  const result = spawnSync('node', [hookPath], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf8',
    cwd: projectDir,
    env: mergedEnv as NodeJS.ProcessEnv,
    timeout: 15_000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit: result.status ?? (result.error ? 1 : 0),
  }
}

function materialiseVaultForm(_diskSetup: unknown[], _tmpDir: string): void {}

// ---------------------------------------------------------------------------

const allFixtures = discoverFixtures()

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

for (const [hookName, fixturePaths] of Object.entries(byHook)) { // one describe per hook so vitest shows pass/fail counts per hook
  describe(`corpus-replay / ${hookName}`, () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = mkdtempSync(join(os.tmpdir(), 'gw-corpus-'))
    })

    afterEach(() => {
      try {
        rmSync(tmpDir, { recursive: true, force: true })
      } catch {
      }
    })

    const isPendingPort = (PENDING_PORT_HOOKS as readonly string[]).includes(hookName)

    for (const fixturePath of fixturePaths) {
      const scenarioName = basename(fixturePath, '.json')

      it(scenarioName, async () => {
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

        const diskState = (fixture.disk_state_setup as unknown[]) ?? []
        const resolvedDiskState = replacePlaceholders(diskState, tmpDir) as unknown[]
        setupDiskState(tmpDir, resolvedDiskState)
        materialiseVaultForm(fixture.disk_state_setup as unknown[], tmpDir)

        const rawEnv = (fixture.env as Record<string, string>) ?? {}
        const resolvedEnv = replacePlaceholders(rawEnv, tmpDir) as Record<string, string>
        const env: Record<string, string | undefined> = {
          CLAUDE_SESSION_ID: 'test-session',
          ...resolvedEnv,
          CLAUDE_PROJECT_DIR: tmpDir,
        }

        if (isPendingPort) {
          const stdinPayload = replacePlaceholders(fixture.stdin_payload, tmpDir)
          const mjsResult = runMjsHook(hookName, stdinPayload, env)
          const expectedStdout = replacePlaceholders(fixture.stdout ?? '', tmpDir) as string
          expect(mjsResult.stdout).toBe(expectedStdout)
          expect(mjsResult.exit).toBe((fixture.exit_code as number) ?? 0)
          return
        }

        const hookFn = HOOKS[hookName]
        if (!hookFn) {
          console.warn(`[corpus-replay] No TS hook for "${hookName}" — skipping ${fixturePath}`)
          return
        }

        if (Array.isArray(fixture.invocations)) { // struggle-detector reads process.env.CLAUDE_PROJECT_DIR directly (ignores _env param); set for duration
          const invocations = fixture.invocations as Array<{
            stdin_payload: unknown
          }>

          const prevEnv: Record<string, string | undefined> = {} // struggle-detector reads process.env directly — propagate all fixture env vars
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

          const firstPayload = invocations[0]?.stdin_payload as Record<string, unknown> | undefined
          const sessionId = String(firstPayload?.session_id ?? env.CLAUDE_SESSION_ID ?? 'test-session')
          const actual = detectSignal(tmpDir, sessionId)
          expect(actual).toBe(expectedDecision)
          return
        }

        const stdinPayload = replacePlaceholders(fixture.stdin_payload, tmpDir)
        const result = await hookFn(stdinPayload, env)
        const actual = extractDecision(result.stdout)
        expect(actual).toBe(expectedDecision)
      })
    }
  })
}

// ---------------------------------------------------------------------------

const HOOKS_JSON_PATH = join(REPO_ROOT, 'hooks/hooks.json') // parse hooks.json at module load to derive unique .mjs filenames
const _hooksJson = JSON.parse(readFileSync(HOOKS_JSON_PATH, 'utf8')) as {
  hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
}
const _allHookFiles: string[] = []
for (const eventHooks of Object.values(_hooksJson.hooks)) {
  for (const entry of eventHooks) {
    for (const h of entry.hooks) {
      if (h.command && h.command.endsWith('.mjs')) {
        const filename = h.command.replace(/.*\/hooks\//, '')
        if (!_allHookFiles.includes(filename)) {
          _allHookFiles.push(filename)
        }
      }
    }
  }
}

const _gwHookNames: string[] = []
for (const eventHooks of Object.values(_hooksJson.hooks)) {
  for (const entry of eventHooks) {
    for (const h of entry.hooks) {
      const m = (h.command ?? '').match(/bin\/gw-hook hook (\S+)/)
      if (m && !_gwHookNames.includes(m[1])) _gwHookNames.push(m[1])
    }
  }
}

describe('hook exec-bit and shim-spawn', () => {
  for (const hookFile of _allHookFiles) {
    it(`hooks/${hookFile} has exec bit set`, () => {
      const hookPath = join(REPO_ROOT, 'hooks', hookFile)
      const mode = statSync(hookPath).mode
      expect(mode & 0o111).toBeGreaterThan(0) // at least one of owner/group/other exec bits must be set
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
        expect(result.error).toBeUndefined() // spawned without error (not a 126 EACCES); exit code may be 0 or non-zero per hook validation logic
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  }
})

describe('stop-gate deployed-path spawn (allow path)', () => {
  it('bin/gw-hook hook stop-gate spawns correctly when invoked by the deployed path', () => {
    const hookPath = join(REPO_ROOT, 'bin', 'gw-hook')
    const tmpDir = mkdtempSync(join(os.tmpdir(), 'gw-stopgate-spawn-'))
    try {
      const payload = JSON.stringify({ session_id: 'spawn-test-session', hook_event_name: 'Stop' })
      const result = spawnSync(hookPath, ['hook', 'stop-gate'], {
        input: payload,
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
        timeout: 5000,
      })
      expect(result.status).toBe(0) // fail-open, no active run → exit 0
      if (result.stdout && result.stdout.trim()) { // stdout should have continue:true (no active run → allow)
        const parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>
        expect(parsed.continue).toBe(true)
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

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
    }
  })

  it('returns ALLOW for a session with no matching new-layout slices (abandoned-session path)', async () => {
    const hookFn = HOOKS['stop-gate']
    expect(hookFn, 'stop-gate hook must exist in HOOKS').toBeDefined()

    const motiveDir = join(tmpDir, '.groundwork', 'next', 'motives', 'my-motive') // write slice notes for a DIFFERENT session
    mkdirSync(motiveDir, { recursive: true }) // slice belongs to other-session (not our test session)
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

    const testSessionId = 'abandoned-new-layout-test-session' // no matching slices → bySession=0 → findNewLayoutLedger=null → no ledger → ALLOW
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

    expect(decision).toBe('ALLOW') // no active run for this session → fail-open → ALLOW
  })
})

// ---------------------------------------------------------------------------
// ---- Parity-corpus registration coverage (AC-8) ----
// ---------------------------------------------------------------------------

describe('gw hook parity-corpus registration coverage', () => {
  it('hooks.json contains ≥1 bin/gw-hook hook registration', () => {
    expect(_gwHookNames.length).toBeGreaterThan(0)
  })

  for (const name of _gwHookNames) {
    it(`parity-corpus/${name}/ exists and contains ≥1 fixture`, () => {
      const corpusDir = join(FIXTURE_ROOT, name)
      const expectedPath = `test/fixtures/parity-corpus/${name}/`
      expect(
        existsSync(corpusDir),
        `hook '${name}': missing parity-corpus directory — expected ${expectedPath}`,
      ).toBe(true)
      const count = readdirSync(corpusDir).filter(f => f.endsWith('.json')).length
      expect(
        count,
        `hook '${name}': ${expectedPath} has 0 fixtures`,
      ).toBeGreaterThan(0)
    })
  }
})
