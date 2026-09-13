/**
 * T36 — MAP.md and TRACE.html both refresh on checkpoint and hold via bin/gw-hook.
 *
 * T35 (map-refresh-both-surfaces.test.ts) sets GW_MAIN = src/gw/cli/main.ts and spawns
 * `bun run <GW_MAIN>` — the SOURCE entry point. bin/gw-hook line ~69 prefers dist/gw.mjs
 * when bun resolves, so a stale bundle can miss regenerateMotiveTraceHtml calls while the
 * source-entry test stays green. This test spawns bin/gw-hook by its bare path so the
 * dist/gw.mjs preference is exercised and TRACE.html regressions become visible.
 *
 * Bite proof: set GW_BUNDLE=/tmp/gw-bitten.mjs (a /tmp copy of dist/gw.mjs with the
 * regenerateMotiveTraceHtml calls replaced by no-ops) and re-run the suite — the
 * TRACE.html assertions fail. The bite was confirmed at authoring time; see comments
 * at the bottom of this file.
 *
 * @verifies AC-T36 (phase-checkpoint-gate)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, rmSync, unlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const GW_HOOK = join(ROOT, 'bin', 'gw-hook')
const LEDGER_MJS = join(ROOT, 'hooks', 'ledger.mjs')
const MOTIVE = 'checkpoint-hold-deployed'

const bunPresent: boolean = spawnSync('bun', ['--version'], { encoding: 'utf8' }).status === 0

function makeEnv(projectDir: string, sessionId: string, extra?: Record<string, string>): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    CLAUDE_PROJECT_DIR: projectDir,
    CLAUDE_CODE_SESSION_ID: sessionId,
    ...(process.env['GW_BUNDLE'] ? { GW_BUNDLE: process.env['GW_BUNDLE'] } : {}),
    ...extra,
  }
}

function makeCharter(dir: string): void {
  const motiveDir = join(dir, '.groundwork', 'motives', MOTIVE)
  mkdirSync(motiveDir, { recursive: true })
  writeFileSync(join(motiveDir, 'motive.md'), '\n## Objective\nDeployed-path checkpoint/hold test.\n', 'utf8')
}

function initLedger(dir: string, sessionId: string): string {
  const seed = JSON.stringify({ version: 1, active: true, slices: [], gate: {} })
  const r = spawnSync('node', [LEDGER_MJS, 'init', '-', '--motive', MOTIVE], {
    env: makeEnv(dir, sessionId),
    encoding: 'utf8',
    input: seed,
  })
  if ((r.status ?? 1) !== 0) throw new Error(`ledger init failed (${r.status}): ${r.stderr}`)
  const m = r.stdout.match(/write_token:\s+(\S+)/)
  if (!m) throw new Error(`write_token missing: ${r.stdout}`)
  return m[1]
}

function tracePath(dir: string): string {
  return join(dir, '.groundwork', 'motives', MOTIVE, 'TRACE.html')
}

function mapPath(dir: string): string {
  return join(dir, '.groundwork', 'motives', MOTIVE, 'MAP.md')
}

function runHook(
  dir: string,
  sessionId: string,
  args: string[],
  extra?: Record<string, string>,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(GW_HOOK, ['ledger', ...args, '--motive', MOTIVE], {
    env: makeEnv(dir, sessionId, extra),
    encoding: 'utf8',
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('T36 — MAP.md and TRACE.html refresh via bin/gw-hook deployed path', () => {
  let dir: string
  let sessionId: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gw-hook-deployed-'))
    sessionId = `hook-deployed-${Date.now()}`
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it.skipIf(!bunPresent)(
    'bin/gw-hook bun-absent guard: test is skipped-not-vacuous when bun is missing',
    () => {
      expect(bunPresent).toBe(true)
    },
  )

  it.skipIf(!bunPresent)('checkpoint: MAP.md and TRACE.html both refresh', () => {
    makeCharter(dir)
    const token = initLedger(dir, sessionId)

    const tp = tracePath(dir)
    if (existsSync(tp)) unlinkSync(tp)

    const r = runHook(dir, sessionId, [
      'checkpoint', '--phase', 'design-deployed',
      '--verdict', 'APPROVE', '--verified-by', 'alice', '--token', token,
    ])
    expect(r.status, `gw-hook checkpoint failed:\n${r.stderr}`).toBe(0)

    const map = readFileSync(mapPath(dir), 'utf8')
    expect(map, 'MAP.md must contain phase checkpoints section').toContain('## Phase Checkpoints')
    expect(map, 'MAP.md must contain the phase name').toContain('design-deployed')

    expect(existsSync(tp), 'TRACE.html must be (re)written by bin/gw-hook checkpoint').toBe(true)
  })

  it.skipIf(!bunPresent)('hold: MAP.md and TRACE.html both refresh', () => {
    makeCharter(dir)
    const token = initLedger(dir, sessionId)

    const tp = tracePath(dir)
    if (existsSync(tp)) unlinkSync(tp)

    const r = runHook(dir, sessionId, [
      'hold', '--phase', 'wave-1', '--deliverable', 'wave 1 output', '--token', token,
    ])
    expect(r.status, `gw-hook hold failed:\n${r.stderr}`).toBe(0)

    const map = readFileSync(mapPath(dir), 'utf8')
    expect(map, 'MAP.md must contain phase checkpoints section').toContain('## Phase Checkpoints')
    expect(map, 'MAP.md must contain the deliverable').toContain('wave 1 output')

    expect(existsSync(tp), 'TRACE.html must be (re)written by bin/gw-hook hold').toBe(true)
  })
})

