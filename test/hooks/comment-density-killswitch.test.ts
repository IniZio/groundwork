/**
 * test/hooks/comment-density-killswitch.test.ts
 *
 * Kill-switch parity: GROUNDWORK_COMMENT_DENSITY=0 silences all three
 * comment-density feature layers; each layer is active when the var is unset.
 *
 * Layer 1 (injection): hook emits rule text in hookSpecificOutput.additionalContext
 *   for subagent payloads (agent_type present), even for a clean file.
 * Layer 2 (advisory): hook emits over-cap / restating finding in additionalContext
 *   for files that exceed 5/100 or carry restating comments.
 * Layer 3 (gate data): `gw comment-density report --json` lists flagged files
 *   and yields files:[] when the kill switch is set.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import os from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dir = dirname(__filename)
const REPO_ROOT = join(__dir, '../..')
const GW_HOOK_SHIM = join(REPO_ROOT, 'bin', 'gw-hook')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Positive-control env: GROUNDWORK_COMMENT_DENSITY removed so the feature is active.
 * Spreads process.env so the binary resolves, then deletes the kill-switch key.
 */
function hookEnvActive(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_SESSION_ID: 'test' }
  delete e['GROUNDWORK_COMMENT_DENSITY']
  return e
}

/** Kill-switch env: GROUNDWORK_COMMENT_DENSITY=0 so the feature is silenced. */
function hookEnvOff(): NodeJS.ProcessEnv {
  return { ...process.env, CLAUDE_CODE_SESSION_ID: 'test', GROUNDWORK_COMMENT_DENSITY: '0' }
}

/** Base env for CLI invocations (git-aware) with kill switch removed (feature active). */
const GIT_ENV_BASE: NodeJS.ProcessEnv = (() => {
  const e: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CODE_SESSION_ID: 'test-session',
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  }
  delete e['GROUNDWORK_COMMENT_DENSITY']
  return e
})()

/** Kill-switch env for CLI invocations. */
const GIT_ENV_OFF: NodeJS.ProcessEnv = {
  ...process.env,
  CLAUDE_CODE_SESSION_ID: 'test-session',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GROUNDWORK_COMMENT_DENSITY: '0',
}

function runHook(
  stdin: string,
  env: NodeJS.ProcessEnv,
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(GW_HOOK_SHIM, ['hook', 'comment-density-guard'], {
    input: stdin,
    encoding: 'utf-8',
    env,
    timeout: 10_000,
  })
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status }
}

function makeTmpDir(): string {
  return mkdtempSync(join(os.tmpdir(), 'cd-ks-'))
}

function gitInit(cwd: string): void {
  spawnSync('git', ['init'], { cwd, env: GIT_ENV_BASE })
  spawnSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd, env: GIT_ENV_BASE })
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// 10 lines, 4 comment lines → 40/100 > cap of 5/100 (over-cap)
const OVER_CAP_CONTENT = [
  'const a = 1',
  'const b = 2',
  'const c = 3',
  'const d = 4',
  'const e = 5',
  'const f = 6',
  '// comment one',
  '// comment two',
  '// comment three',
  '// comment four',
].join('\n')

// 10 lines, 1 comment → 10/100 > cap; comment restates the next line (counter++)
const RESTATING_CONTENT = [
  'let counter = 0',
  'const a = 1',
  'const b = 2',
  'const c = 3',
  'const d = 4',
  'const e = 5',
  'const f = 6',
  'const g = 7',
  '// increment counter',
  'counter++',
].join('\n')

// Clean: no comments at all
const CLEAN_CONTENT = ['const a = 1', 'const b = 2', 'const c = 3', 'const d = 4'].join('\n')

// ---------------------------------------------------------------------------
// Layer 1 — injection (rule text emitted for subagent payloads)
// ---------------------------------------------------------------------------

