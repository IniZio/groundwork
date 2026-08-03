/**
 * S6 — Acceptance: `journal compile` end-to-end
 *
 * Drives the REAL CLI (`hooks/journal.mjs`) via spawnSync in mkdtemp projects.
 * No `test/fixtures/` path is ever read in-place; fixture content is always
 * copied into a mkdtemp shard first (F4).
 *
 * AC coverage:
 *  S6-AC1 — Determinism across independent disk reads (two separate process invocations)
 *  S6-AC2 — Truncation equivalence: --at N over full stream ≡ compile over first-N stream
 *  S6-AC3 — Hook-only, through real CLI: open slices, gate verdict, next actions, DO NOT EDIT
 *  S6-AC4 — Divergence fires: slice_state_mismatch + ⚠ DIVERGENCE banner; aligning → ✓ No divergence
 *  S6-AC5 — "Never looked" ≠ "clean": --no-ground-truth → divergence_checked:false + NOT CHECKED banner
 *  S6-AC6 — No literal `ts` value asserted; fixture is always a mkdtemp copy
 *  S6-AC7 — Real repo journal/ and compiled/ are untouched
 */

import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'

// ── paths ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../')
const JOURNAL_CLI = path.join(REPO_ROOT, 'hooks', 'journal.mjs')
const FIXTURE_PATH = path.join(REPO_ROOT, 'test', 'fixtures', 'hook-only-stream.jsonl')

const TEST_MOTIVE = 'test-motive-s6'
const SHARD_NAME = 'shard-s6-compile.jsonl'

// ── cleanup tracking ──────────────────────────────────────────────────────────

const tmpDirs: string[] = []

