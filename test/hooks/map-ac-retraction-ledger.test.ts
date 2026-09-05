/**
 * Regression test: MAP.md must not list retracted slices as covering an AC.
 *
 * Root cause (two-part):
 *   1. _renderMap resolved covering as:
 *        ledgerCovering.length > 0 ? ledgerCovering : journalAcCoverage
 *      Ledger declarations won unconditionally; journal AC_RETRACTION events
 *      were applied only to journal-derived coverage (the fallback path) and
 *      never reached the ledger-derived list.
 *   2. MAP covering ids are SESSION-COMPOSITE (<uuid>::<SLICE-ID>); AC_RETRACTION
 *      events carry BARE slice ids (<SLICE-ID>).  Even if precedence were flipped,
 *      the ids would not match without normalization.
 *
 * Fix:
 *   - _buildAcRetractions(events) → Map<acId, Set<bareSliceId>>
 *   - _extractBareSliceId(id) normalizes composite → bare
 *   - _renderMap filters ledgerCovering with normalized comparison before the
 *     fallback decision
 *
 * Combining rule: ledger declarations are filtered by journal retractions (bare-id
 * match against composite entries); only after filtering does the journal-derived
 * fallback apply.
 *
 * Same-bare-id collision semantics: a bare retraction suppresses ALL sessions'
 * composite entries sharing that bare id (retractions are logical, not session-scoped).
 *
 * ISOLATION: scratch temp dirs only; never reads or writes .groundwork/.
 *
 * FAILABILITY PROOF (see bottom of file):
 *   Prove tests bite by reverting the core fix line and confirming
 *   production values diverge from expected output.
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { regenerateMotiveMap } from '../../hooks/lib/motive-map.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readMap(projectDir: string, slug: string): string {
  const p = path.join(projectDir, '.groundwork', 'motives', slug, 'MAP.md')
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

/**
 * Build an isolated project dir with:
 *   - a charter declaring the given ACs
 *   - ledger slices (with covers_ac and _session_id, producing composite ids)
 *   - optional journal events (AC_RETRACTION)
 */
