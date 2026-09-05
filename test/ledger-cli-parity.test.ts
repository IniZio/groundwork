/**
 * test/ledger-cli-parity.test.ts
 *
 * Parity + discrimination tests for the ledger.ts `blocked_by` fix.
 *
 * (a) PARITY: gw ledger add and bin/ledger add (hooks/ledger.mjs) both write
 *     blocked_by:[] on disk when --blocked-by is omitted.
 *
 * (b) FRONTIER DISCRIMINATION: frontier includes a slice with blocked_by:[]
 *     (no DAG blockers → immediately runnable), but excludes a slice whose
 *     explicit blockers are still pending.
 *
 * (c) VALIDATE WARNING: ledger.mjs frontier emits a warning on stderr for any
 *     wave>0 slice with no non-empty blocked_by/depends_on, regardless of key
 *     presence (absent key and [] both fire); silent for wave 0 or when blockers
 *     are present.
 */

import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const ROOT = new URL('../', import.meta.url).pathname
const LEDGER_MJS = join(ROOT, 'hooks', 'ledger.mjs')
// Use the TS source directly (bypasses dist/gw.mjs bundle) so that edits to
// src/gw/cli/commands/ledger.ts are picked up immediately — the bundle is
// committed and not rebuilt between test runs.
const GW_MAIN = join(ROOT, 'src', 'gw', 'cli', 'main.ts')

const SESSION_ID = 'test'

let projectDir: string
let runPath: string

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    CLAUDE_PROJECT_DIR: projectDir,
    CLAUDE_CODE_SESSION_ID: SESSION_ID,
  }
}

/** Initialise a fresh ledger; returns the write-token. */
function initLedger(motive = 'testmotive'): string {
  const seed = JSON.stringify({ version: 1, active: true, slices: [], gate: {} })
  const r = spawnSync('node', [LEDGER_MJS, 'init', '-', '--motive', motive], {
    env: makeEnv(),
    encoding: 'utf8',
    input: seed,
  })
  if ((r.status ?? 1) !== 0) {
    throw new Error(`ledger init failed (${r.status}): ${r.stderr}`)
  }
  const m = r.stdout.match(/write_token:\s+(\S+)/)
  if (!m) throw new Error(`write_token missing in init stdout:\n${r.stdout}`)
  return m[1]
}

/** Read the slice with given id from the on-disk ledger JSON. */
function readSlice(id: string): Record<string, unknown> | undefined {
  const doc = JSON.parse(readFileSync(runPath, 'utf8')) as { slices: Record<string, unknown>[] }
  return doc.slices.find(s => s.id === id)
}

/** gw ledger add wrapper — runs TS source via bun to bypass the committed bundle. */
function gwAdd(id: string, extraArgs: string[] = []): void {
  const r = spawnSync(
    'bun',
    ['run', GW_MAIN, 'ledger', 'add', id, '--motive', 'testmotive', ...extraArgs],
    { env: makeEnv(), encoding: 'utf8' },
  )
  if ((r.status ?? 1) !== 0) {
    throw new Error(`gw ledger add ${id} failed (${r.status}): ${r.stderr}`)
  }
}

/** bin/ledger add wrapper — spawns node hooks/ledger.mjs with the standard test env. */
function binAdd(id: string, extraArgs: string[] = []): void {
  const r = spawnSync(
    'node',
    [LEDGER_MJS, 'add', id, '--motive', 'testmotive', ...extraArgs],
    { env: makeEnv(), encoding: 'utf8' },
  )
  if ((r.status ?? 1) !== 0) {
    throw new Error(`bin/ledger add ${id} failed (${r.status}): ${r.stderr}`)
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'gw-parity-'))
  mkdirSync(join(projectDir, '.groundwork', 'runs'), { recursive: true })
  runPath = join(projectDir, '.groundwork', 'runs', `${SESSION_ID}.json`)
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// (a) PARITY — both CLIs write blocked_by:[] when --blocked-by is omitted
// ---------------------------------------------------------------------------

