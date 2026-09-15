/**
 * Vault-shape acceptance test — wave 0 RED tracer for motive obsidian-native-groundwork.
 *
 * Invariant (D-24): under .groundwork/motives/<slug>/ nothing DERIVED may exist.
 * Derived = regenerated from a corpus; can silently disagree with it.
 *
 * ALLOWED (authoritative — IS the source, cannot drift):
 *   motive.md | tickets/** | evidence/** | journal/** | decisions/**
 *
 * BANNED (derived projections, must be removed by implementation slices):
 *   MAP.md | open-items/** | TRACE.html | anything else
 *
 * IMPORTANT — D-13 vs D-24: The superseded D-13 rule banned journal/** and
 * decisions/**. D-24 corrects this: gw journal compile reads decisions/*.md
 * from the motive dir as authoritative source. Never treat those dirs as violations.
 *
 * RED at HEAD: `journal append` regenerates MAP.md, open-items/, and TRACE.html.
 * Removed by obsidian-native-groundwork implementation slices.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const JOURNAL_MJS = path.join(ROOT, 'hooks', 'journal.mjs')
const LEDGER_MJS = path.join(ROOT, 'hooks', 'ledger.mjs')
const FIXTURE_ROOT = path.join(ROOT, 'test', 'fixtures', 'vault-shape', 'motives')
const LIVE_MOTIVE_ROOT = path.join(ROOT, '.groundwork', 'motives')

/**
 * Walk all motive slug directories under `motiveRootDir` and return every path
 * that violates the D-24 vault-shape invariant.
 *
 * Allowed per D-24 (authoritative sources that ARE the corpus):
 *   `motive.md`, `tickets/**`, `evidence/**`, `journal/**`, `decisions/**`
 *
 * @param motiveRootDir  Absolute path whose immediate children are motive slugs.
 * @returns Sorted list of non-conforming paths relative to `motiveRootDir`.
 */
export function findNonConformingVaultPaths(motiveRootDir: string): string[] {
  const offending: string[] = []

  let slugs: string[]
  try {
    slugs = readdirSync(motiveRootDir)
  } catch {
    return []
  }

  for (const slug of slugs) {
    const motiveDir = path.join(motiveRootDir, slug)
    if (!statSync(motiveDir).isDirectory()) continue

    const walk = (dir: string, relFromMotive: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry)
        const rel = relFromMotive ? `${relFromMotive}/${entry}` : entry
        const isDir = statSync(full).isDirectory()

        const conforming =
          rel === 'motive.md' ||
          rel === 'tickets' || rel.startsWith('tickets/') ||
          rel === 'evidence' || rel.startsWith('evidence/') ||
          rel === 'journal' || rel.startsWith('journal/') ||
          rel === 'decisions' || rel.startsWith('decisions/')

        if (!conforming) offending.push(`${slug}/${rel}`)
        if (isDir) walk(full, rel)
      }
    }

    walk(motiveDir, '')
  }

  return offending.sort()
}

