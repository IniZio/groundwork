/**
 * T33 — MAP.md refreshes when checkpoint or hold is recorded via the CLI.
 *
 * The prior test (map-phase-render.test.ts) calls regenerateMotiveMap() directly,
 * which cannot observe the gap where cmdCheckpoint / cmdHold never called it.
 * This test drives the DEPLOYED CLI and asserts MAP.md content, so if the call
 * is missing the assertion fails regardless of the renderer's correctness.
 *
 * @verifies AC-11
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dirname, '../..')
const LEDGER_MJS = path.join(REPO_ROOT, 'hooks/ledger.mjs')
const MOTIVE = 'cli-map-refresh'

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), 'map-refresh-cli-'))
}

function makeCharter(dir: string): void {
  const motiveDir = path.join(dir, '.groundwork', 'motives', MOTIVE)
  mkdirSync(motiveDir, { recursive: true })
  writeFileSync(path.join(motiveDir, 'motive.md'), '\n## Objective\nTest MAP refresh.\n', 'utf8')
}

function initLedger(dir: string, sessionId: string): string {
  const initFile = path.join(dir, 'init.json')
  writeFileSync(initFile, JSON.stringify({ brief: 'map refresh test', slices: [] }), 'utf8')
  const r = spawnSync('node', [LEDGER_MJS, 'init', initFile, '--motive', MOTIVE], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: sessionId },
  })
  if (r.status !== 0) throw new Error(`ledger init failed (${r.status}): ${r.stderr}`)
  const m = /^write_token:\s+(\S+)/m.exec(r.stdout)
  if (!m) throw new Error(`no write_token in: ${r.stdout}`)
  return m[1]
}

function runLedger(dir: string, sessionId: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [LEDGER_MJS, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: sessionId },
  })
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
}

function readMap(dir: string): string {
  return readFileSync(path.join(dir, '.groundwork', 'motives', MOTIVE, 'MAP.md'), 'utf8')
}

describe('T33 — MAP refreshes after CLI checkpoint / hold', () => {
  let dir: string
  let sessionId: string

  beforeEach(() => {
    dir = tmp()
    sessionId = path.basename(dir)
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('checkpoint --verdict APPROVE writes the phase row to MAP.md', () => {
    makeCharter(dir)
    const token = initLedger(dir, sessionId)

    const r = runLedger(dir, sessionId, [
      'checkpoint',
      '--phase', 'design',
      '--verdict', 'APPROVE',
      '--verified-by', 'alice',
      '--token', token,
    ])
    expect(r.status).toBe(0)

    const map = readMap(dir)
    expect(map).toContain('## Phase Checkpoints')
    expect(map).toContain('design')
    expect(map).toContain('✓ verified')
  })

  it('hold --phase writes the phase row as awaiting verification to MAP.md', () => {
    makeCharter(dir)
    const token = initLedger(dir, sessionId)

    const r = runLedger(dir, sessionId, [
      'hold',
      '--phase', 'wave-1',
      '--deliverable', 'wave 1 artifacts',
      '--token', token,
    ])
    expect(r.status).toBe(0)

    const map = readMap(dir)
    expect(map).toContain('## Phase Checkpoints')
    expect(map).toContain('auto-advancing')
  })
})