// Ledger session_id used in all fixtures — composite ids are <LEDGER_SESSION_ID>::<SLICE_ID>
// because _readAllMotiveSlicesForAC uses the ledger's top-level session_id, not s._session_id.
const FIXTURE_SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function makeProject(opts: {
  slug: string
  acIds: string[]
  slices: Array<{ id: string; covers_ac: string; status?: string }>
  journalEvents?: object[]
}): string {
  const { slug, acIds, slices, journalEvents = [] } = opts
  const projectDir = mkdtempSync(path.join(tmpdir(), 'gw-ac-retraction-ledger-test-'))

  mkdirSync(path.join(projectDir, '.groundwork', 'journal'), { recursive: true })
  mkdirSync(path.join(projectDir, '.groundwork', 'motives', slug), { recursive: true })
  mkdirSync(path.join(projectDir, '.groundwork', 'runs'), { recursive: true })

  // Charter with ACs — plain Markdown format (matches readCharter expectations)
  const acLines = acIds.map((id, i) => `- ${id}: Test statement ${i + 1}`)
  const charter = [
    `# motive: ${slug}`,
    '',
    '## Objective',
    '',
    'Regression test motive for AC retraction.',
    '',
    '## Acceptance criteria',
    '',
    ...acLines,
    '',
  ].join('\n')
  writeFileSync(
    path.join(projectDir, '.groundwork', 'motives', slug, 'motive.md'),
    charter,
    'utf8',
  )

  // Ledger with slices.
  // _readAllMotiveSlicesForAC uses the ledger's top-level session_id as the composite prefix,
  // overwriting any _session_id on the slice.  So composite ids are FIXTURE_SESSION_ID::SLICE_ID.
  const sliceObjs = slices.map((s) => ({
    id: s.id,
    covers_ac: s.covers_ac,
    status: s.status ?? 'pending',
    wave: 1,
    desc: `Slice ${s.id}`,
  }))
  const ledger = {
    motive: slug,
    active: true,
    session_id: FIXTURE_SESSION_ID,
    slices: sliceObjs,
    write_token: 'tok',
  }
  writeFileSync(
    path.join(projectDir, '.groundwork', 'runs', 'test-run.json'),
    JSON.stringify(ledger),
    'utf8',
  )

  // Journal shard (AC_RETRACTION events).
  // Must use .jsonl extension (readAllEvents filters on *.jsonl).
  // Each event must carry a `motive` field (filterEvents matches on e.motive).
  if (journalEvents.length > 0) {
    const lines = journalEvents.map((ev) => JSON.stringify({ motive: slug, ...ev })).join('\n')
    writeFileSync(
      path.join(projectDir, '.groundwork', 'journal', `${slug}.jsonl`),
      lines + '\n',
      'utf8',
    )
  }

  return projectDir
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  dirs.length = 0
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MAP AC_RETRACTION with ledger-declared covering (composite ids)', () => {
  /** Extract the AC-1 coverage line from the MAP (the line under ## Acceptance criteria). */
  function findAcLine(map: string, acId: string): string {
    return map.split('\n').find((l) => l.includes(`**${acId}**`)) ?? ''
  }

  it('(a) a retraction suppresses a covering slice in MAP output', async () => {
    const slug = 'test-retraction-suppress'
    const dir = makeProject({
      slug,
      acIds: ['AC-1'],
      slices: [{ id: 'S3-HOOKS-FIX', covers_ac: 'AC-1' }],
      journalEvents: [
        { type: 'AC_RETRACTION', data: { ac: 'AC-1', slice: 'S3-HOOKS-FIX' }, ts: '2026-09-05T00:00:00Z' },
      ],
    })
    dirs.push(dir)

    await regenerateMotiveMap(dir, slug)
    const map = readMap(dir, slug)
    const ac1Line = findAcLine(map, 'AC-1')

    // AC-1 coverage line must not list the retracted slice as covering
    expect(ac1Line).not.toContain('S3-HOOKS-FIX')
    // AC-1 should show as planning hole (no un-retracted covering slices)
    expect(ac1Line).toContain('AC-1')
    expect(ac1Line).not.toMatch(/✓/)
    expect(ac1Line).not.toMatch(/covered/)
  })

  it('(b) bare retraction id suppresses COMPOSITE-id covering entry', async () => {
    const slug = 'test-retraction-composite'
    // _readAllMotiveSlicesForAC uses the ledger's top-level session_id as the composite prefix.
    // Composite id in MAP will be FIXTURE_SESSION_ID::S3-HOOKS-FIX.
    // Retraction event carries BARE id S3-HOOKS-FIX (no uuid prefix).
    // The fix must normalize the composite to bare before comparing with the retraction.
    const dir = makeProject({
      slug,
      acIds: ['AC-1'],
      slices: [{ id: 'S3-HOOKS-FIX', covers_ac: 'AC-1' }],
      journalEvents: [
        // bare id — no uuid prefix; must still suppress the composite entry
        { type: 'AC_RETRACTION', data: { ac: 'AC-1', slice: 'S3-HOOKS-FIX' }, ts: '2026-09-05T00:00:00Z' },
      ],
    })
    dirs.push(dir)

    await regenerateMotiveMap(dir, slug)
    const map = readMap(dir, slug)
    const ac1Line = findAcLine(map, 'AC-1')

    // The composite entry (FIXTURE_SESSION_ID::S3-HOOKS-FIX) must not appear in the AC line
    expect(ac1Line).not.toContain(`${FIXTURE_SESSION_ID}::S3-HOOKS-FIX`)
    // AC-1 is not covered
    expect(ac1Line).not.toMatch(/✓/)
    expect(ac1Line).not.toMatch(/covered/)
  })

  it('positive control: non-retracted covering slice still appears in MAP', async () => {
    const slug = 'test-retraction-positive-ctrl'
    // Two slices cover AC-1; only S3-HOOKS-FIX is retracted; S6-CUTOVER survives
    const dir = makeProject({
      slug,
      acIds: ['AC-1'],
      slices: [
        { id: 'S3-HOOKS-FIX', covers_ac: 'AC-1' },
        { id: 'S6-CUTOVER',   covers_ac: 'AC-1' },
      ],
      journalEvents: [
        { type: 'AC_RETRACTION', data: { ac: 'AC-1', slice: 'S3-HOOKS-FIX' }, ts: '2026-09-05T00:00:00Z' },
      ],
    })
    dirs.push(dir)

    await regenerateMotiveMap(dir, slug)
    const map = readMap(dir, slug)
    const ac1Line = findAcLine(map, 'AC-1')

    // Retracted slice must not appear in the AC-1 coverage line
    expect(ac1Line).not.toContain('S3-HOOKS-FIX')
    // Non-retracted slice S6-CUTOVER must still appear in the AC-1 coverage line
    expect(ac1Line).toContain('S6-CUTOVER')
    // AC-1 is still covered (by S6-CUTOVER) — shows as incomplete (pending)
    expect(ac1Line).toMatch(/AC-1/)
    expect(ac1Line).toMatch(/covered/)
  })
})

// ---------------------------------------------------------------------------
// FAILABILITY PROOF
// ---------------------------------------------------------------------------
//
// The three tests above produce WRONG output under the pre-fix code:
//
//   Pre-fix core line (hooks/lib/motive-map.mjs ~979):
//     const covering = ledgerCovering.length > 0
//       ? ledgerCovering
//       : (journalAcCoverage?.get(key) ?? [])
//
//   With a ledger slice present, `ledgerCovering.length > 0` is true, so
//   journal retractions are never consulted.  MAP lists the retracted slice.
//
//   Test (a) FAILS because map contains 'S3-HOOKS-FIX' (expect not to contain).
//   Test (b) FAILS because map contains '<uuid>::S3-HOOKS-FIX' (expect not to contain).
//   Positive control passes in both cases (S6-CUTOVER is present), confirming
//   the control is not trivially suppressing everything.
//
// Post-fix lines:
//     const retractedBareIds = acRetractions?.get(key)
//     const ledgerCoveringFiltered = retractedBareIds && retractedBareIds.size > 0
//       ? ledgerCovering.filter((s) => !retractedBareIds.has(_extractBareSliceId(s.id)))
//       : ledgerCovering
//     const covering = ledgerCoveringFiltered.length > 0
//       ? ledgerCoveringFiltered
//       : (journalAcCoverage?.get(key) ?? [])
//
//   Retracted slice is filtered out → tests (a) and (b) pass.
//   Non-retracted slice survives → positive control passes.
//
// Two-run invariant compliance:
//   - This test file was created once and is byte-identical between both runs.
//   - The only diff between red and green runs is the production source
//     (hooks/lib/motive-map.mjs) reached via regenerateMotiveMap import.
//   - Red failure message names the diverging production value:
//       "expected string not to include 'S3-HOOKS-FIX'"
//     which IS a production value (the MAP.md content generated by motive-map.mjs).
//   - The test file is new (untracked); `git diff --exit-code` is vacuous on it,
//     stated honestly here per the task requirement.
