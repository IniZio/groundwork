/**
 * ac-seam-session-parity — spanning regression test for the STATUS-SEAM bug.
 *
 * SEAM UNDER TEST:
 *   `hooks/lib/motive-compile.mjs` (compile surface) and
 *   `hooks/lib/motive-map.mjs` (MAP surface) independently compute AC coverage
 *   status. Both must agree: if slice "S1" is COMPLETE in session A but PENDING
 *   in session B, AC-1 is UNMET — one session's completion must not satisfy the
 *   AC while another session's same-id slice is still pending.
 *
 * PRE-FIX BEHAVIOUR (compile):
 *   `acCoverageMap` stores bare slice ids. Two sessions' "S1" deduplicate in the
 *   Set. `isCompleteAnywhere("S1")` returns true because session A emitted
 *   TASK_COMPLETE → AC-1 is wrongly reported as MET.
 *
 * POST-FIX BEHAVIOUR (compile):
 *   `acCoverageMap` stores composite "${session_id}::${sliceId}".
 *   `isCompleteAnywhereComposite("sess-b::S1")` returns false (no TASK_COMPLETE
 *   from sess-b) → AC-1 correctly reported as UNMET.
 *
 * MAP SURFACE: already fixed (composite key per _readAllMotiveSlicesForAC);
 *   included here as the second half of the spanning assertion.
 *
 * ISOLATION: mkdtemp, CLAUDE_PROJECT_DIR override, no CLAUDE_CODE_SESSION_ID.
 */

// @ts-nocheck
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { regenerateMotiveMap } from '../../hooks/lib/motive-map.mjs'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = new URL('../../', import.meta.url).pathname
const JOURNAL_CLI = join(ROOT, 'hooks', 'journal.mjs')

const MOTIVE = 'seam-session-test'

let dir: string

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    CLAUDE_PROJECT_DIR: dir,
    // No CLAUDE_CODE_SESSION_ID — use legacy run.json inside temp dir
  }
}

function spawnJournal(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [JOURNAL_CLI, ...args], {
    env: makeEnv(),
    encoding: 'utf8',
  })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function writeCharter(): void {
  const charterDir = join(dir, '.groundwork', 'motives', MOTIVE)
  mkdirSync(charterDir, { recursive: true })
  writeFileSync(
    join(charterDir, 'motive.md'),
    `# ${MOTIVE}\n\n## Objective\nSession-seam fixture.\n\n## Acceptance criteria\n\n- AC-1: Must be complete in ALL sessions\n`,
  )
}

/**
 * Write a per-session ledger file for the MAP surface.
 * The MAP reads .groundwork/runs/*.json; slices with covers_ac link to ACs.
 */
function writeSessionLedger(
  filename: string,
  sessionId: string,
  sliceStatus: 'complete' | 'pending',
): void {
  const runsDir = join(dir, '.groundwork', 'runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(
    join(runsDir, filename),
    JSON.stringify({
      version: 1,
      active: true,
      motive: MOTIVE,
      session_id: sessionId,
      brief: `session ${sessionId}`,
      slices: [{
        id: 'S1',
        wave: 1,
        status: sliceStatus,
        covers_ac: 'AC-1',
        blocked_by: [],
      }],
      gate: {},
    }),
  )
}

/**
 * Write journal shards directly for the compile surface.
 * compile reads .groundwork/journal/*.jsonl and folds events by motive.
 * Events must carry top-level `motive` field or they are filtered out.
 */
