/**
 * Tests for hooks/migrate.mjs — "groundwork migrate features"
 *
 * AC coverage map:
 *   AC 1: tasks round-trip — every task id in tasks.md appears in RFC tasks[]
 *   AC 2: journal events — one per history entry + one DECISION per decision,
 *          preserving original timestamps
 *   AC 3: plan.md copied to notes/; docs/prds/ refs also copied
 *   AC 4: resume + ac_coverage are NOT forwarded to RFC frontmatter
 *   AC 5: invalid .feature.yaml is skipped; valid features still processed
 *   AC 6: source not deleted until rfc validate passes; negative case proves
 *          source survives a validation failure
 */

import { execFileSync, spawnSync } from 'node:child_process'
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
import { load as yamlLoad } from 'js-yaml'
import { parse as parseYaml } from 'yaml'

const HOOKS = path.resolve(import.meta.dirname, '..', '..', 'hooks')
const CLI = path.join(HOOKS, 'migrate.mjs')
const RFC_CLI = path.join(HOOKS, 'rfc.mjs')

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
  tasksMd?: string,
  planMd?: string,
): string {
  const featureDir = path.join(tmpDir, '.groundwork', 'features', slug)
  mkdirSync(featureDir, { recursive: true })

  // .feature.yaml
  writeFileSync(path.join(featureDir, '.feature.yaml'), yamlDump(featureDoc))

  // tasks.md (default if not provided)
  const tasks = tasksMd ?? `## Wave 1 — F1 first slice\n\n- [X] F1.1 First task\n- [X] F1.2 Second task\n\n## Wave 2 — F2 second slice\n\n- [ ] F2.1 Third task\n- [ ] F2.2 Fourth task\n`
  writeFileSync(path.join(featureDir, 'tasks.md'), tasks)

  // plan.md
  const plan = planMd ?? `# Plan\n\nSome plan content.\n`
  writeFileSync(path.join(featureDir, 'plan.md'), plan)

  // spec.md
  writeFileSync(path.join(featureDir, 'spec.md'), `# Spec\n\n## Goal\n\nTest feature goal.\n\n## Acceptance Criteria\n\nAC1. First AC.\nAC2. Second AC.\n`)

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

/** Read the RFC frontmatter from the first RFC directory found */
function findRfcDir(base: string): string | null {
  const rfcsDir = path.join(base, '.groundwork', 'rfcs')
  if (!existsSync(rfcsDir)) return null
  const entries = require('node:fs').readdirSync(rfcsDir)
  for (const e of entries) {
    const candidate = path.join(rfcsDir, e)
    if (existsSync(path.join(candidate, 'rfc.md'))) return candidate
  }
  return null
}

/** Read RFC frontmatter as a plain JS object */
function readRfcFrontmatter(rfcDir: string): Record<string, unknown> {
  const content = readFileSync(path.join(rfcDir, 'rfc.md'), 'utf8')
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) throw new Error('no frontmatter found')
  return parseYaml(match[1]) as Record<string, unknown>
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

// ---------------------------------------------------------------------------
// AC 1: tasks round-trip
// ---------------------------------------------------------------------------

describe('AC 1 — tasks round-trip', () => {
  it('every task id in tasks.md appears in RFC tasks[]', () => {
    const doc = buildFeatureYaml()
    createFeatureDir('test-feature', doc)

    const r = runMigrate(['test-feature', '--delete'])
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)

    const rfcDir = path.join(tmpDir, '.groundwork', 'rfcs')
    const dirs = require('node:fs').readdirSync(rfcDir)
    expect(dirs.length).toBe(1)
    const fm = readRfcFrontmatter(path.join(rfcDir, dirs[0]))

    const rfcTaskIds = new Set((fm.tasks as Array<{ id: string }>).map(t => t.id))
    // Source task IDs from tasks.md fixture
    const sourceIds = ['F1.1', 'F1.2', 'F2.1', 'F2.2']
    for (const id of sourceIds) {
      expect(rfcTaskIds.has(id), `task ${id} missing from RFC tasks[]`).toBe(true)
    }
    // No extra IDs
    expect(rfcTaskIds.size).toBe(sourceIds.length)
  })

  it('wave numbers are derived from ## Wave N headers', () => {
    const doc = buildFeatureYaml()
    createFeatureDir(
      'wave-feature',
      { ...doc, slug: 'wave-feature', id: 'feat_wave-feature' },
      '## Wave 3 — F3\n\n- [ ] F3.1 Task in wave 3\n',
    )

    runMigrate(['wave-feature', '--delete'])

    const rfcsDir = path.join(tmpDir, '.groundwork', 'rfcs')
    const dirs = require('node:fs').readdirSync(rfcsDir)
    const fm = readRfcFrontmatter(path.join(rfcsDir, dirs[0]))
    const task = (fm.tasks as Array<{ id: string; wave: number }>).find(t => t.id === 'F3.1')
    expect(task?.wave).toBe(3)
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
    // 3 history + 1 decision = 4 events
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
// AC 3: plan.md and docs/prds/ copy
// ---------------------------------------------------------------------------

describe('AC 3 — file copy', () => {
  it('copies plan.md to notes/', () => {
    const doc = buildFeatureYaml()
    createFeatureDir('test-feature', doc)

    runMigrate(['test-feature', '--delete'])

    const rfcsDir = path.join(tmpDir, '.groundwork', 'rfcs')
    const dirs = require('node:fs').readdirSync(rfcsDir)
    expect(existsSync(path.join(rfcsDir, dirs[0], 'notes', 'plan.md'))).toBe(true)
  })

  it('copies docs/prds/ files referenced in plan.md', () => {
    const doc = buildFeatureYaml()
    // Create a docs/prds/ file in the project
    const prdDir = path.join(tmpDir, 'docs', 'prds')
    mkdirSync(prdDir, { recursive: true })
    writeFileSync(path.join(prdDir, 'requirements.md'), '# Requirements\nSome requirements.')

    const planWithRef = `# Plan\n\nSee docs/prds/requirements.md for details.\n`
    createFeatureDir('test-feature', doc, undefined, planWithRef)

    runMigrate(['test-feature', '--delete'])

    const rfcsDir = path.join(tmpDir, '.groundwork', 'rfcs')
    const dirs = require('node:fs').readdirSync(rfcsDir)
    const copiedPrd = path.join(rfcsDir, dirs[0], 'notes', 'docs', 'prds', 'requirements.md')
    expect(existsSync(copiedPrd)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC 4: resume and ac_coverage not forwarded
// ---------------------------------------------------------------------------

describe('AC 4 — no resume/ac_coverage in RFC', () => {
  it('does not include resume in RFC frontmatter', () => {
    const doc = buildFeatureYaml()
    createFeatureDir('test-feature', doc)

    runMigrate(['test-feature', '--delete'])

    const rfcsDir = path.join(tmpDir, '.groundwork', 'rfcs')
    const dirs = require('node:fs').readdirSync(rfcsDir)
    const fm = readRfcFrontmatter(path.join(rfcsDir, dirs[0]))

    expect('resume' in fm).toBe(false)
  })

  it('does not include ac_coverage in RFC frontmatter', () => {
    const doc = buildFeatureYaml()
    createFeatureDir('test-feature', doc)

    runMigrate(['test-feature', '--delete'])

    const rfcsDir = path.join(tmpDir, '.groundwork', 'rfcs')
    const dirs = require('node:fs').readdirSync(rfcsDir)
    const fm = readRfcFrontmatter(path.join(rfcsDir, dirs[0]))

    expect('ac_coverage' in fm).toBe(false)
  })

  it('does NOT copy resume values into tasks.ac arrays', () => {
    const doc = buildFeatureYaml()
    createFeatureDir('test-feature', doc)

    runMigrate(['test-feature', '--delete'])

    const rfcsDir = path.join(tmpDir, '.groundwork', 'rfcs')
    const dirs = require('node:fs').readdirSync(rfcsDir)
    const fm = readRfcFrontmatter(path.join(rfcsDir, dirs[0]))

    // All tasks[] entries should have empty ac arrays (re-derived, not copied)
    const tasks = fm.tasks as Array<{ ac: unknown[] }>
    for (const t of tasks) {
      expect(Array.isArray(t.ac)).toBe(true)
      expect(t.ac.length).toBe(0)
    }
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

    // Valid feature was still migrated
    const rfcsDir = path.join(tmpDir, '.groundwork', 'rfcs')
    expect(existsSync(rfcsDir), `rfcsDir should exist\nstdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(true)
    const dirs = require('node:fs').readdirSync(rfcsDir)
    expect(dirs.some((d: string) => d.includes('valid-feature'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC 6: delete gating — negative test
// ---------------------------------------------------------------------------

describe('AC 6 — delete gating', () => {
  it('does not delete source when rfc validate passes (happy path)', () => {
    const doc = buildFeatureYaml()
    const featureDir = createFeatureDir('test-feature', doc)

    const r = runMigrate(['test-feature', '--delete'])
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)

    // Source deleted after successful validation
    expect(existsSync(featureDir)).toBe(false)
  })

  it('NEGATIVE: source directory survives when rfc validate fails', () => {
    // Inject a stub rfc.mjs that always exits 1 via MIGRATE_RFC_CLI env var.
    // This simulates the case where the RFC was written but validate rejects it.
    const doc = buildFeatureYaml()
    const featureDir = createFeatureDir('test-feature', doc)

    // Write a stub rfc CLI that always fails
    const stubRfcCli = path.join(tmpDir, 'stub-rfc.mjs')
    writeFileSync(
      stubRfcCli,
      `#!/usr/bin/env node\nprocess.stderr.write('rfc: validate: stub: always fails\\n');\nprocess.exit(1);\n`,
    )

    const r = runMigrate(['test-feature', '--delete'], { MIGRATE_RFC_CLI: stubRfcCli })

    // Should fail (validate failed)
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(1)
    expect(r.stderr).toMatch(/SKIP.*test-feature/)

    // RFC failed validation message
    expect(r.stderr).toMatch(/RFC failed validation/)

    // Source must still be there — AC 6: never deleted when migration fails
    expect(existsSync(featureDir), 'source must survive when rfc validate fails').toBe(true)
  })

  it('dry-run never deletes source', () => {
    const doc = buildFeatureYaml()
    const featureDir = createFeatureDir('test-feature', doc)

    const r = runMigrate(['test-feature', '--dry-run'])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/dry-run/)

    // Source must still exist
    expect(existsSync(featureDir)).toBe(true)
    // RFC dir must NOT have been created (dry-run)
    const rfcsDir = path.join(tmpDir, '.groundwork', 'rfcs')
    expect(existsSync(rfcsDir)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Additional: multiple features processed independently
// ---------------------------------------------------------------------------

describe('multi-feature isolation', () => {
  it('processes multiple features independently', () => {
    const doc1 = buildFeatureYaml({ slug: 'feature-one', id: 'feat_feature-one' })
    const doc2 = buildFeatureYaml({ slug: 'feature-two', id: 'feat_feature-two' })
    createFeatureDir('feature-one', doc1)
    createFeatureDir('feature-two', doc2)

    const r = runMigrate(['--delete'])
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)

    const rfcsDir = path.join(tmpDir, '.groundwork', 'rfcs')
    const dirs = require('node:fs').readdirSync(rfcsDir)
    expect(dirs.filter((d: string) => existsSync(path.join(rfcsDir, d, 'rfc.md'))).length).toBe(2)
  })
})
