/**
 * Tests for hooks/migrate.mjs — "groundwork migrate features"
 *
 * AC coverage map:
 *   AC 1: ac_coverage → AC_COVERAGE journal events (one per ac×slice pair)
 *   AC 2: journal events — one per history entry + one DECISION per decision,
 *          preserving original timestamps
 *   AC 3: motive charter created with objective from spec.md Goal section
 *   AC 4: AC_COVERAGE events carry motive field; events have correct structure
 *   AC 5: invalid .feature.yaml is skipped; valid features still processed
 *   AC 6: source not deleted on failure (idempotency + safety); --delete
 *          removes source on success; dry-run never creates motive dir
 */

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dump as yamlDump } from 'js-yaml'

const HOOKS = path.resolve(import.meta.dirname, '..', '..', 'hooks')
const CLI = path.join(HOOKS, 'migrate.mjs')

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'gw-migrate-'))
})
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }))

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid .feature.yaml document */
function buildFeatureYaml(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    id: 'feat_test-feature',
    slug: 'test-feature',
    active: true,
    status: 'started',
    health: 'onTrack',
    plan_ref: '.groundwork/features/test-feature/plan.md',
    spec_ref: null,
    branch: null,
    ac_coverage: {
      AC1: ['F1'],
      AC2: ['F1', 'F2'],
    },
    resume: {
      pointer: 'slice:F2',
      slice_id: 'F2',
      next_actions: ['Do the next thing'],
      blocked_reason: null,
      waiting_on: null,
      updated_at: '2026-07-20T10:00:00Z',
      updated_by_session: 'sess-abc',
    },
    runs: [
      {
        session_id: 'sess-abc',
        slices_completed: ['F1'],
        started_at: '2026-07-20T09:00:00Z',
        ended_at: null,
        gate_advisor: 'pending',
      },
    ],
    history: [
      { at: '2026-07-18T08:00:00Z', type: 'created', summary: 'Feature created', session_id: 'sess-abc', ref: null },
      { at: '2026-07-19T09:00:00Z', type: 'status_update', summary: 'Status updated', session_id: 'sess-abc', ref: null },
      { at: '2026-07-20T10:00:00Z', type: 'slice_complete', summary: 'F1 done', session_id: 'sess-abc', ref: 'F1' },
    ],
    decisions: [
      { at: '2026-07-18T08:30:00Z', summary: 'Use approach X not Y', adr: null },
    ],
    links: {
      linear_project_id: null,
      linear_issue_ids: [],
      github_issue: null,
      github_prs: [],
      handoffs: [],
    },
    created_at: '2026-07-18T08:00:00Z',
    updated_at: '2026-07-20T10:00:00Z',
    ...overrides,
  }
}

/** Create a feature directory with all files in tmpDir */
function createFeatureDir(
  slug: string,
  featureDoc: Record<string, unknown>,
  specMd?: string,
): string {
  const featureDir = path.join(tmpDir, '.groundwork', 'features', slug)
  mkdirSync(featureDir, { recursive: true })

  // .feature.yaml
  writeFileSync(path.join(featureDir, '.feature.yaml'), yamlDump(featureDoc))

  // tasks.md (kept for migrate compatibility)
  writeFileSync(path.join(featureDir, 'tasks.md'), `## Wave 1\n\n- [X] F1.1 First task\n\n## Wave 2\n\n- [ ] F2.1 Second task\n`)

  // plan.md
  writeFileSync(path.join(featureDir, 'plan.md'), `# Plan\n\nSome plan content.\n`)

  // spec.md
  const spec = specMd ?? `# Spec\n\n## Goal\n\nTest feature goal.\n\n## Acceptance Criteria\n\nAC1. First AC.\nAC2. Second AC.\n`
  writeFileSync(path.join(featureDir, 'spec.md'), spec)

  return featureDir
}

/** Run migrate CLI and return the result */
function runMigrate(args: string[], env: Record<string, string> = {}): {
  stdout: string; stderr: string; status: number
} {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir, JOURNAL_SESSION_ID: 'test-session', ...env },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? -1,
  }
}

/** Read all journal events from tmpDir's journal directory */
function readJournalEvents(base: string): Array<Record<string, unknown>> {
  const journalDir = path.join(base, '.groundwork', 'journal')
  if (!existsSync(journalDir)) return []
  const events: Array<Record<string, unknown>> = []
  const { readdirSync: rd, readFileSync: rf } = require('node:fs')
  for (const f of rd(journalDir)) {
    if (!f.endsWith('.jsonl')) continue
    const lines = rf(path.join(journalDir, f), 'utf8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try { events.push(JSON.parse(trimmed)) } catch { /* skip */ }
    }
  }
  return events
}

/** Read the motive charter file for a given slug */
function readMotiveCharter(base: string, slug: string): string | null {
  const charterPath = path.join(base, '.groundwork', 'motives', slug, 'motive.md')
  if (!existsSync(charterPath)) return null
  return readFileSync(charterPath, 'utf8')
}

