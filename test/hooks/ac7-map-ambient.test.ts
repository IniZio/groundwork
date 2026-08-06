/**
 * AC-7 failability-proven test.
 *
 * CITATION ACCURACY (verified against source before writing):
 *   AC-7 claims enforcement via "hooks/lib/motive-tickets.mjs and the ledger write path."
 *   Reality:
 *   - hooks/lib/motive-map.mjs is the load-bearing file — it exports regenerateMotiveMap().
 *   - hooks/lib/motive-tickets.mjs is called BY motive-map.mjs for open-item drill-downs;
 *     it does NOT trigger MAP.md regeneration and is NOT a mutation hook.
 *   - The "ledger write path" claim IS accurate: ledger.mjs calls _tryRefreshMap(projectDir)
 *     (which calls regenerateMotiveMap) at lines 804 (add), 582 (complete), 899 (set).
 *   - journal.mjs calls regenerateMotiveMap(projectDir, motive) directly at line 603 (append).
 *   Verdict: PARTIAL. motive-tickets.mjs should be replaced by motive-map.mjs in the text.
 *
 * LEDGER PATHS COVERED:
 *   - Legacy:     .groundwork/run.json        (CLAUDE_CODE_SESSION_ID absent, legacy fallback)
 *   - Production: .groundwork/runs/<id>.json  (CLAUDE_CODE_SESSION_ID set, production path)
 *
 * ISOLATION:
 *   All mutations go to throwaway temp dirs from createMotiveFixture().
 *   The real .groundwork/motives/groundwork-development/MAP.md is hashed before any test and
 *   verified unchanged at the end.
 *
 * FAILABILITY PROOF (see bottom of file for instructions):
 *   Break: comment out `writeFileSync(join(motiveDir, 'MAP.md'), md, 'utf8')` in
 *   hooks/lib/motive-map.mjs (line 72). MAP.md is never created → first assertion
 *   "expect(map).not.toBe('')" fails. Restore the line → all tests pass.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createMotiveFixture, type MotiveFixture } from '../helpers/motive-fixture.js'

// ── Repo paths ────────────────────────────────────────────────────────────────

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const JOURNAL_MJS = path.join(ROOT, 'hooks', 'journal.mjs')
const LEDGER_MJS  = path.join(ROOT, 'hooks', 'ledger.mjs')

// The real MAP.md that must NEVER be rewritten by any test run.
const REAL_MAP_PATH = path.join(
  ROOT, '.groundwork', 'motives', 'groundwork-development', 'MAP.md',
)

// Capture the hash before any test runs (module evaluation time).
const REAL_MAP_HASH_BEFORE = createHash('sha256')
  .update(readFileSync(REAL_MAP_PATH))
  .digest('hex')

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Read MAP.md for the given motive under projectDir; '' if the file doesn't exist. */
function readMap(projectDir: string, slug: string): string {
  const p = path.join(projectDir, '.groundwork', 'motives', slug, 'MAP.md')
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

/**
 * Minimal ledger JSON with the motive field stamped.
 * token_free:true — complete/gate operations need no --token flag (explicit opt-out).
 */
function minimalLedger(slug: string, sessionId: string | null = null) {
  return {
    version: 1,
    active: true,
    session_id: sessionId,
    brief: `AC-7 test ledger for motive "${slug}"`,
    motive: slug,      // <-- required: _tryRefreshMap reads this to decide whether to regenerate
    reinforcements: 0,
    token_free: true,  // opt out of token enforcement so tests don't need --token
    slices: [],
    gate: {},
  }
}

function runLedger(args: string[], env: Record<string, string | undefined>) {
  const r = spawnSync('node', [LEDGER_MJS, ...args], { encoding: 'utf8', env })
  if (r.status !== 0) {
    throw new Error(
      `ledger ${args.join(' ')} failed (exit ${r.status})\n` +
      `stdout: ${r.stdout}\nstderr: ${r.stderr}`,
    )
  }
  return r
}

function runJournal(args: string[], env: Record<string, string | undefined>) {
  const r = spawnSync('node', [JOURNAL_MJS, ...args], { encoding: 'utf8', env })
  if (r.status !== 0) {
    throw new Error(
      `journal ${args.join(' ')} failed (exit ${r.status})\n` +
      `stdout: ${r.stdout}\nstderr: ${r.stderr}`,
    )
  }
  return r
}

// =============================================================================
// Suite 1 — Legacy ledger path: .groundwork/run.json
// (CLAUDE_CODE_SESSION_ID absent; fixture env already omits it)
// =============================================================================

describe('AC-7 [legacy path] MAP.md regenerates on all four mutation verbs', () => {
  let fix: MotiveFixture
  const SLUG = 'ac7-legacy-motive'

  beforeEach(() => {
    fix = createMotiveFixture({ slug: SLUG })

    // Overwrite the fixture's run.json to stamp `motive`.
    // _tryRefreshMap reads the ledger and skips silently when ledger.motive is absent;
    // the fixture's default run.json has no motive field, so we must add it here.
    writeFileSync(
      path.join(fix.projectDir, '.groundwork', 'run.json'),
      JSON.stringify(minimalLedger(SLUG, null), null, 2),
      'utf8',
    )
    // Deliberately no runs/ directory → _readMotiveLedgerDoc sees only run.json as a candidate.
  })

  afterEach(() => fix.cleanup())

  it('ledger add — slice id appears in MAP.md immediately after the command', () => {
    expect(readMap(fix.projectDir, SLUG)).toBe('')   // MAP.md not yet generated

    runLedger(['add', 'S-AC7-L-ADD', '--desc', 'ledger-add probe slice'], fix.env)

    const map = readMap(fix.projectDir, SLUG)
    expect(map).not.toBe('')                          // MAP.md was created
    expect(map).toContain('S-AC7-L-ADD')              // meaningful: new slice id present
  })

  it('ledger set — MAP.md content changes after status update', () => {
    runLedger(['add', 'S-AC7-L-SET', '--desc', 'slice for set test'], fix.env)
    const mapAfterAdd = readMap(fix.projectDir, SLUG)
    expect(mapAfterAdd).toContain('S-AC7-L-SET')

    runLedger(['set', 'S-AC7-L-SET', '--status', 'in_progress'], fix.env)

    const mapAfterSet = readMap(fix.projectDir, SLUG)
    expect(mapAfterSet).toContain('S-AC7-L-SET')
    expect(mapAfterSet).not.toBe(mapAfterAdd)         // meaningful: content changed after set
  })

  it('ledger complete — MAP.md content changes after slice is completed', () => {
    runLedger(['add', 'S-AC7-L-DONE', '--desc', 'slice to complete'], fix.env)
    const mapAfterAdd = readMap(fix.projectDir, SLUG)
    expect(mapAfterAdd).toContain('S-AC7-L-DONE')

    runLedger(['complete', 'S-AC7-L-DONE'], fix.env)

    const mapAfterComplete = readMap(fix.projectDir, SLUG)
    expect(mapAfterComplete).toContain('S-AC7-L-DONE')
    expect(mapAfterComplete).not.toBe(mapAfterAdd)    // meaningful: content changed after complete
  })

  it('journal append — decision msg appears in MAP.md immediately after the command', () => {
    runLedger(['add', 'S-AC7-L-J', '--desc', 'slice before journal append'], fix.env)
    const mapAfterAdd = readMap(fix.projectDir, SLUG)

    runJournal(
      [
        'append',
        '--motive', SLUG,
        '--type', 'DECISION',
        '--msg', 'ac7-legacy-journal-probe',
        '--data', JSON.stringify({ id: 'D-AC7-L1', decision: 'journal probe', rationale: 'ac7 test' }),
      ],
      fix.env,
    )

    const mapAfterJournal = readMap(fix.projectDir, SLUG)
    expect(mapAfterJournal).not.toBe(mapAfterAdd)           // content changed
    expect(mapAfterJournal).toContain('ac7-legacy-journal-probe')  // decision msg present
  })

  it('all four verbs in sequence — MAP.md reflects each mutation without a separate regen CLI', () => {
    // ── 1. ledger add ──────────────────────────────────────────────────────────
    expect(readMap(fix.projectDir, SLUG)).toBe('')
    runLedger(['add', 'S-AC7-L-ALL', '--desc', 'all-verbs probe slice'], fix.env)
    const mapAfterAdd = readMap(fix.projectDir, SLUG)
    expect(mapAfterAdd).not.toBe('')
    expect(mapAfterAdd).toContain('S-AC7-L-ALL')

    // ── 2. ledger set ──────────────────────────────────────────────────────────
    runLedger(['set', 'S-AC7-L-ALL', '--status', 'in_progress'], fix.env)
    const mapAfterSet = readMap(fix.projectDir, SLUG)
    expect(mapAfterSet).toContain('S-AC7-L-ALL')
    expect(mapAfterSet).not.toBe(mapAfterAdd)

    // ── 3. journal append ──────────────────────────────────────────────────────
    runJournal(
      [
        'append',
        '--motive', SLUG,
        '--type', 'DECISION',
        '--msg', 'ac7-all-verbs-journal-probe',
        '--data', '{"id":"D-AC7-SEQ","decision":"sequence probe","rationale":"ac7 seq test"}',
      ],
      fix.env,
    )
    const mapAfterJournal = readMap(fix.projectDir, SLUG)
    expect(mapAfterJournal).not.toBe(mapAfterSet)
    expect(mapAfterJournal).toContain('ac7-all-verbs-journal-probe')

    // ── 4. ledger complete ─────────────────────────────────────────────────────
    runLedger(['complete', 'S-AC7-L-ALL'], fix.env)
    const mapAfterComplete = readMap(fix.projectDir, SLUG)
    expect(mapAfterComplete).toContain('S-AC7-L-ALL')
    expect(mapAfterComplete).not.toBe(mapAfterJournal)
  })
})

// =============================================================================
// Suite 2 — Production ledger path: .groundwork/runs/<session-id>.json
// (CLAUDE_CODE_SESSION_ID set → resolveLedgerPath returns the per-session file)
// =============================================================================

describe('AC-7 [production path] MAP.md regenerates on all four mutation verbs', () => {
  let fix: MotiveFixture
  const SLUG         = 'ac7-prod-motive'
  const PROD_SESSION = 'ac7-prod-test-session'

  beforeEach(() => {
    fix = createMotiveFixture({ slug: SLUG })

    // Leave run.json as the fixture default (no motive field) so that
    // _readMotiveLedgerDoc excludes it and only considers the production ledger
    // below.  This isolates the production-path assertion: MAP.md is populated
    // from runs/<PROD_SESSION>.json, not from run.json.
    const runsDir = path.join(fix.projectDir, '.groundwork', 'runs')
    mkdirSync(runsDir, { recursive: true })
    writeFileSync(
      path.join(runsDir, `${PROD_SESSION}.json`),
      JSON.stringify(minimalLedger(SLUG, PROD_SESSION), null, 2),
      'utf8',
    )
  })

  afterEach(() => fix.cleanup())

  /** Production env: same as fixture env but with CLAUDE_CODE_SESSION_ID set. */
  function prodEnv(): Record<string, string | undefined> {
    return { ...fix.env, CLAUDE_CODE_SESSION_ID: PROD_SESSION }
  }

  it('ledger add — slice id appears in MAP.md on the production ledger path', () => {
    expect(readMap(fix.projectDir, SLUG)).toBe('')

    runLedger(['add', 'S-AC7-P-ADD', '--desc', 'prod-path add probe'], prodEnv())

    const map = readMap(fix.projectDir, SLUG)
    expect(map).not.toBe('')
    expect(map).toContain('S-AC7-P-ADD')
  })

  it('all four verbs in sequence — production path MAP.md reflects each mutation', () => {
    // ── 1. ledger add ──────────────────────────────────────────────────────────
    expect(readMap(fix.projectDir, SLUG)).toBe('')
    runLedger(['add', 'S-AC7-P-ALL', '--desc', 'prod all-verbs probe'], prodEnv())
    const mapAfterAdd = readMap(fix.projectDir, SLUG)
    expect(mapAfterAdd).not.toBe('')
    expect(mapAfterAdd).toContain('S-AC7-P-ALL')

    // ── 2. ledger set ──────────────────────────────────────────────────────────
    runLedger(['set', 'S-AC7-P-ALL', '--status', 'in_progress'], prodEnv())
    const mapAfterSet = readMap(fix.projectDir, SLUG)
    expect(mapAfterSet).toContain('S-AC7-P-ALL')
    expect(mapAfterSet).not.toBe(mapAfterAdd)

    // ── 3. journal append ──────────────────────────────────────────────────────
    // journal append uses --motive to locate projectDir; it calls regenerateMotiveMap
    // directly (no dependency on the ledger path env var).
    runJournal(
      [
        'append',
        '--motive', SLUG,
        '--type', 'DECISION',
        '--msg', 'ac7-prod-journal-probe',
        '--data', '{"id":"D-AC7-P1","decision":"prod probe","rationale":"ac7 prod test"}',
      ],
      prodEnv(),
    )
    const mapAfterJournal = readMap(fix.projectDir, SLUG)
    expect(mapAfterJournal).not.toBe(mapAfterSet)
    expect(mapAfterJournal).toContain('ac7-prod-journal-probe')

    // ── 4. ledger complete ─────────────────────────────────────────────────────
    runLedger(['complete', 'S-AC7-P-ALL'], prodEnv())
    const mapAfterComplete = readMap(fix.projectDir, SLUG)
    expect(mapAfterComplete).toContain('S-AC7-P-ALL')
    expect(mapAfterComplete).not.toBe(mapAfterJournal)
  })
})

// =============================================================================
// Suite 3 — Isolation guard: real MAP.md must never be touched
// =============================================================================

describe('AC-7 real MAP.md guard', () => {
  it('groundwork-development MAP.md is byte-for-byte unchanged after all test runs', () => {
    const after = createHash('sha256')
      .update(readFileSync(REAL_MAP_PATH))
      .digest('hex')
    expect(after).toBe(REAL_MAP_HASH_BEFORE)
  })
})
