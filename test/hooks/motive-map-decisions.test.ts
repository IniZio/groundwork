/**
 * G1-S3 — MAP surface: decision→slice edges rendered in MAP.md
 *
 * Acceptance criteria:
 *   S3-AC1  Decision lines with data.id referenced by ≥1 slice get " → S1 (status)" suffix
 *   S3-AC2  Slice lines without decisions field render byte-identically (regression guard)
 *   S3-AC3  Charter-fallback decisions (no data.id) render unchanged — no throw, no empty arrow
 *
 * @verifies ARTIFACT-R-010
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-ignore
import { regenerateMotiveMap } from '../../hooks/lib/motive-map.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmp() {
  return mkdtempSync(join(tmpdir(), 'motive-map-decisions-test-'))
}

function makeCharter(dir: string, motive: string, content: string) {
  const motiveDir = join(dir, '.groundwork', 'motives', motive)
  mkdirSync(motiveDir, { recursive: true })
  writeFileSync(join(motiveDir, 'motive.md'), content, 'utf8')
}

function writeLedger(dir: string, data: object) {
  const runsDir = join(dir, '.groundwork', 'runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(join(runsDir, 'run-test.json'), JSON.stringify(data), 'utf8')
}

function writeDecisionEvents(dir: string, events: object[]) {
  const journalDir = join(dir, '.groundwork', 'journal')
  mkdirSync(journalDir, { recursive: true })
  const lines = events.map((e) => JSON.stringify(e)).join('\n')
  writeFileSync(join(journalDir, '2026-01-01-test.jsonl'), lines + '\n', 'utf8')
}

function readMap(dir: string, motive: string): string {
  return readFileSync(join(dir, '.groundwork', 'motives', motive, 'MAP.md'), 'utf8')
}

const MOTIVE = 'test-motive'

const MINIMAL_CHARTER = `
## Objective
Test objective.
`

function baseLedger(slices: object[]) {
  return {
    motive: MOTIVE,
    active: true,
    slices,
  }
}

// ---------------------------------------------------------------------------
// S3-AC1: decision line with data.id referenced by a slice gets suffix
// ---------------------------------------------------------------------------

describe('S3-AC1 — decision→slice edge suffix', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('renders " → S1 (pending)" when one pending slice references the decision', () => {
    makeCharter(dir, MOTIVE, MINIMAL_CHARTER)
    writeDecisionEvents(dir, [
      {
        type: 'DECISION',
        motive: MOTIVE,
        ts: '2026-01-01T00:00:00Z',
        msg: 'D-40: Adopt field shape.',
        data: { id: 'D-40', title: 'Adopt field shape' },
      },
    ])
    writeLedger(dir, baseLedger([
      { id: 'S1', desc: 'Implement feature', status: 'pending', decisions: 'D-40' },
    ]))

    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    expect(map).toContain('D-40: Adopt field shape. → S1 (pending)')
  })

  it('renders " → S1 (complete)" when the referencing slice is complete', () => {
    makeCharter(dir, MOTIVE, MINIMAL_CHARTER)
    writeDecisionEvents(dir, [
      {
        type: 'DECISION',
        motive: MOTIVE,
        ts: '2026-01-02T00:00:00Z',
        msg: 'D-40: Adopt field shape.',
        data: { id: 'D-40' },
      },
    ])
    writeLedger(dir, baseLedger([
      { id: 'S1', desc: 'Done slice', status: 'complete', decisions: 'D-40' },
    ]))

    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    expect(map).toContain('D-40: Adopt field shape. → S1 (complete)')
  })

  it('renders multiple referencing slices in the suffix', () => {
    makeCharter(dir, MOTIVE, MINIMAL_CHARTER)
    writeDecisionEvents(dir, [
      {
        type: 'DECISION',
        motive: MOTIVE,
        ts: '2026-01-01T00:00:00Z',
        msg: 'D-40: Adopt field shape.',
        data: { id: 'D-40' },
      },
    ])
    writeLedger(dir, baseLedger([
      { id: 'S1', desc: 'Slice one', status: 'complete', decisions: ['D-40'] },
      { id: 'S2', desc: 'Slice two', status: 'pending', decisions: ['D-40'] },
    ]))

    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    expect(map).toContain('→ S1 (complete), S2 (pending)')
  })

  it('does not render suffix when no slice references the decision', () => {
    makeCharter(dir, MOTIVE, MINIMAL_CHARTER)
    writeDecisionEvents(dir, [
      {
        type: 'DECISION',
        motive: MOTIVE,
        ts: '2026-01-01T00:00:00Z',
        msg: 'D-41: Some other decision.',
        data: { id: 'D-41' },
      },
    ])
    writeLedger(dir, baseLedger([
      { id: 'S1', desc: 'Unrelated slice', status: 'pending' },
    ]))

    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    // The decision line should NOT contain an arrow
    const decLine = map.split('\n').find((l) => l.includes('D-41:'))
    expect(decLine).toBeDefined()
    expect(decLine).not.toContain('→')
  })
})

// ---------------------------------------------------------------------------
// S3-AC2: slice line regression guard (no decisions field = byte-identical)
// ---------------------------------------------------------------------------

describe('S3-AC2 — slice line unchanged when no decisions declared', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('frontier slice without decisions field renders without _(decisions:...)_ suffix', () => {
    makeCharter(dir, MOTIVE, MINIMAL_CHARTER)
    writeLedger(dir, baseLedger([
      { id: 'S1', desc: 'Plain slice', status: 'pending' },
    ]))

    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    const sliceLine = map.split('\n').find((l) => l.includes('S1'))
    expect(sliceLine).toBeDefined()
    expect(sliceLine).not.toContain('decisions')
  })

  it('in-progress slice without decisions field renders without suffix', () => {
    makeCharter(dir, MOTIVE, MINIMAL_CHARTER)
    writeLedger(dir, baseLedger([
      { id: 'S1', desc: 'WIP slice', status: 'in_progress' },
    ]))

    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    const sliceLine = map.split('\n').find((l) => l.includes('S1'))
    expect(sliceLine).toBeDefined()
    expect(sliceLine).not.toContain('decisions')
  })

  it('slice with decisions field renders _(decisions: D-40)_ suffix', () => {
    makeCharter(dir, MOTIVE, MINIMAL_CHARTER)
    writeLedger(dir, baseLedger([
      { id: 'S1', desc: 'Decision slice', status: 'pending', decisions: 'D-40' },
    ]))

    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    const sliceLine = map.split('\n').find((l) => l.includes('S1'))
    expect(sliceLine).toBeDefined()
    expect(sliceLine).toContain('_(decisions: D-40)_')
  })
})

// ---------------------------------------------------------------------------
// S3-AC3: charter-fallback decisions (no data.id) render unchanged, no throw
// ---------------------------------------------------------------------------

describe('S3-AC3 — charter-fallback decisions render unchanged', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('charter-fallback decision (no data.id) renders without arrow suffix', () => {
    // No journal events — forces charter fallback path
    makeCharter(dir, MOTIVE, `
## Objective
Test objective.

## Decisions
- id: old-dec
  text: A legacy decision from the charter.
`)
    writeLedger(dir, baseLedger([
      { id: 'S1', desc: 'Some slice', status: 'pending', decisions: 'D-40' },
    ]))

    // Should not throw
    expect(() => regenerateMotiveMap(dir, MOTIVE)).not.toThrow()

    const map = readMap(dir, MOTIVE)
    // The charter fallback produces entries like "{ msg: 'old-dec: A legacy decision…' }"
    // without data.id — they should NOT have an arrow
    const decisionsSection = map.split('## Decisions so far')[1]?.split('##')[0] ?? ''
    expect(decisionsSection).not.toContain('→')
  })

  it('does not throw when decisions array is empty', () => {
    makeCharter(dir, MOTIVE, MINIMAL_CHARTER)
    // No journal, no charter decisions → empty decisions array
    expect(() => regenerateMotiveMap(dir, MOTIVE)).not.toThrow()
    const map = readMap(dir, MOTIVE)
    expect(map).toContain('_No decisions recorded yet._')
  })
})

// ---------------------------------------------------------------------------
// Janitorial retraction events must NOT appear in ## Decisions so far
// ---------------------------------------------------------------------------

/**
 * P-E / ticket-05 regression:
 *   A DECISION event whose sole purpose is to suppress a legacy id-less entry
 *   (data.retires present AND decision body starts with "Retract") is agent
 *   bookkeeping, not a human-readable decision.  It must be hidden from the
 *   ## Decisions section even though its data.retires still suppresses the
 *   original target.
 *
 * Sensitivity: a normal decision (no data.retires) must remain visible.
 */
