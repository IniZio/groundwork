/**
 * map-ac-session-parity — regression for Bug 1 (map-ac-bare-slice-id-join).
 *
 * D-12 states slice ids are reused across sessions. When two sessions both have
 * a slice with the same bare id covering the same AC, the MAP AC renderer must
 * NOT allow one session's complete status to satisfy the AC when another
 * session's same-id slice is still pending.
 *
 * Pre-fix: _readMotiveLedgerDoc picked ONE session's ledger.  If it picked the
 * complete-session's ledger first (e.g. because it was the first active session
 * found), AC was shown as MET even though the other session's slice was pending.
 *
 * Post-fix: _readAllMotiveSlicesForAC unions ALL sessions' slices with _session_id
 * tagging, and the AC renderer keys covering entries on composite
 * "session_id::slice_id" so sessions with the same bare slice id stay distinct.
 * With any pending entry in the union the AC correctly shows as unmet.
 *
 * The fixture uses two active sessions (both active:true) so that the pre-fix
 * code deterministically picks the first-found active session.  Session A
 * (complete) is written first so readdirSync returns it before session B
 * (pending) on any filesystem where new-directory entries preserve insertion
 * order (Linux ext4, macOS APFS, tmpfs).
 *
 * ISOLATION: temp dir, no CLAUDE_CODE_SESSION_ID, no ambient project dir reads.
 */

// @ts-nocheck
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { regenerateMotiveMap } from '../../hooks/lib/motive-map.mjs'

const MOTIVE = 'session-parity-motive'

let dir: string

function motiveDir(): string {
  return join(dir, '.groundwork', 'motives', MOTIVE)
}

function runsDir(): string {
  return join(dir, '.groundwork', 'runs')
}

function writeCharter(): void {
  mkdirSync(motiveDir(), { recursive: true })
  writeFileSync(
    join(motiveDir(), 'motive.md'),
    `# ${MOTIVE}\n\n## Objective\nSession-parity fixture.\n\n## Acceptance criteria\n\n- AC-1: Must be complete in ALL sessions\n`,
  )
}

/** Write a per-session ledger file for this motive.
 * @param filename  — filename under .groundwork/runs/ (controls filesystem order)
 * @param sessionId — value for the session_id field
 * @param sliceStatus — 'complete' or 'pending'
 * @param active — whether this run is active
 */
function writeSessionLedger(
  filename: string,
  sessionId: string,
  sliceStatus: 'complete' | 'pending',
  active: boolean,
): void {
  mkdirSync(runsDir(), { recursive: true })
  writeFileSync(
    join(runsDir(), filename),
    JSON.stringify({
      version: 1,
      active,
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

function readMap(): string {
  return readFileSync(join(motiveDir(), 'MAP.md'), 'utf8')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gw-map-ac-session-parity-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// S-1: WRONG-SESSION REJECTION
//
// Session A (complete, active=true) is written first so the pre-fix code picks
// it via candidates.find(c => c.active).  Session B (pending, active=true) is
// written second.
//
// Pre-fix: only session A's slices are loaded → S1 complete → AC-1 shown MET.
// Post-fix: both sessions' slices are loaded via _readAllMotiveSlicesForAC →
//   sess-a::S1 complete AND sess-b::S1 pending → AC-1 shown UNMET.
// ---------------------------------------------------------------------------

describe('S-1: wrong-session rejection — composite key prevents false MET', () => {
  it('AC-1 is UNMET when session B has S1 pending even though session A has S1 complete', () => {
    writeCharter()

    // Write session A FIRST (complete) — pre-fix picks it via candidates.find(active)
    writeSessionLedger('sess-a.json', 'sess-a', 'complete', true)
    // Write session B SECOND (pending) — the "current" session with work in progress
    writeSessionLedger('sess-b.json', 'sess-b', 'pending', true)

    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap()

    // Post-fix: AC-1 must be UNMET — session B's pending S1 keeps it open.
    expect(map).toMatch(/✗.*\*\*AC-1\*\*/)
    expect(map).not.toMatch(/✓.*\*\*AC-1\*\*/)
  })

  it('AC-1 is MET only when ALL sessions have S1 complete', () => {
    writeCharter()

    writeSessionLedger('sess-a.json', 'sess-a', 'complete', true)
    writeSessionLedger('sess-b.json', 'sess-b', 'complete', true)

    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap()

    // Both sessions complete → MET.
    expect(map).toMatch(/✓.*\*\*AC-1\*\*/)
    expect(map).not.toMatch(/✗.*\*\*AC-1\*\*/)
  })

  it('composite session::slice ids appear in the covering display', () => {
    writeCharter()

    writeSessionLedger('sess-a.json', 'sess-a', 'complete', false)
    writeSessionLedger('sess-b.json', 'sess-b', 'complete', false)

    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap()

    // Both sessions complete → MET; the display should show both composite ids.
    expect(map).toContain('sess-a::S1')
    expect(map).toContain('sess-b::S1')
  })
})