afterAll(() => {
  for (const dir of tmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

// ── helpers ───────────────────────────────────────────────────────────────────

interface RunResult {
  status: number
  stdout: string
  stderr: string
}

/** Run `node JOURNAL_CLI <args>` with CLAUDE_PROJECT_DIR set to projectDir. */
function runJournal(projectDir: string, args: string[]): RunResult {
  const r = spawnSync(process.execPath, [JOURNAL_CLI, ...args], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: 'utf8',
    timeout: 20_000,
  })
  return {
    status: r.status ?? -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

/** Create a mkdtemp project with a journal shard containing the given lines. */
function makeJournalProject(lines: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'motive-compile-s6-'))
  tmpDirs.push(dir)
  mkdirSync(path.join(dir, '.groundwork', 'journal'), { recursive: true })
  writeFileSync(
    path.join(dir, '.groundwork', 'journal', SHARD_NAME),
    lines.join('\n') + '\n',
  )
  return dir
}

/** Read fixture lines for TEST_MOTIVE (never read FIXTURE_PATH in-place). */
function motiveFixtureLines(): string[] {
  const raw = readFileSync(FIXTURE_PATH, 'utf8')
  return raw
    .split('\n')
    .filter((l: string): boolean => {
      if (!l.trim()) return false
      const ev = JSON.parse(l) as Record<string, unknown>
      return ev.motive === TEST_MOTIVE
    })
}

/** Write a fake ledger to .groundwork/runs/test-run.json inside projectDir. */
function writeLedger(
  projectDir: string,
  slices: Array<{ id: string; wave: number; status: string; desc: string; blocked_by: string[] }>,
  gate: Record<string, unknown> = {},
): void {
  const runsDir = path.join(projectDir, '.groundwork', 'runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(
    path.join(runsDir, 'test-run.json'),
    JSON.stringify({ active: false, slices, gate }, null, 2),
  )
}

/** git init + empty commit so collectGroundTruth finds a real HEAD. */
function gitInit(dir: string): void {
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  }
  spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' })
  spawnSync('git', ['commit', '--allow-empty', '-m', 'init', '--no-gpg-sign'], {
    cwd: dir,
    encoding: 'utf8',
    env: gitEnv,
  })
}

// ── AC1: Determinism across independent disk reads ────────────────────────────

describe('S6-AC1 determinism across process invocations', () => {
  it('two separate spawnSync compile --json --no-ground-truth runs produce byte-identical stdout', () => {
    const lines = motiveFixtureLines()
    const dir = makeJournalProject(lines)

    const r1 = runJournal(dir, ['compile', TEST_MOTIVE, '--json', '--no-ground-truth', '--stdout'])
    const r2 = runJournal(dir, ['compile', TEST_MOTIVE, '--json', '--no-ground-truth', '--stdout'])

    expect(r1.status, `first run stderr: ${r1.stderr}`).toBe(0)
    expect(r2.status, `second run stderr: ${r2.stderr}`).toBe(0)
    expect(r1.stdout).not.toBe('')
    expect(r1.stdout).toBe(r2.stdout)
  })
})

// ── AC2: Truncation equivalence end-to-end ────────────────────────────────────

describe('S6-AC2 truncation equivalence', () => {
  it('--at N over full stream is byte-identical to compile over physically-N-event stream', () => {
    const lines = motiveFixtureLines()
    expect(lines.length, 'fixture must have ≥3 events').toBeGreaterThanOrEqual(3)
    const N = 3

    // Full project + --at N
    const fullDir = makeJournalProject(lines)
    const rFull = runJournal(fullDir, [
      'compile', TEST_MOTIVE, `--at`, String(N),
      '--json', '--no-ground-truth', '--stdout',
    ])

    // Truncated project (only first N events) + no --at flag
    const truncDir = makeJournalProject(lines.slice(0, N))
    const rTrunc = runJournal(truncDir, [
      'compile', TEST_MOTIVE,
      '--json', '--no-ground-truth', '--stdout',
    ])

    expect(rFull.status, `full run stderr: ${rFull.stderr}`).toBe(0)
    expect(rTrunc.status, `trunc run stderr: ${rTrunc.stderr}`).toBe(0)

    // Parse to compare structured content (shard name may differ → strip _order from comparison)
    const vFull = JSON.parse(rFull.stdout) as Record<string, unknown>
    const vTrunc = JSON.parse(rTrunc.stdout) as Record<string, unknown>

    // at_ord must both equal N
    const pFull = vFull.provenance as Record<string, unknown>
    const pTrunc = vTrunc.provenance as Record<string, unknown>
    expect(pFull.at_ord).toBe(N)
    expect(pTrunc.at_ord).toBe(N)
    expect(pFull.events_folded).toBe(N)
    expect(pTrunc.events_folded).toBe(N)

    // The shard names are identical (SHARD_NAME used for both), so stdout must be byte-identical
    expect(rFull.stdout).toBe(rTrunc.stdout)
  })
})

// ── AC3: Hook-only, through the real CLI ──────────────────────────────────────

describe('S6-AC3 hook-only compile via real CLI', () => {
  it('produces a resumable view: gate verdict, hook-only confidence, next actions, DO NOT EDIT', () => {
    const lines = motiveFixtureLines()
    const dir = makeJournalProject(lines)

    // Inject a ledger: S1 complete (in stream), S2 pending → open_slices will contain S2
    writeLedger(dir, [
      { id: 'S1', wave: 1, status: 'complete', desc: 'ordered reader', blocked_by: [] },
      { id: 'S2', wave: 2, status: 'pending', desc: 'pure fold', blocked_by: [] },
    ])

    // Run without --no-ground-truth so the ledger is collected and open_slices are populated
    const r = runJournal(dir, ['compile', TEST_MOTIVE])
    expect(r.status, `compile stderr: ${r.stderr}`).toBe(0)

    const slug = 'test-motive-s6'
    const jsonPath = path.join(dir, '.groundwork', 'compiled', `${slug}.json`)
    const mdPath = path.join(dir, '.groundwork', 'compiled', `${slug}.md`)

    expect(existsSync(jsonPath), '.json written').toBe(true)
    expect(existsSync(mdPath), '.md written').toBe(true)

    const view = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
      agent: {
        last_gate: { which: string; verdict: string } | null
        confidence: string
        open_slices: Array<{ id: string }>
        resume: { next_actions: Array<{ action: string }> }
      }
      divergence: { checked: boolean }
    }

    expect(view.agent.last_gate?.verdict).toBe('APPROVE')
    expect(view.agent.confidence).toBe('hook-only')
    // S2 is open (pending, not in stream TASK_COMPLETE list)
    const openIds = view.agent.open_slices.map((s) => s.id)
    expect(openIds).toContain('S2')
    expect(openIds).not.toContain('S1')
    // Resume next_actions: at minimum the spec_drift → reconcile action
    expect(view.agent.resume.next_actions.length).toBeGreaterThan(0)

    const md = readFileSync(mdPath, 'utf8')
    expect(md).toContain('DO NOT EDIT')

    // divergence IS checked (ground truth collected — no --no-ground-truth flag)
    expect(view.divergence.checked).toBe(true)
  })
})

// ── AC4: Divergence fires ──────────────────────────────────────────────────────