// ---------------------------------------------------------------------------
// AC 1: ac_coverage → AC_COVERAGE journal events
// ---------------------------------------------------------------------------

describe('AC 1 — ac_coverage → AC_COVERAGE events', () => {
  it('emits one AC_COVERAGE event per ac×slice pair from ac_coverage', () => {
    // Fixture: AC1→[F1], AC2→[F1,F2] → 3 total AC_COVERAGE events
    const doc = buildFeatureYaml()
    createFeatureDir('test-feature', doc)

    const r = runMigrate(['test-feature', '--delete'])
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)

    const events = readJournalEvents(tmpDir)
    const acEvents = events.filter(e => e.type === 'AC_COVERAGE')

    expect(acEvents.length).toBe(3)

    // AC1→F1
    expect(acEvents.some(e =>
      (e.data as Record<string, unknown>)?.ac === 'AC1' &&
      (e.data as Record<string, unknown>)?.slice === 'F1'
    )).toBe(true)
    // AC2→F1
    expect(acEvents.some(e =>
      (e.data as Record<string, unknown>)?.ac === 'AC2' &&
      (e.data as Record<string, unknown>)?.slice === 'F1'
    )).toBe(true)
    // AC2→F2
    expect(acEvents.some(e =>
      (e.data as Record<string, unknown>)?.ac === 'AC2' &&
      (e.data as Record<string, unknown>)?.slice === 'F2'
    )).toBe(true)
  })

  it('AC_COVERAGE events carry the motive field set to the feature slug', () => {
    const doc = buildFeatureYaml()
    createFeatureDir('test-feature', doc)

    runMigrate(['test-feature', '--delete'])

    const events = readJournalEvents(tmpDir)
    const acEvents = events.filter(e => e.type === 'AC_COVERAGE')
    for (const ev of acEvents) {
      expect(ev.motive).toBe('test-feature')
    }
  })
})

// ---------------------------------------------------------------------------
// AC 2: journal events with preserved timestamps
// ---------------------------------------------------------------------------

describe('AC 2 — journal events', () => {
  it('emits one journal event per history entry, preserving original timestamps', () => {
    const doc = buildFeatureYaml()
    createFeatureDir('test-feature', doc)

    runMigrate(['test-feature', '--delete'])

    const events = readJournalEvents(tmpDir)
    // 3 history + 1 decision + 3 AC_COVERAGE = 7 events
    expect(events.length).toBeGreaterThanOrEqual(4)

    // Timestamps preserved
    expect(events.some(e => e.ts === '2026-07-18T08:00:00Z' && e.type === 'MILESTONE')).toBe(true)
    expect(events.some(e => e.ts === '2026-07-19T09:00:00Z' && e.type === 'MILESTONE')).toBe(true)
    expect(events.some(e => e.ts === '2026-07-20T10:00:00Z' && e.type === 'TASK_COMPLETE')).toBe(true)
  })

  it('emits one DECISION event per decisions entry', () => {
    const doc = buildFeatureYaml()
    createFeatureDir('test-feature', doc)

    runMigrate(['test-feature', '--delete'])

    const events = readJournalEvents(tmpDir)
    const decisions = events.filter(e => e.type === 'DECISION')
    expect(decisions.length).toBe(1)
    expect(decisions[0].ts).toBe('2026-07-18T08:30:00Z')
    expect(decisions[0].msg).toBe('Use approach X not Y')
  })
})

// ---------------------------------------------------------------------------
// AC 3: motive charter created with objective from spec.md
// ---------------------------------------------------------------------------

describe('AC 3 — charter creation', () => {
  it('creates motive charter at .groundwork/motives/<slug>/motive.md', () => {
    const doc = buildFeatureYaml()
    createFeatureDir('test-feature', doc)

    const r = runMigrate(['test-feature', '--delete'])
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)

    const charter = readMotiveCharter(tmpDir, 'test-feature')
    expect(charter).not.toBeNull()
  })

  it('uses spec.md ## Goal section as the objective', () => {
    const doc = buildFeatureYaml()
    createFeatureDir('test-feature', doc, `# Spec\n\n## Goal\n\nBuild a better widget.\n\n## ACs\n\nAC1. Done.\n`)

    runMigrate(['test-feature', '--delete'])

    const charter = readMotiveCharter(tmpDir, 'test-feature')
    expect(charter).toContain('Build a better widget.')
  })

  it('falls back to placeholder objective when spec.md has no Goal section', () => {
    const doc = buildFeatureYaml()
    createFeatureDir('test-feature', doc, `# Spec\n\nNo goal section here.\n`)

    runMigrate(['test-feature', '--delete'])

    const charter = readMotiveCharter(tmpDir, 'test-feature')
    expect(charter).toContain('migrated from feature test-feature')
  })
})

// ---------------------------------------------------------------------------
// AC 4: events carry motive field; migration note in charter
// ---------------------------------------------------------------------------