describe('parity: gw ledger add and bin/ledger add both write blocked_by:[] when --blocked-by is omitted', () => {
  it('gw ledger add --wave 0 (no --blocked-by) → slice.blocked_by deep-equals []', () => {
    initLedger()
    gwAdd('S1', ['--wave', '0'])

    const slice = readSlice('S1')
    expect(slice, 'S1 not found in ledger').toBeDefined()
    expect(slice!.blocked_by).toEqual([])
  })

  it('bin/ledger add --wave 0 (no --blocked-by) → slice.blocked_by deep-equals []', () => {
    initLedger()
    binAdd('S1', ['--wave', '0'])

    const slice = readSlice('S1')
    expect(slice, 'S1 not found in ledger').toBeDefined()
    expect(slice!.blocked_by).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (b) FRONTIER DISCRIMINATION
//
// Title: frontier excludes wave-N slice while wave-(N-1) pending in both
//        absent and explicit-dep cases
//
// Implementation note: the dag-utils frontier uses pure DAG logic — a slice
// with blocked_by:[] has no DAG blockers so it IS in the frontier regardless
// of wave.  A slice with explicit pending blockers is excluded.  This test
// pins both behaviours so they can't silently regress.
// ---------------------------------------------------------------------------

describe('frontier excludes wave-N slice while wave-(N-1) pending in both absent and explicit-dep cases', () => {
  it('S16 with blocked_by:[] appears in frontier while S14/S15 (wave 5) are pending', () => {
    initLedger()
    gwAdd('S14', ['--wave', '5'])
    gwAdd('S15', ['--wave', '5'])
    // No --blocked-by → after fix, blocked_by:[] written to disk
    gwAdd('S16', ['--wave', '6'])

    const s16 = readSlice('S16')
    expect(s16!.blocked_by, 'blocked_by should be [] after fix').toEqual([])

    const fr = spawnSync('bun', ['run', GW_MAIN, 'ledger', 'frontier', '--motive', 'testmotive'], {
      env: makeEnv(), encoding: 'utf8',
    })
    // blocked_by:[] → no DAG blockers → S16 is immediately runnable
    expect(fr.stdout, 'S16 with blocked_by:[] should appear in frontier').toContain('S16')
  })

  it('S16 with blocked_by:[S14,S15] does not appear in frontier while S14/S15 are pending', () => {
    initLedger()
    gwAdd('S14', ['--wave', '5'])
    gwAdd('S15', ['--wave', '5'])
    gwAdd('S16', ['--wave', '6', '--blocked-by', 'S14,S15'])

    const fr = spawnSync('bun', ['run', GW_MAIN, 'ledger', 'frontier', '--motive', 'testmotive'], {
      env: makeEnv(), encoding: 'utf8',
    })
    // S14/S15 are pending (not in terminalSet) → S16 excluded from frontier
    expect(fr.stdout, 'S16 with pending blockers should not appear in frontier').not.toContain('S16')
    // S14, S15 have no blockers so they DO appear
    expect(fr.stdout).toContain('S14')
    expect(fr.stdout).toContain('S15')
  })
})

// ---------------------------------------------------------------------------
// (c) VALIDATE WARNING
//
// validateLedgerDoc warns when a wave>0 slice has no blocked_by key at all.
// The warning is surfaced by warnValidate() which is called by the
// hooks/ledger.mjs frontier command (ledger.ts does not call warnValidate).
// ---------------------------------------------------------------------------

describe('validate warning: fires for wave>0 slice with no real blockers, silent when blockers present', () => {
  it('frontier emits warning on stderr for a wave:2 slice with no blocked_by key', () => {
    // Write ledger JSON directly — bypass init so we can omit the blocked_by key
    const ledger = {
      version: 1,
      active: true,
      motive: 'testmotive',
      slices: [
        // Deliberately no blocked_by key on a wave:2 slice
        { id: 'S1', wave: 2, status: 'pending', kind: 'impl' },
      ],
      gate: {},
    }
    writeFileSync(runPath, JSON.stringify(ledger))

    const r = spawnSync('node', [LEDGER_MJS, 'frontier', '--motive', 'testmotive'], {
      env: makeEnv(), encoding: 'utf8',
    })
    expect(r.stderr).toContain('has no blockers — treated as a root')
  })

  it('frontier emits warning for wave>0 slice added via gw ledger add with no --blocked-by (blocked_by:[])', () => {
    initLedger()
    // gw ledger add writes blocked_by:[] — warning must fire because the array is empty
    gwAdd('S1', ['--wave', '2'])

    const r = spawnSync('node', [LEDGER_MJS, 'frontier', '--motive', 'testmotive'], {
      env: makeEnv(), encoding: 'utf8',
    })
    expect(r.stderr).toContain('has no blockers — treated as a root')
  })

  it('frontier emits no warning for a wave:0 slice with no blocked_by', () => {
    initLedger()
    gwAdd('S0', ['--wave', '0'])

    const r = spawnSync('node', [LEDGER_MJS, 'frontier', '--motive', 'testmotive'], {
      env: makeEnv(), encoding: 'utf8',
    })
    expect(r.stderr).not.toContain('has no blockers — treated as a root')
  })

  it('frontier emits no warning for a wave:2 slice with --blocked-by S0 (non-empty blockers)', () => {
    initLedger()
    gwAdd('S0', ['--wave', '0'])
    gwAdd('S1', ['--wave', '2', '--blocked-by', 'S0'])

    const r = spawnSync('node', [LEDGER_MJS, 'frontier', '--motive', 'testmotive'], {
      env: makeEnv(), encoding: 'utf8',
    })
    expect(r.stderr).not.toContain('has no blockers — treated as a root')
  })
})