describe('janitorial retraction events hidden from ## Decisions', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('hides a DECISION event with data.retires and decision starting with "Retract"', () => {
    makeCharter(dir, MOTIVE, MINIMAL_CHARTER)
    writeDecisionEvents(dir, [
      // Substantive decision — must remain visible
      {
        type: 'DECISION',
        motive: MOTIVE,
        ts: '2026-01-01T00:00:00Z',
        msg: 'D-1: Adopt foo as the standard.',
        data: { id: 'D-1', decision: 'Adopt foo as the standard.', status: 'accepted' },
      },
      // Janitorial retraction — must be hidden
      {
        type: 'DECISION',
        motive: MOTIVE,
        ts: '2026-01-02T00:00:00Z',
        msg: 'Retract legacy id-less duplicate of D-1: suppress MAP duplicate',
        data: {
          id: 'D-90',
          decision: 'Retract legacy id-less duplicate of D-1 — suppress MAP duplicate.',
          rationale: 'Janitorial: suppresses the id-less original.',
          retires: 'Adopt foo as the standard.',
          alternatives: [],
        },
      },
    ])
    writeLedger(dir, baseLedger([]))

    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    // The janitorial retraction must NOT appear in ## Decisions
    expect(map).not.toContain('Retract legacy id-less duplicate')
    // The substantive decision must still appear
    expect(map).toContain('D-1: Adopt foo as the standard.')
  })

  it('keeps a DECISION event with data.retires but a substantive (non-Retract) decision body', () => {
    makeCharter(dir, MOTIVE, MINIMAL_CHARTER)
    writeDecisionEvents(dir, [
      // Substantive decision that also carries data.retires (e.g. D-32 pattern)
      {
        type: 'DECISION',
        motive: MOTIVE,
        ts: '2026-01-01T00:00:00Z',
        msg: 'D-32: Invert ticket/slice primacy — retires prior approach.',
        data: {
          id: 'D-32',
          decision: 'A TICKET is the durable unit of work; slices are derived.',
          retires: 'Implement ledger slice tickets as ambient human projection',
          status: 'accepted',
        },
      },
    ])
    writeLedger(dir, baseLedger([]))

    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    // Substantive decision with data.retires must remain visible
    expect(map).toContain('D-32: Invert ticket/slice primacy')
  })
})