describe('Layer 1 — injection', () => {
  it('positive control: subagent payload (agent_type) → rule text in additionalContext', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/cd-ks-l1-clean.ts', content: CLEAN_CONTENT },
      agent_type: 'general-purpose',
    })
    const { stdout, status } = runHook(payload, hookEnvActive())
    expect(status).toBe(0)
    expect(stdout.trim()).not.toBe('')

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>
    const hso = parsed['hookSpecificOutput'] as Record<string, unknown>
    const ctx = hso['additionalContext'] as string
    // Rule injection must name the cap
    expect(ctx).toContain('≤5')
  })

  it('kill switch: GROUNDWORK_COMMENT_DENSITY=0 → empty stdout, exit 0', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/cd-ks-l1-ks.ts', content: CLEAN_CONTENT },
      agent_type: 'general-purpose',
    })
    const { stdout, status } = runHook(payload, hookEnvOff())
    expect(status).toBe(0)
    expect(stdout.trim()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Layer 2 — advisory (over-cap and restating findings)
// ---------------------------------------------------------------------------

describe('Layer 2 — advisory', () => {
  it('positive control (over-cap): Write exceeds 5/100 → over-cap in additionalContext', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/cd-ks-l2-overcap.ts', content: OVER_CAP_CONTENT },
    })
    const { stdout, status } = runHook(payload, hookEnvActive())
    expect(status).toBe(0)
    expect(stdout.trim()).not.toBe('')

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>
    const hso = parsed['hookSpecificOutput'] as Record<string, unknown>
    const ctx = hso['additionalContext'] as string
    expect(ctx).toContain('over-cap')
    expect(ctx).toContain('cd-ks-l2-overcap.ts')
    expect(ctx).toContain('5')
  })

  it('positive control (restating): Write with restating comment → restating in additionalContext', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/cd-ks-l2-restat.ts', content: RESTATING_CONTENT },
    })
    const { stdout, status } = runHook(payload, hookEnvActive())
    expect(status).toBe(0)
    expect(stdout.trim()).not.toBe('')

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>
    const hso = parsed['hookSpecificOutput'] as Record<string, unknown>
    const ctx = hso['additionalContext'] as string
    // At least one of over-cap or restating must fire (restating + density > cap both apply here)
    expect(ctx.includes('over-cap') || ctx.includes('restat')).toBe(true)
  })

  it('kill switch (over-cap): GROUNDWORK_COMMENT_DENSITY=0 → empty stdout, exit 0', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/cd-ks-l2-ks.ts', content: OVER_CAP_CONTENT },
    })
    const { stdout, status } = runHook(payload, hookEnvOff())
    expect(status).toBe(0)
    expect(stdout.trim()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Layer 3 — gate data (`gw comment-density report --json`)
// ---------------------------------------------------------------------------

describe('Layer 3 — gate data', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('positive control: over-cap file in git repo → non-empty files array with over-cap reason', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    writeFileSync(join(tmpDir, 'over-cap.ts'), OVER_CAP_CONTENT)

    const result = spawnSync(GW_HOOK_SHIM, ['comment-density', 'report', '--json'], {
      cwd: tmpDir,
      env: GIT_ENV_BASE,
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(126)
    expect(result.status).not.toBe(127)
    expect(result.status).toBe(0)

    const envelope = JSON.parse(result.stdout) as { ok: boolean; data: { files: unknown[] } }
    expect(envelope.ok).toBe(true)

    const { files } = envelope.data
    expect(Array.isArray(files)).toBe(true)
    expect(files.length).toBeGreaterThanOrEqual(1)

    // Must name the fixture file and the over-cap kind
    const raw = JSON.stringify(files)
    expect(raw).toContain('over-cap.ts')
    expect(raw).toContain('over-cap')
    // Cap value must appear (5)
    const manifest = envelope.data as { cap?: { file?: number } }
    expect(manifest.cap?.file).toBe(5)
  })

  it('kill switch: GROUNDWORK_COMMENT_DENSITY=0 → files:[], exit 0', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    writeFileSync(join(tmpDir, 'over-cap.ts'), OVER_CAP_CONTENT)

    const result = spawnSync(GW_HOOK_SHIM, ['comment-density', 'report', '--json'], {
      cwd: tmpDir,
      env: GIT_ENV_OFF,
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(126)
    expect(result.status).not.toBe(127)
    expect(result.status).toBe(0)

    const envelope = JSON.parse(result.stdout) as { ok: boolean; data: { files: unknown[] } }
    expect(envelope.ok).toBe(true)
    expect(envelope.data.files.length).toBe(0)
  })
})
