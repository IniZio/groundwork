/**
 * T4 — MAP phase-checkpoint section
 *
 * Acceptance criteria:
 *   AC-11  MAP renders a Phase Checkpoints section with deliverable, tier, and status per phase
 *   AC-11b BLOCKING phases show "BLOCKING" tier; AUTO_ADVANCES shows "auto-advance"
 *   AC-11c APPROVE verdict shows "✓ verified"; PENDING BLOCKS shows "⏳ awaiting verification";
 *          AUTO_ADVANCES with no verdict shows "auto-advancing"
 *   AC-12  Ledger with no gate.phases renders without error and without a Phase Checkpoints section
 *   AC-12b The retired pacing section (## Pacing) never appears regardless of ledger content
 *
 * @verifies AC-11 AC-12
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-ignore
import { regenerateMotiveMap } from '../../hooks/lib/motive-map.mjs'

function tmp() {
  return mkdtempSync(join(tmpdir(), 'map-phase-render-test-'))
}

function makeCharter(dir: string, motive: string) {
  const motiveDir = join(dir, '.groundwork', 'motives', motive)
  mkdirSync(motiveDir, { recursive: true })
  writeFileSync(join(motiveDir, 'motive.md'), `\n## Objective\nTest objective.\n`, 'utf8')
}

function writeLedger(dir: string, data: object) {
  const runsDir = join(dir, '.groundwork', 'runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(join(runsDir, 'run-test.json'), JSON.stringify(data), 'utf8')
}

function readMap(dir: string, motive: string): string {
  return readFileSync(join(dir, '.groundwork', 'motives', motive, 'MAP.md'), 'utf8')
}

const MOTIVE = 'test-motive'

function baseLedger(extra: object = {}) {
  return { motive: MOTIVE, active: true, slices: [], ...extra }
}

describe('AC-11 — phase checkpoint render', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('renders Phase Checkpoints section with all four phases', () => {
    makeCharter(dir, MOTIVE)
    writeLedger(dir, baseLedger({
      gate: {
        session: 'sess-1',
        motive: MOTIVE,
        phases: {
          plan: { deliverable: 'motive.md + slices', tier: 'BLOCKS', verdict: 'APPROVE', verified_by: 'alice', verified_at: '2026-09-01T10:00:00Z' },
          design: { deliverable: 'arch decisions', tier: 'BLOCKS', verdict: 'PENDING' },
          'wave-1': { deliverable: 'wave 1 artifacts', tier: 'AUTO_ADVANCES' },
          completion: { deliverable: 'advisor APPROVE', tier: 'BLOCKS', verdict: 'PENDING' },
        },
      },
    }))
    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    expect(map).toContain('## Phase Checkpoints')
    expect(map).toContain('Plan / Charter')
    expect(map).toContain('Design')
    expect(map).toContain('Implementation Wave')
    expect(map).toContain('Completion')
  })

  it('shows BLOCKING for BLOCKS tier and auto-advance for AUTO_ADVANCES tier', () => {
    makeCharter(dir, MOTIVE)
    writeLedger(dir, baseLedger({
      gate: {
        session: 'sess-1',
        motive: MOTIVE,
        phases: {
          plan: { deliverable: 'motive.md', tier: 'BLOCKS', verdict: 'PENDING' },
          'wave-1': { deliverable: 'wave artifacts', tier: 'AUTO_ADVANCES' },
        },
      },
    }))
    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    expect(map).toContain('BLOCKING')
    expect(map).toContain('auto-advance')
  })

  it('shows verified status for APPROVE verdict with date', () => {
    makeCharter(dir, MOTIVE)
    writeLedger(dir, baseLedger({
      gate: {
        session: 'sess-1',
        motive: MOTIVE,
        phases: {
          plan: { deliverable: 'motive.md', tier: 'BLOCKS', verdict: 'APPROVE', verified_by: 'bob', verified_at: '2026-09-10T12:00:00Z' },
        },
      },
    }))
    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    expect(map).toContain('✓ verified')
    expect(map).toContain('2026-09-10')
    expect(map).toContain('bob')
  })

  it('shows awaiting verification for BLOCKS phase with PENDING verdict', () => {
    makeCharter(dir, MOTIVE)
    writeLedger(dir, baseLedger({
      gate: {
        session: 'sess-1',
        motive: MOTIVE,
        phases: {
          design: { deliverable: 'arch doc', tier: 'BLOCKS', verdict: 'PENDING' },
        },
      },
    }))
    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    expect(map).toContain('⏳ awaiting verification')
  })

  it('shows awaiting verification for BLOCKS phase with NO verdict field (hold shape)', () => {
    makeCharter(dir, MOTIVE)
    writeLedger(dir, baseLedger({
      checkpoint_hold: 'design',
      gate: {
        session: 'sess-1',
        motive: MOTIVE,
        phases: {
          design: { deliverable: 'design doc v1', tier: 'BLOCKS' },
        },
      },
    }))
    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    expect(map).toContain('## Phase Checkpoints')
    expect(map).toContain('⏳ awaiting verification')
    expect(map).toContain('design doc v1')
    expect(map).not.toContain('✓ verified')
  })

  it('shows auto-advancing for AUTO_ADVANCES phase with no verdict', () => {
    makeCharter(dir, MOTIVE)
    writeLedger(dir, baseLedger({
      gate: {
        session: 'sess-1',
        motive: MOTIVE,
        phases: {
          'wave-1': { deliverable: 'wave 1', tier: 'AUTO_ADVANCES' },
        },
      },
    }))
    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    expect(map).toContain('auto-advancing')
  })
})

describe('AC-12 — no gate.phases: no section, no error', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('renders without error and without Phase Checkpoints section when gate.phases absent', () => {
    makeCharter(dir, MOTIVE)
    writeLedger(dir, baseLedger())
    expect(() => regenerateMotiveMap(dir, MOTIVE)).not.toThrow()
    const map = readMap(dir, MOTIVE)

    expect(map).not.toContain('## Phase Checkpoints')
    expect(map).toContain('## ')
  })

  it('also renders without error when gate exists but has no phases field', () => {
    makeCharter(dir, MOTIVE)
    writeLedger(dir, baseLedger({ gate: { session: 'sess-1', motive: MOTIVE } }))
    expect(() => regenerateMotiveMap(dir, MOTIVE)).not.toThrow()
    const map = readMap(dir, MOTIVE)

    expect(map).not.toContain('## Phase Checkpoints')
  })
})

describe('AC-12b — pacing section retired', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('does not render ## Pacing even when ledger has a pacing field (positive control: ## Phase Checkpoints appears with phases)', () => {
    makeCharter(dir, MOTIVE)
    writeLedger(dir, baseLedger({
      pacing: { policy: 'wave', budget: 1 },
      gate: {
        session: 'sess-1',
        motive: MOTIVE,
        phases: {
          plan: { deliverable: 'motive.md', tier: 'BLOCKS', verdict: 'PENDING' },
        },
      },
    }))
    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    expect(map).toContain('## Phase Checkpoints')
    expect(map).not.toContain('## Pacing')
  })

  it('does not render ## Pacing on a legacy ledger with pacing but no gate.phases', () => {
    makeCharter(dir, MOTIVE)
    writeLedger(dir, baseLedger({ pacing: { policy: 'wave', budget: 1 } }))
    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    expect(map).not.toContain('## Pacing')
  })
})
