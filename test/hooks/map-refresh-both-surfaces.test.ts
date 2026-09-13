/**
 * T35 — MAP.md refreshes after checkpoint/hold on BOTH CLI surfaces.
 *
 * T33 (map-refresh-cli.test.ts) exercises only hooks/ledger.mjs. This test
 * additionally covers src/gw/cli/main.ts (via bun) so a regression on either
 * surface turns the suite red without touching the other.
 *
 * Known-good control: a MAP.md existence check after init — fails if fixture
 * setup is broken, proving the harness can see the file at all.
 * Known-bad controls (bite proofs run manually outside vitest):
 *   1. Remove regenerateMotiveMap call from a /tmp copy of hooks/ledger.mjs →
 *      the mjs-surface checkpoint assertion fails.
 *   2. Remove regenerateMotiveMap import/call from a /tmp project copy and run
 *      bun against it → the TS-surface checkpoint assertion fails.
 *
 * @verifies AC-11
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const LEDGER_MJS = join(ROOT, 'hooks/ledger.mjs')
const GW_MAIN = join(ROOT, 'src/gw/cli/main.ts')
const MOTIVE = 'map-refresh-dual'

function makeEnv(projectDir: string, sessionId: string): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    CLAUDE_PROJECT_DIR: projectDir,
    CLAUDE_CODE_SESSION_ID: sessionId,
  }
}

function makeCharter(dir: string): void {
  const motiveDir = join(dir, '.groundwork', 'motives', MOTIVE)
  mkdirSync(motiveDir, { recursive: true })
  writeFileSync(join(motiveDir, 'motive.md'), '\n## Objective\nDual-surface MAP refresh test.\n', 'utf8')
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

function mapPath(dir: string): string {
  return join(dir, '.groundwork', 'motives', MOTIVE, 'MAP.md')
}

function readMap(dir: string): string {
  return readFileSync(mapPath(dir), 'utf8')
}

function nodeLedger(dir: string, sessionId: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [LEDGER_MJS, ...args], { env: makeEnv(dir, sessionId), encoding: 'utf8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function bunLedger(dir: string, sessionId: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('bun', ['run', GW_MAIN, 'ledger', ...args, '--motive', MOTIVE], {
    env: makeEnv(dir, sessionId),
    encoding: 'utf8',
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('T35 — MAP refreshes after checkpoint/hold on both CLI surfaces', () => {
  let dir: string
  let sessionId: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'map-refresh-dual-'))
    sessionId = `dual-${Date.now()}`
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  // ---------------------------------------------------------------- mjs surface

  it('[mjs] known-good control: MAP.md exists after init', () => {
    makeCharter(dir)
    initLedger(dir, sessionId)
    expect(existsSync(mapPath(dir))).toBe(true)
  })

  it('[mjs] checkpoint --verdict APPROVE writes phase row to MAP.md', () => {
    makeCharter(dir)
    const token = initLedger(dir, sessionId)
    const r = nodeLedger(dir, sessionId, [
      'checkpoint', '--phase', 'design-mjs', '--verdict', 'APPROVE',
      '--verified-by', 'alice', '--token', token,
    ])
    expect(r.status).toBe(0)
    const map = readMap(dir)
    expect(map).toContain('## Phase Checkpoints')
    expect(map).toContain('design-mjs')
    expect(map).toContain('✓ verified')
  })

  it('[mjs] hold --phase writes awaiting-verification row to MAP.md', () => {
    makeCharter(dir)
    const token = initLedger(dir, sessionId)
    const r = nodeLedger(dir, sessionId, [
      'hold', '--phase', 'wave-1', '--deliverable', 'wave 1 artifacts', '--token', token,
    ])
    expect(r.status).toBe(0)
    const map = readMap(dir)
    expect(map).toContain('## Phase Checkpoints')
    expect(map).toContain('auto-advancing')
  })

  // ---------------------------------------------------------------- TS surface (bun)

  it('[bun] known-good control: MAP.md exists after init', () => {
    makeCharter(dir)
    initLedger(dir, sessionId)
    expect(existsSync(mapPath(dir))).toBe(true)
  })

  it('[bun] checkpoint --verdict APPROVE writes phase row to MAP.md', () => {
    makeCharter(dir)
    const token = initLedger(dir, sessionId)
    const r = bunLedger(dir, sessionId, [
      'checkpoint', '--phase', 'design-bun', '--verdict', 'APPROVE',
      '--verified-by', 'bob', '--token', token,
    ])
    expect(r.status, `bun surface failed:\n${r.stderr}`).toBe(0)
    const map = readMap(dir)
    expect(map).toContain('## Phase Checkpoints')
    expect(map).toContain('design-bun')
    expect(map).toContain('✓ verified')
  })

  it('[bun] hold --phase writes awaiting-verification row to MAP.md', () => {
    makeCharter(dir)
    const token = initLedger(dir, sessionId)
    const r = bunLedger(dir, sessionId, [
      'hold', '--phase', 'wave-1', '--deliverable', 'wave 1 artifacts', '--token', token,
    ])
    expect(r.status, `bun surface failed:\n${r.stderr}`).toBe(0)
    const map = readMap(dir)
    expect(map).toContain('## Phase Checkpoints')
    expect(map).toContain('auto-advancing')
  })
})