function writeJournalShards(): void {
  const journalDir = join(dir, '.groundwork', 'journal')
  mkdirSync(journalDir, { recursive: true })

  // Session A: emits AC_COVERAGE + TASK_COMPLETE for S1 — slice is COMPLETE
  writeFileSync(
    join(journalDir, '2026-01-01-sess-a.jsonl'),
    [
      JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', session: 'sess-a', motive: MOTIVE, type: 'AC_COVERAGE', source: 'test', data: { slice: 'S1', ac: 'AC-1' } }),
      JSON.stringify({ ts: '2026-01-01T00:01:00.000Z', session: 'sess-a', motive: MOTIVE, type: 'TASK_COMPLETE', source: 'test', data: { slice: 'S1' } }),
    ].join('\n') + '\n',
  )

  // Session B: emits AC_COVERAGE for S1 but NO TASK_COMPLETE — slice is PENDING
  writeFileSync(
    join(journalDir, '2026-01-01-sess-b.jsonl'),
    JSON.stringify({ ts: '2026-01-01T00:02:00.000Z', session: 'sess-b', motive: MOTIVE, type: 'AC_COVERAGE', source: 'test', data: { slice: 'S1', ac: 'AC-1' } }) + '\n',
  )
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gw-ac-seam-session-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// S-2: STATUS-SEAM — same bare slice id, two sessions, one complete one pending
// ---------------------------------------------------------------------------

describe('S-2: STATUS-SEAM — same slice id in two sessions with divergent completion', () => {
  it('compile (--no-ground-truth) reports AC-1 UNMET when S1 is complete in sess-a but pending in sess-b', () => {
    writeCharter()
    writeJournalShards()

    const { code, stdout, stderr } = spawnJournal([
      'compile', MOTIVE, '--no-ground-truth', '--stdout', '--json',
    ])
    if (code !== 0) throw new Error(`compile failed (${code}): ${stderr}\n${stdout}`)

    const view = JSON.parse(stdout)
    const ac: { met: any[]; unmet: any[] } = view.agent.ac_coverage

    const metIds = ac.met.map((a: any) => a.id)
    const unmetIds = ac.unmet.map((a: any) => a.id)

    // Pre-fix: bare-id dedup makes isCompleteAnywhere("S1") return true → AC-1
    // is wrongly MET. Post-fix: composite check catches pending sess-b::S1 → UNMET.
    expect(unmetIds, 'AC-1 should be UNMET because sess-b::S1 is still pending').toContain('AC-1')
    expect(metIds, 'AC-1 must NOT appear in met when sess-b::S1 is pending').not.toContain('AC-1')

    // The covering list in the output must use bare ids (no composite leak).
    const ac1Unmet = ac.unmet.find((a: any) => a.id === 'AC-1')
    if (ac1Unmet?.covering) {
      expect(
        ac1Unmet.covering.every((id: string) => !id.includes('::')),
        'covering ids in output must be bare (no composite leak)',
      ).toBe(true)
    }
  })

  it('MAP reports AC-1 UNMET when S1 is complete in sess-a but pending in sess-b', () => {
    writeCharter()
    writeSessionLedger('sess-a.json', 'sess-a', 'complete')
    writeSessionLedger('sess-b.json', 'sess-b', 'pending')

    regenerateMotiveMap(dir, MOTIVE)

    const map = readFileSync(join(dir, '.groundwork', 'motives', MOTIVE, 'MAP.md'), 'utf8')
    expect(map).toMatch(/✗[^\n]*\*\*AC-1\*\*/)
    expect(map).not.toMatch(/✓[^\n]*\*\*AC-1\*\*/)
  })

  it('compile reports AC-1 MET when BOTH sessions have S1 complete', () => {
    writeCharter()

    // Overwrite sess-b shard to also emit TASK_COMPLETE
    const journalDir = join(dir, '.groundwork', 'journal')
    mkdirSync(journalDir, { recursive: true })
    writeFileSync(
      join(journalDir, '2026-01-01-sess-a.jsonl'),
      [
        JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', session: 'sess-a', motive: MOTIVE, type: 'AC_COVERAGE', source: 'test', data: { slice: 'S1', ac: 'AC-1' } }),
        JSON.stringify({ ts: '2026-01-01T00:01:00.000Z', session: 'sess-a', motive: MOTIVE, type: 'TASK_COMPLETE', source: 'test', data: { slice: 'S1' } }),
      ].join('\n') + '\n',
    )
    writeFileSync(
      join(journalDir, '2026-01-01-sess-b.jsonl'),
      [
        JSON.stringify({ ts: '2026-01-01T00:02:00.000Z', session: 'sess-b', motive: MOTIVE, type: 'AC_COVERAGE', source: 'test', data: { slice: 'S1', ac: 'AC-1' } }),
        JSON.stringify({ ts: '2026-01-01T00:03:00.000Z', session: 'sess-b', motive: MOTIVE, type: 'TASK_COMPLETE', source: 'test', data: { slice: 'S1' } }),
      ].join('\n') + '\n',
    )

    const { code, stdout, stderr } = spawnJournal([
      'compile', MOTIVE, '--no-ground-truth', '--stdout', '--json',
    ])
    if (code !== 0) throw new Error(`compile failed (${code}): ${stderr}\n${stdout}`)

    const view = JSON.parse(stdout)
    const ac: { met: any[]; unmet: any[] } = view.agent.ac_coverage

    const metIds = ac.met.map((a: any) => a.id)
    expect(metIds, 'AC-1 should be MET when both sessions complete S1').toContain('AC-1')
  })
})