describe('AC 4 — event structure and charter provenance', () => {
  it('all journal events carry the motive field set to the feature slug', () => {
    const doc = buildFeatureYaml()
    createFeatureDir('test-feature', doc)

    runMigrate(['test-feature', '--delete'])

    const events = readJournalEvents(tmpDir)
    for (const ev of events) {
      expect(ev.motive).toBe('test-feature')
    }
  })

  it('charter contains migration note referencing ac_coverage (Q15 lossy history)', () => {
    const doc = buildFeatureYaml()
    createFeatureDir('test-feature', doc)

    runMigrate(['test-feature', '--delete'])

    const charter = readMotiveCharter(tmpDir, 'test-feature')
    expect(charter).toContain('Migration note')
    expect(charter).toContain('AC1')
    expect(charter).toContain('AC2')
  })
})

// ---------------------------------------------------------------------------
// AC 5: invalid feature skipped, others proceed
// ---------------------------------------------------------------------------

describe('AC 5 — skip invalid feature', () => {
  it('skips invalid .feature.yaml and continues with valid ones', () => {
    // Valid feature
    const validDoc = buildFeatureYaml({ slug: 'valid-feature', id: 'feat_valid-feature' })
    createFeatureDir('valid-feature', validDoc)

    // Invalid feature — missing required fields
    const invalidDir = path.join(tmpDir, '.groundwork', 'features', 'invalid-feature')
    mkdirSync(invalidDir, { recursive: true })
    writeFileSync(
      path.join(invalidDir, '.feature.yaml'),
      yamlDump({ version: 1, slug: 'invalid-feature' }), // missing required fields
    )
    writeFileSync(path.join(invalidDir, 'tasks.md'), '- [ ] F1.1 Task\n')

    const r = runMigrate(['--delete'])
    // Exit 1 because at least one feature failed
    expect(r.status).toBe(1)
    // Invalid feature reported
    expect(r.stderr).toMatch(/SKIP.*invalid-feature/)

    // Valid feature was still migrated (motive dir created)
    const motiveDir = path.join(tmpDir, '.groundwork', 'motives')
    expect(existsSync(motiveDir), `motives dir should exist\nstdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(true)
    const dirs = require('node:fs').readdirSync(motiveDir)
    expect(dirs.some((d: string) => d === 'valid-feature')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC 6: delete gating
// ---------------------------------------------------------------------------

describe('AC 6 — delete gating', () => {
  it('deletes source after successful migration when --delete is passed', () => {
    const doc = buildFeatureYaml()
    const featureDir = createFeatureDir('test-feature', doc)

    const r = runMigrate(['test-feature', '--delete'])
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)

    // Source deleted after successful migration
    expect(existsSync(featureDir)).toBe(false)
    // Motive charter exists
    const charter = readMotiveCharter(tmpDir, 'test-feature')
    expect(charter).not.toBeNull()
  })

  it('NEGATIVE: source directory survives when motive already exists (idempotent skip)', () => {
    const doc = buildFeatureYaml()
    const featureDir = createFeatureDir('test-feature', doc)

    // Pre-create the motive charter to trigger idempotent skip
    const motiveDir = path.join(tmpDir, '.groundwork', 'motives', 'test-feature')
    mkdirSync(motiveDir, { recursive: true })
    writeFileSync(path.join(motiveDir, 'motive.md'), '# motive: test-feature\n')

    const r = runMigrate(['test-feature', '--delete'])

    // Should fail (charter already exists)
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(1)
    expect(r.stderr).toMatch(/SKIP.*test-feature/)

    // Source must still be there — AC 6: never deleted when migration fails
    expect(existsSync(featureDir), 'source must survive when migration fails').toBe(true)
  })

  it('dry-run never creates motive dir or deletes source', () => {
    const doc = buildFeatureYaml()
    const featureDir = createFeatureDir('test-feature', doc)

    const r = runMigrate(['test-feature', '--dry-run'])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/dry-run/)

    // Source must still exist
    expect(existsSync(featureDir)).toBe(true)
    // Motive dir must NOT have been created (dry-run)
    const motiveDir = path.join(tmpDir, '.groundwork', 'motives')
    expect(existsSync(motiveDir)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Multi-feature isolation
// ---------------------------------------------------------------------------

describe('multi-feature isolation', () => {
  it('processes multiple features independently into separate motive dirs', () => {
    const doc1 = buildFeatureYaml({ slug: 'feature-one', id: 'feat_feature-one' })
    const doc2 = buildFeatureYaml({ slug: 'feature-two', id: 'feat_feature-two' })
    createFeatureDir('feature-one', doc1)
    createFeatureDir('feature-two', doc2)

    const r = runMigrate(['--delete'])
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)

    const motiveDir = path.join(tmpDir, '.groundwork', 'motives')
    expect(existsSync(path.join(motiveDir, 'feature-one', 'motive.md'))).toBe(true)
    expect(existsSync(path.join(motiveDir, 'feature-two', 'motive.md'))).toBe(true)
  })
})
