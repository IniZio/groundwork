/**
 * ledger-ac-coverage-emit.test.ts — regression test: gw ledger add --covers-ac
 * emits an AC_COVERAGE journal event that motive-compile.mjs compile() picks up.
 *
 * Seam verified end-to-end:
 *   src/gw/cli/commands/ledger.ts  (emits event via src/gw/lib/journal-emit.ts)
 *   hooks/lib/motive-compile.mjs   (consumes event in ac_coverage fold)
 *
 * Two-run invariant: this file is byte-identical between the red run (no
 * production emission) and the green run (emission added). The only diff
 * between runs is production source under src/gw/.
 */

import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compile } from '../../hooks/lib/motive-compile.mjs'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const GW = join(ROOT, 'dist', 'gw.mjs')
const MOTIVE = 'test-ac-cov-emit'
const SESSION = 'test-cov-sess-01'
const SLICE = 'S-COVER-TEST'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gw-ac-cov-emit-'))
  const gwDir = join(dir, '.groundwork')
  mkdirSync(join(gwDir, 'runs'), { recursive: true })
  const ledger = {
    version: 1,
    active: true,
    session_id: SESSION,
    motive: MOTIVE,
    brief: 'AC coverage emit test',
    write_token: 'tok-ac-test',
    slices: [],
    gate: {},
  }
  writeFileSync(
    join(gwDir, 'runs', `${SESSION}.json`),
    JSON.stringify(ledger, null, 2),
  )
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function runGw(args: string[]): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: SESSION }
  // dist/gw.mjs is a bun-target bundle; run with bun (bin/gw-hook uses bun too)
  const r = spawnSync('bun', [GW, ...args], { encoding: 'utf8', env })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** Read all parsed events from every JSONL shard in the journal dir. */
function readJournalEvents(): Record<string, unknown>[] {
  const journalDir = join(dir, '.groundwork', 'journal')
  let files: string[]
  try {
    files = readdirSync(journalDir).filter((f) => f.endsWith('.jsonl'))
  } catch { return [] }
  const events: Record<string, unknown>[] = []
  for (const file of files) {
    const raw = readFileSync(join(journalDir, file), 'utf8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try { events.push(JSON.parse(line) as Record<string, unknown>) } catch { /* skip malformed */ }
    }
  }
  return events
}

// ---------------------------------------------------------------------------

describe('ledger add --covers-ac: journal emission seam', () => {
  it('emits an AC_COVERAGE event accepted by compile() ac_coverage fold', () => {
    // Run ledger add with --covers-ac
    const result = runGw(['ledger', 'add', '--motive', MOTIVE, '--covers-ac', 'AC-1,AC-2', SLICE])
    expect(result.code, `gw exit; stderr: ${result.stderr}`).toBe(0)

    // 1. Assert the AC_COVERAGE event is present in the JSONL shard.
    const allEvents = readJournalEvents()
    const acEvent = allEvents.find((e) => e['type'] === 'AC_COVERAGE')
    expect(
      acEvent,
      'AC_COVERAGE event must be written to the journal shard after ledger add --covers-ac',
    ).toBeDefined()

    const data = acEvent?.['data'] as Record<string, unknown> | undefined
    expect(data?.['slice']).toBe(SLICE)
    expect(data?.['covers'] as string[]).toContain('AC-1')
    expect(data?.['covers'] as string[]).toContain('AC-2')

    // 2. Feed the event to compile() — asserts the shape satisfies the
    //    array-covers form (motive-compile.mjs:399-407) and that the fold
    //    correctly populates agent.ac_coverage.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compileView = compile([acEvent], {}) as any
    const allAc = [
      ...compileView.agent.ac_coverage.met,
      ...compileView.agent.ac_coverage.unmet,
    ] as Array<{ id: string; covering: string[] }>

    // Without a SESSION_START event setting a session context, compile falls back
    // to the bare slice id (sliceCompositeId = String(d.slice)).  The seam
    // assertion is that AC-1 and AC-2 appear in agent.ac_coverage with the slice
    // in covering — proving the array-covers payload form is accepted.
    const ac1 = allAc.find((a) => a.id === 'AC-1')
    const ac2 = allAc.find((a) => a.id === 'AC-2')
    expect(ac1?.covering, `AC-1 must be covered by ${SLICE}`).toContain(SLICE)
    expect(ac2?.covering, `AC-2 must be covered by ${SLICE}`).toContain(SLICE)
  })

  it('emits NO AC_COVERAGE event when --covers-ac is absent (positive control)', () => {
    const result = runGw(['ledger', 'add', '--motive', MOTIVE, 'S-NO-AC'])
    expect(result.code, `gw exit; stderr: ${result.stderr}`).toBe(0)

    const allEvents = readJournalEvents()
    const acEvent = allEvents.find((e) => e['type'] === 'AC_COVERAGE')
    expect(
      acEvent,
      'no AC_COVERAGE event must be written when --covers-ac is absent',
    ).toBeUndefined()
  })
})
