/**
 * Shared test helper: creates an isolated, throwaway motive directory
 * (charter + journal shard + run ledger) so tests exercising
 * `journal compile`, `journal append`, and the `ledger` CLI operate ONLY
 * on that temp tree and never mutate the real `.groundwork/` state.
 *
 * ISOLATION MECHANISM
 * Both CLIs resolve the project root via:
 *   `process.env.CLAUDE_PROJECT_DIR || process.cwd()`
 * Setting `CLAUDE_PROJECT_DIR` to the temp dir is sufficient to redirect all
 * file I/O.  `CLAUDE_CODE_SESSION_ID` is omitted from the returned env so
 * the ledger CLI falls back to the legacy `.groundwork/run.json` path rather
 * than `.groundwork/runs/<session_id>.json`.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export interface MotiveFixture {
  /** Root of the throwaway project tree. */
  projectDir: string
  /** Motive slug used in the fixture (e.g. "test-motive"). */
  motiveSlug: string
  /** Absolute path to the pre-written ledger: <projectDir>/.groundwork/run.json */
  ledgerPath: string
  /**
   * Env vars to spread into any spawnSync / execFileSync call that must target
   * this temp tree.  Includes CLAUDE_PROJECT_DIR and JOURNAL_SESSION_ID.
   * CLAUDE_CODE_SESSION_ID is deliberately absent so the ledger CLI uses the
   * legacy run.json path (no session-based routing).
   */
  env: Record<string, string | undefined>
  /** Remove the temp tree synchronously.  Call in afterEach. */
  cleanup(): void
}

export interface MotiveFixtureOptions {
  /** Motive slug (default: "test-motive"). */
  slug?: string
  /** Journal session id for pre-seeded events and append writes (default: "fixture"). */
  sessionId?: string
  /** Number of pre-seeded SESSION_START events in the shard (default: 3). */
  eventCount?: number
  /**
   * Acceptance criteria lines to include verbatim in the `## Acceptance criteria`
   * section.  Each line should start with `- AC-N:`.
   * Default: one placeholder `- AC-1: placeholder acceptance criterion`.
   */
  acceptanceCriteria?: string[]
}

/**
 * Creates a throwaway motive directory containing at minimum:
 *
 *  - `.groundwork/journal/fixture.jsonl`         — pre-seeded JSONL events
 *  - `.groundwork/motives/<slug>/motive.md`       — minimal charter
 *  - `.groundwork/run.json`                       — minimal ledger (no write_token)
 *
 * Returns a {@link MotiveFixture} descriptor.  Call `.cleanup()` in afterEach.
 *
 * @example
 * ```ts
 * let fix: MotiveFixture
 * beforeEach(() => { fix = createMotiveFixture() })
 * afterEach(() => fix.cleanup())
 *
 * it('appends a decision', () => {
 *   const r = spawnSync('node', [JOURNAL_MJS, 'append',
 *     '--motive', fix.motiveSlug, '--type', 'DECISION',
 *     '--msg', 'test', '--data', '{"id":"D-1","decision":"Go"}'],
 *     { encoding: 'utf8', env: fix.env })
 *   expect(r.status).toBe(0)
 * })
 * ```
 */
export function createMotiveFixture(opts: MotiveFixtureOptions = {}): MotiveFixture {
  const slug = opts.slug ?? 'test-motive'
  const sessionId = opts.sessionId ?? 'fixture'
  const eventCount = opts.eventCount ?? 3
  const acLines = opts.acceptanceCriteria ?? ['- AC-1: placeholder acceptance criterion']

  // ── 1. Temp dir + required subdirectories ──────────────────────────────────
  const projectDir = mkdtempSync(path.join(tmpdir(), 'gw-motive-fixture-'))
  mkdirSync(path.join(projectDir, '.groundwork', 'journal'), { recursive: true })
  mkdirSync(path.join(projectDir, '.groundwork', 'motives', slug), { recursive: true })

  // ── 2. Charter (motive.md) ─────────────────────────────────────────────────
  const charter = [
    `# motive: ${slug}`,
    '',
    '## Objective',
    '',
    'Fixture motive created by createMotiveFixture() for isolated CLI testing.',
    '',
    '## Acceptance criteria',
    '',
    ...acLines,
    '',
    '## Open items',
    '',
    '## Notes',
    '',
  ].join('\n')

  writeFileSync(
    path.join(projectDir, '.groundwork', 'motives', slug, 'motive.md'),
    charter,
    'utf8',
  )

  // ── 3. Journal shard with pre-seeded events ────────────────────────────────
  // Named "fixture.jsonl" — the journal reader scans all *.jsonl files, so
  // the filename does not need to match the date-session pattern.
  const lines: string[] = []
  for (let i = 0; i < eventCount; i++) {
    lines.push(JSON.stringify({
      ts: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      session: sessionId,
      motive: slug,
      type: 'SESSION_START',
      msg: `fixture pre-seed event ${i}`,
    }))
  }
  writeFileSync(
    path.join(projectDir, '.groundwork', 'journal', 'fixture.jsonl'),
    lines.join('\n') + '\n',
    'utf8',
  )

  // ── 4. Minimal ledger ──────────────────────────────────────────────────────
  // session_id: null → resolveLedgerPath falls back to run.json (legacy path).
  // No write_token → complete / gate operations need no --token flag.
  const ledgerPath = path.join(projectDir, '.groundwork', 'run.json')
  writeFileSync(
    ledgerPath,
    JSON.stringify({
      version: 1,
      active: true,
      session_id: null,
      brief: `fixture ledger for motive "${slug}"`,
      reinforcements: 0,
      slices: [],
      gate: {},
    }, null, 2),
    'utf8',
  )

  // ── 5. Env vars ────────────────────────────────────────────────────────────
  const env: Record<string, string | undefined> = { ...process.env }
  env['CLAUDE_PROJECT_DIR'] = projectDir
  env['JOURNAL_SESSION_ID'] = sessionId
  // Deliberately absent: CLAUDE_CODE_SESSION_ID
  // Its presence would make ledger.mjs look for .groundwork/runs/<id>.json
  // instead of the legacy .groundwork/run.json written above.
  delete env['CLAUDE_CODE_SESSION_ID']

  return {
    projectDir,
    motiveSlug: slug,
    ledgerPath,
    env,
    cleanup() {
      rmSync(projectDir, { recursive: true, force: true })
    },
  }
}