describe('vault-shape invariant (D-24)', () => {
  it('positive control: conforming fixture (motive.md + tickets + evidence + journal + decisions) returns no violations', () => {
    const violations = findNonConformingVaultPaths(FIXTURE_ROOT).filter(p =>
      p.startsWith('conforming-motive/')
    )
    expect(
      violations,
      `conforming-motive should have zero violations but found: ${JSON.stringify(violations)}`,
    ).toEqual([])
  })

  it('positive control: journal/ and decisions/ in conforming fixture are NOT violations (D-24 authoritative dirs)', () => {
    const violations = findNonConformingVaultPaths(FIXTURE_ROOT).filter(
      p => p.startsWith('conforming-motive/') && (p.includes('/journal') || p.includes('/decisions'))
    )
    expect(
      violations,
      `journal/ and decisions/ must be allowed per D-24 but were flagged: ${JSON.stringify(violations)}`,
    ).toEqual([])
  })

  it('negative control: MAP.md in banned-motive fixture IS a violation (checker can see PRESENT)', () => {
    const violations = findNonConformingVaultPaths(FIXTURE_ROOT).filter(p =>
      p.startsWith('banned-motive/')
    )
    expect(violations).toContain('banned-motive/MAP.md')
  })

  // ── CLI-populated vault ──────────────────────────────────────────────────────

  let tmpDir: string
  let env: NodeJS.ProcessEnv

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'vault-shape-'))
    mkdirSync(path.join(tmpDir, '.groundwork', 'motives'), { recursive: true })
    mkdirSync(path.join(tmpDir, '.groundwork', 'journal'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, '.groundwork', 'run.json'),
      JSON.stringify({
        version: 1, active: true, session_id: null, brief: 'vault-shape test',
        reinforcements: 0, slices: [], gate: {},
      }, null, 2),
    )
    env = { ...process.env, CLAUDE_PROJECT_DIR: tmpDir, JOURNAL_SESSION_ID: 'vault-shape-test' }
    delete (env as Record<string, string | undefined>)['CLAUDE_CODE_SESSION_ID']
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('CLI vault: journal motive new alone writes only motive.md (no derived files)', () => {
    const r = spawnSync('node', [JOURNAL_MJS, 'motive', 'new', 'probe',
      '--objective', 'vault shape probe'], { encoding: 'utf8', env })
    expect(r.status, `journal motive new failed: ${r.stderr}`).toBe(0)

    const violations = findNonConformingVaultPaths(path.join(tmpDir, '.groundwork', 'motives'))
    expect(
      violations,
      `journal motive new must write only motive.md; introduced: ${JSON.stringify(violations)}`,
    ).toEqual([])
  })

  it('CLI vault: journal append introduces derived projections — RED at HEAD (D-24 not yet enforced)', () => {
    const r1 = spawnSync('node', [JOURNAL_MJS, 'motive', 'new', 'probe',
      '--objective', 'vault shape probe'], { encoding: 'utf8', env })
    expect(r1.status, `journal motive new failed: ${r1.stderr}`).toBe(0)

    const r2 = spawnSync('node', [JOURNAL_MJS, 'append',
      '--motive', 'probe', '--type', 'SESSION_START', '--msg', 'vault shape probe'],
      { encoding: 'utf8', env })
    expect(r2.status, `journal append failed: ${r2.stderr}`).toBe(0)

    const r3 = spawnSync('node', [LEDGER_MJS, 'add', 'S1', '--desc', 'probe slice'],
      { encoding: 'utf8', env })
    expect(r3.status, `ledger add failed: ${r3.stderr}`).toBe(0)

    const r4 = spawnSync('node', [LEDGER_MJS, 'set', 'S1', '--status', 'in_progress'],
      { encoding: 'utf8', env })
    expect(r4.status, `ledger set failed: ${r4.stderr}`).toBe(0)

    const violations = findNonConformingVaultPaths(path.join(tmpDir, '.groundwork', 'motives'))
    const preview = violations.join('\n  ')
    const summary =
      `Found ${violations.length} non-conforming path(s) after journal append + ledger mutations.\n` +
      `Offending paths:\n  ${preview}\n` +
      `D-24: MAP.md, open-items/, TRACE.html are derived projections and must not exist.`

    expect(violations, summary).toEqual([])
  })

  it('deployed path (bin/gw-hook): journal append writes only to allowed journal/ dir (not MAP.md or other banned artifacts)', () => {
    const gwHook = path.join(ROOT, 'bin', 'gw-hook')
    const deployedEnv = { ...env, CLAUDE_CODE_SESSION_ID: 'vault-shape-deployed-test' }

    const r = spawnSync(gwHook, [
      'journal', 'append',
      '--motive', 'probe',
      '--type', 'BASELINE',
      '--msg', 'vault shape deployed-path probe',
    ], { encoding: 'utf8', env: deployedEnv })
    expect(r.status, `bin/gw-hook journal append failed: ${r.stderr}`).toBe(0)

    const violations = findNonConformingVaultPaths(path.join(tmpDir, '.groundwork', 'motives'))
    expect(
      violations,
      `bin/gw-hook journal append must write only to journal/; introduced: ${JSON.stringify(violations)}`,
    ).toEqual([])
  })

  // ── Live vault RED tracer ────────────────────────────────────────────────────

  it('live vault: contains non-conforming paths (RED until implementation slices remove generators)', () => {
    const violations = findNonConformingVaultPaths(LIVE_MOTIVE_ROOT)
    const preview = violations.slice(0, 10).join('\n  ')
    const rest = violations.length > 10 ? `\n  … and ${violations.length - 10} more` : ''
    const summary =
      `Found ${violations.length} non-conforming path(s) under .groundwork/motives/.\n` +
      `First up to 10:\n  ${preview}${rest}\n` +
      `Remove MAP.md, open-items/**, TRACE.html from the journal append pipeline (D-24).`

    expect(violations, summary).toEqual([])
  })
})
