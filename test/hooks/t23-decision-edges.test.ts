/**
 * t23-decision-edges.test.ts — G1-S6: end-to-end decision-edge round trip.
 *
 * AC coverage:
 *   S6-AC1  Full round trip: ledger add --decisions → compile shows slices → MAP.md has arrow suffix
 *
 * Isolation: every test uses mkdtemp; CLAUDE_PROJECT_DIR is overridden; the real
 * repo tree is never touched. No CLAUDE_CODE_SESSION_ID leaks from the outer env —
 * each helper sets it explicitly.
 *
 * @verifies ARTIFACT-R-010
 */

// @ts-nocheck — pure-JS .mjs targets

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
// @ts-ignore
import { compile } from '../../hooks/lib/motive-compile.mjs'
// @ts-ignore
import { regenerateMotiveMap } from '../../hooks/lib/motive-map.mjs'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const LEDGER_CLI = new URL('../../hooks/ledger.mjs', import.meta.url).pathname

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const MOTIVE    = 'tbd-23-roundtrip'
const SLICE_ID  = 'G1-S6-rt'
const DECISION_ID = 'D-40'
const SESSION_ID  = 'sess-t23-rt'
const WRITE_TOKEN = 'tok-t23-rt'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gw-t23-rt-'))
  mkdirSync(join(dir, '.groundwork', 'journal'),                  { recursive: true })
  mkdirSync(join(dir, '.groundwork', 'runs'),                     { recursive: true })
  mkdirSync(join(dir, '.groundwork', 'motives', MOTIVE),          { recursive: true })
  return dir
}

/** Write a minimal charter so MAP generation has an Objective section. */
function writeCharter(dir: string): void {
  const content = `# motive: ${MOTIVE}\n\n## Objective\nDecision-edge round-trip fixture.\n`
  writeFileSync(join(dir, '.groundwork', 'motives', MOTIVE, 'motive.md'), content, 'utf8')
}

/** Write the initial ledger that `ledger add` will mutate. */
function writeInitialLedger(dir: string): void {
  const ledger = {
    version: 1,
    active: true,
    session_id: SESSION_ID,
    motive: MOTIVE,
    brief: 'decision-edge round-trip test',
    write_token: WRITE_TOKEN,
    slices: [],
    gate: {},
  }
  writeFileSync(
    join(dir, '.groundwork', 'runs', `${SESSION_ID}.json`),
    JSON.stringify(ledger, null, 2),
    'utf8',
  )
}

/** Run the ledger CLI with the temp project dir isolated from the real repo. */
function runLedger(dir: string, args: string[]): { code: number; stdout: string; stderr: string } {
  // Explicitly set CLAUDE_CODE_SESSION_ID so the CLI targets our test ledger file.
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    CLAUDE_PROJECT_DIR: dir,
    CLAUDE_CODE_SESSION_ID: SESSION_ID,
  }
  const r = spawnSync('node', [LEDGER_CLI, ...args], { env, encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** Write a DECISION event directly to a journal shard (same pattern as other test files). */
function writeDecisionEvent(dir: string): void {
  const event = {
    ts: '2026-08-04T00:00:00.000Z',
    session: SESSION_ID,
    motive: MOTIVE,
    type: 'DECISION',
    msg: `${DECISION_ID}: Adopt decision-edge field pattern`,
    data: {
      id: DECISION_ID,
      decision: 'Attach decisions field to ledger slices and surface edges in compile + MAP',
      rationale: 'Round-trip fixture for G1-S6 acceptance test',
      status: 'accepted',
    },
  }
  writeFileSync(
    join(dir, '.groundwork', 'journal', '2026-08-04-t23.jsonl'),
    JSON.stringify(event) + '\n',
    'utf8',
  )
}

// ---------------------------------------------------------------------------
// Round-trip test
// ---------------------------------------------------------------------------

describe('G1-S6: decision-edge end-to-end round trip', () => {
  let dir: string

  beforeEach(() => {
    dir = makeTmpProject()
    writeCharter(dir)
    writeInitialLedger(dir)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('S6-AC1: ledger add --decisions → compile shows slices → MAP.md has arrow suffix', () => {
    // ── Step 1: ledger add with --decisions ──────────────────────────────────
    const addResult = runLedger(dir, [
      'add', SLICE_ID,
      '--desc', 'Decision-edge round-trip slice',
      '--decisions', DECISION_ID,
    ])
    expect(addResult.code, `ledger add stderr: ${addResult.stderr}`).toBe(0)

    // Verify the slice was persisted with decisions field
    const ledgerPath = join(dir, '.groundwork', 'runs', `${SESSION_ID}.json`)
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
    const slice = ledger.slices.find((s: any) => s.id === SLICE_ID)
    expect(slice, 'slice not found in ledger').toBeDefined()
    expect(slice.decisions).toEqual([DECISION_ID])

    // ── Step 2: journal — write DECISION event ───────────────────────────────
    writeDecisionEvent(dir)

    // ── Step 3: compile — decision_log entry must have slices join ───────────
    const decisionEvent = {
      ts: '2026-08-04T00:00:00.000Z',
      session: SESSION_ID,
      motive: MOTIVE,
      type: 'DECISION',
      msg: `${DECISION_ID}: Adopt decision-edge field pattern`,
      data: {
        id: DECISION_ID,
        decision: 'Attach decisions field to ledger slices',
        rationale: 'Round-trip fixture',
        status: 'accepted',
      },
    }
    const groundTruth = {
      ledger: { found: true, slices: ledger.slices },
      head_sha: null,
      branch: null,
      dirty_paths: [],
      existing_paths: {},
    }
    const view = compile([decisionEvent], { groundTruth })
    const log: Array<{ id: string; slices: Array<{ id: string; status: string }> }> =
      view.agent.decision_log

    const entry = log.find((e) => e.id === DECISION_ID)
    expect(entry, `${DECISION_ID} not in decision_log`).toBeDefined()

    const sliceRef = entry!.slices.find((s) => s.id === SLICE_ID)
    expect(sliceRef, `${SLICE_ID} not in decision_log[${DECISION_ID}].slices`).toBeDefined()
    expect(sliceRef!.status).toBe('pending')

    // ── Step 4: MAP.md — decision line must carry "→ SLICE_ID (pending)" ──────
    regenerateMotiveMap(dir, MOTIVE)
    const map = readFileSync(join(dir, '.groundwork', 'motives', MOTIVE, 'MAP.md'), 'utf8')
    expect(map).toContain(`→ ${SLICE_ID} (pending)`)
  })
})
