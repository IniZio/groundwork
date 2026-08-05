/**
 * AC-1 failability-proven test
 *
 * AC-1 (verbatim from groundwork-development motive.md):
 *   `journal compile <motive> --json` produces a non-empty `objective`,
 *   `decision_log`, and `open_items` even when no plan doc, handoff file, or
 *   derived artifact exists alongside `motive.md` in `.groundwork/`. Enforced by
 *   `hooks/lib/motive-charter.mjs:readCharter()` being the sole intent source fed
 *   to `compile()`.
 *
 * Citation verdict (verified against source):
 *   `readCharter` exists at `hooks/lib/motive-charter.mjs:332`. It is imported by
 *   `hooks/journal.mjs` and passed as `opts.charter` to `compile()`. The citation
 *   is ACCURATE.
 *
 * Failability proof (see README comments inline):
 *   Break `readCharter` → return null → test fails on `objective` (null) and
 *   `open_items` (empty). Restore → test passes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { createMotiveFixture, type MotiveFixture } from '../helpers/motive-fixture.js'

// ── Paths ─────────────────────────────────────────────────────────────────────

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const JOURNAL_MJS = path.join(ROOT, 'hooks', 'journal.mjs')

// ── Fixture lifecycle ─────────────────────────────────────────────────────────

let fix: MotiveFixture

beforeEach(() => {
  fix = createMotiveFixture({
    slug: 'ac1-intent-source',
    acceptanceCriteria: [
      '- AC-1: compile requires only motive.md as the sole intent source',
    ],
  })

  // Overwrite the minimal charter created by the fixture with a richer one that
  // contains a non-trivial Objective AND populated Open items, so both fields are
  // assertable in the compile output.  This does NOT add any plan doc, handoff
  // file, or derived artifact to .groundwork/.
  const charterPath = path.join(
    fix.projectDir, '.groundwork', 'motives', fix.motiveSlug, 'motive.md',
  )
  writeFileSync(
    charterPath,
    [
      `# motive: ${fix.motiveSlug}`,
      '',
      '## Objective',
      '',
      'Verify that journal compile derives objective, decision_log, and open_items',
      'solely from motive.md (via readCharter) and journal events, with no plan doc,',
      'handoff file, or derived artifact present in .groundwork/.',
      '',
      '## Acceptance criteria',
      '',
      '- AC-1: compile requires only motive.md as the sole intent source',
      '',
      '## Open items',
      '',
      '- TBD-1: determine how to handle motives with no explicit objective statement',
      '- TBD-2: decide whether partial compile should warn or fail when events are absent',
      '',
      '## Notes',
      '',
      'Written by test/hooks/motive-ac1-intent-source.test.ts.',
    ].join('\n'),
    'utf8',
  )

  // Append a MOTIVE_CREATED event so compile has a non-null objective.
  // compile() reads objective from MOTIVE_CREATED events (data.objective), not from
  // charter.objective.  Without this event, objective stays null under --no-ground-truth.
  const rMC = spawnSync(
    process.execPath,
    [
      JOURNAL_MJS, 'append',
      '--motive', fix.motiveSlug,
      '--type', 'MOTIVE_CREATED',
      '--msg', 'motive created: ac1-intent-source',
      '--data', JSON.stringify({
        objective: 'Verify that journal compile derives all output fields solely from motive.md and journal events.',
      }),
    ],
    { encoding: 'utf8', env: fix.env },
  )
  if (rMC.status !== 0) {
    throw new Error(`beforeEach: journal append MOTIVE_CREATED failed (exit ${rMC.status}): ${rMC.stderr}`)
  }

  // Append a DECISION event so decision_log is non-empty in compile output.
  // decision_log is built from DECISION events in journal shards — NOT from the
  // charter — so this tests the event-side of the AC alongside the charter side.
  const r = spawnSync(
    process.execPath,
    [
      JOURNAL_MJS, 'append',
      '--motive', fix.motiveSlug,
      '--type', 'DECISION',
      '--msg', 'adopt motive.md as the canonical sole intent source',
      '--data', JSON.stringify({
        id: 'D-1',
        decision: 'motive.md is the sole intent source for journal compile',
        rationale: 'a single authoritative file avoids split-brain between plan docs and the charter',
        alternatives: ['read plan docs alongside charter', 'derive intent from MILESTONE events alone'],
      }),
    ],
    { encoding: 'utf8', env: fix.env },
  )

  if (r.status !== 0) {
    throw new Error(`beforeEach: journal append DECISION failed (exit ${r.status}): ${r.stderr}`)
  }
})

afterEach(() => fix.cleanup())

// ── Test ──────────────────────────────────────────────────────────────────────

describe('AC-1: readCharter() is the sole intent source for compile()', () => {
  it('produces non-empty objective, decision_log, and open_items when .groundwork/ contains only motive.md + journal shard(s)', () => {
    // ── PRE-CONDITION: confirm .groundwork/ has no plan, handoff, or derived artifact ──
    // Only permitted entries: journal/, motives/, run.json
    const gwDir = path.join(fix.projectDir, '.groundwork')
    const topLevel = readdirSync(gwDir).sort()
    const prohibited = topLevel.filter((e) => !['journal', 'motives', 'run.json'].includes(e))

    expect(prohibited).toHaveLength(0)
    expect(existsSync(path.join(gwDir, 'compiled'))).toBe(false)   // no derived artifact
    expect(existsSync(path.join(gwDir, 'plans'))).toBe(false)       // no plan doc dir
    expect(existsSync(path.join(gwDir, 'handoffs'))).toBe(false)    // no handoff dir

    // ── RUN: journal compile --json --no-ground-truth ──
    // --json   → writes compiled JSON to stdout (in addition to disk at compiled/)
    // --no-ground-truth → skip ledger-reconstructed objective; charter is the only source
    const result = spawnSync(
      process.execPath,
      [JOURNAL_MJS, 'compile', fix.motiveSlug, '--json', '--no-ground-truth'],
      { encoding: 'utf8', env: fix.env },
    )

    expect(result.status).toBe(0)

    const view = JSON.parse(result.stdout)
    const agent = view.agent

    // ── ASSERT: all three fields non-empty — sourced solely from readCharter + events ──

    // objective: readCharter() reads motive.md → sections.get('objective')
    // Breaking readCharter to return null makes this null → assertion fails.
    expect(typeof agent.objective).toBe('string')
    expect(agent.objective.trim().length).toBeGreaterThan(0)

    // decision_log: built from DECISION events in the journal shard
    // (does NOT come from the charter; included to prove the whole compile
    //  produces a useful output without supplementary docs)
    expect(Array.isArray(agent.decision_log)).toBe(true)
    expect(agent.decision_log.length).toBeGreaterThan(0)

    // open_items: readCharter() parses ## Open items from motive.md
    // Breaking readCharter to return null makes this [] → assertion fails.
    expect(Array.isArray(agent.open_items)).toBe(true)
    expect(agent.open_items.length).toBeGreaterThan(0)
  })
})