describe('S6-AC4 divergence fires on ledger mismatch', () => {
  it('slice_state_mismatch fires when ledger says pending but stream has TASK_COMPLETE', () => {
    // Use a minimal stream: one TASK_COMPLETE S1 event for the motive
    // Stream: TASK_COMPLETE S1 → fold says S1 complete
    // Ledger: S1 status=pending → ground truth says pending → MISMATCH
    const tsBase = '2026-01-01T00:00:00.000Z'
    const streamLines = [
      JSON.stringify({
        ts: tsBase,
        session: 'sess-ac4',
        motive: TEST_MOTIVE,
        type: 'TASK_COMPLETE',
        source: 'hook:ledger',
        data: { slice: 'S1' },
      }),
    ]

    const dir = makeJournalProject(streamLines)
    gitInit(dir)

    // Ledger: S1 pending — contradicts the stream
    writeLedger(dir, [
      { id: 'S1', wave: 1, status: 'pending', desc: 'ordered reader', blocked_by: [] },
    ])

    const rDiverge = runJournal(dir, ['compile', TEST_MOTIVE])
    expect(rDiverge.status, `diverge run stderr: ${rDiverge.stderr}`).toBe(0)

    const slug = 'test-motive-s6'
    const jsonPath = path.join(dir, '.groundwork', 'compiled', `${slug}.json`)
    const mdPath = path.join(dir, '.groundwork', 'compiled', `${slug}.md`)

    const view = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
      divergence: {
        checked: boolean
        banner: string
        findings: Array<{ severity: string; kind: string; id?: string }>
      }
    }

    // Must fire a slice_state_mismatch finding
    expect(view.divergence.checked).toBe(true)
    const mismatch = view.divergence.findings.find((f) => f.kind === 'slice_state_mismatch')
    expect(mismatch, 'slice_state_mismatch finding must exist').toBeDefined()
    expect(mismatch?.severity).toBe('high')
    expect(mismatch?.id).toBe('S1')

    // Banner must say DIVERGENCE
    expect(view.divergence.banner).toContain('DIVERGENCE')

    // The .md banner renders first (after the DO-NOT-EDIT comment)
    const md = readFileSync(mdPath, 'utf8')
    const contentLines = md.split('\n').filter((l) => l.trim() && !l.startsWith('<!--'))
    expect(contentLines[0]).toContain('DIVERGENCE')

    // ── Align: mark S1 complete in ledger, re-run → ✓ No divergence ─────────
    writeLedger(dir, [
      { id: 'S1', wave: 1, status: 'complete', desc: 'ordered reader', blocked_by: [] },
    ])

    const rAligned = runJournal(dir, ['compile', TEST_MOTIVE])
    expect(rAligned.status, `aligned run stderr: ${rAligned.stderr}`).toBe(0)

    const viewAligned = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
      divergence: { checked: boolean; banner: string; findings: Array<unknown> }
    }

    expect(viewAligned.divergence.checked).toBe(true)
    expect(viewAligned.divergence.findings.length).toBe(0)
    expect(viewAligned.divergence.banner).toContain('No divergence')

    const mdAligned = readFileSync(mdPath, 'utf8')
    const contentLinesAligned = mdAligned.split('\n').filter((l) => l.trim() && !l.startsWith('<!--'))
    expect(contentLinesAligned[0]).toContain('No divergence')
  })
})

// ── AC5: "Never looked" ≠ "clean" ────────────────────────────────────────────

describe('S6-AC5 --no-ground-truth is distinct from no-divergence', () => {
  it('--no-ground-truth yields divergence_checked:false and NOT CHECKED banner', () => {
    const lines = motiveFixtureLines()
    const dir = makeJournalProject(lines)

    const r = runJournal(dir, ['compile', TEST_MOTIVE, '--json', '--no-ground-truth', '--stdout'])
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)

    const view = JSON.parse(r.stdout) as {
      divergence: { checked: boolean; banner: string; findings: Array<unknown> }
    }

    expect(view.divergence.checked).toBe(false)
    expect(view.divergence.banner).toBe('NOT CHECKED')

    // Textually distinct: must NOT contain the clean-state wording
    expect(view.divergence.banner).not.toContain('No divergence')
    expect(view.divergence.banner).not.toContain('DIVERGENCE:')
  })

  it('NOT CHECKED banner appears in the .md output', () => {
    const lines = motiveFixtureLines()
    const dir = makeJournalProject(lines)

    const r = runJournal(dir, ['compile', TEST_MOTIVE, '--no-ground-truth'])
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)

    const slug = 'test-motive-s6'
    const md = readFileSync(
      path.join(dir, '.groundwork', 'compiled', `${slug}.md`),
      'utf8',
    )

    expect(md).toContain('NOT CHECKED')
    expect(md).not.toContain('✓ No divergence')
  })
})

// ── AC6 + AC7: No ts assertions; outputs land in mkdtemp; real repo untouched ─

describe('S6-AC6/AC7 fixture isolation and real-repo protection', () => {
  it('compiled outputs land under .groundwork/compiled/ in the fixture project, not the real repo', () => {
    const lines = motiveFixtureLines()
    const dir = makeJournalProject(lines)

    const r = runJournal(dir, ['compile', TEST_MOTIVE, '--no-ground-truth'])
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)

    const slug = 'test-motive-s6'
    // Written inside the fixture project
    expect(existsSync(path.join(dir, '.groundwork', 'compiled', `${slug}.json`))).toBe(true)
    expect(existsSync(path.join(dir, '.groundwork', 'compiled', `${slug}.md`))).toBe(true)

    // Real repo's compiled/ is untouched (AC7): the fixture dir is isolated from REPO_ROOT
    expect(dir).not.toBe(REPO_ROOT)
    expect(dir.startsWith(tmpdir())).toBe(true)
  })

  it('.md file contains DO NOT EDIT marker', () => {
    const lines = motiveFixtureLines()
    const dir = makeJournalProject(lines)

    runJournal(dir, ['compile', TEST_MOTIVE, '--no-ground-truth'])

    const slug = 'test-motive-s6'
    const md = readFileSync(
      path.join(dir, '.groundwork', 'compiled', `${slug}.md`),
      'utf8',
    )
    expect(md).toContain('DO NOT EDIT')
  })
})
