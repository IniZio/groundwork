/**
 * Vault-shape acceptance test for motive obsidian-native-groundwork.
 *
 * Invariant (D-24): under .groundwork/motives/<slug>/ nothing DERIVED may exist.
 * Derived = regenerated from a corpus; can silently disagree with it.
 *
 * ALLOWED (authoritative — IS the source, cannot drift):
 *   motive.md | tickets/** | evidence/** | journal/** | decisions/**
 *
 * BANNED (derived projections):
 *   MAP.md | open-items/** | TRACE.html | anything else
 *
 * IMPORTANT — D-13 vs D-24: The superseded D-13 rule banned journal/** and
 * decisions/**. D-24 corrects this: gw journal compile reads decisions/*.md
 * from the motive dir as authoritative source. Never treat those dirs as violations.
 *
 * AC-5: wikilinks in frontmatter (ANY key — `links:` arrays, `motive:`, etc.) are
 * dependency/navigation edges and MUST resolve to real notes.
 * Body-prose wikilinks (e.g. [[<req-id>]] used illustratively in design documents)
 * are NOT dependency edges and are deliberately not checked.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync,
  readFileSync, existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import matter from 'gray-matter'
import { TicketSchema } from '../../src/gw/schema/ticket.js'

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

/** @internal Required frontmatter keys for every decision note. */
const DECISION_REQUIRED_KEYS = ['id', 'status', 'date', 'rationale', 'motive'] as const

/**
 * Build the set of note stems (filename without .md) resolvable within one motive vault dir.
 * Covers tickets/, decisions/, evidence/, journal/, and motive.md at the vault root.
 */
function buildNoteStems(vaultDir: string): Set<string> {
  const stems = new Set<string>()
  if (existsSync(path.join(vaultDir, 'motive.md'))) stems.add('motive')
  for (const sub of ['tickets', 'decisions', 'evidence', 'journal']) {
    const dir = path.join(vaultDir, sub)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.md')) stems.add(f.slice(0, -3))
    }
  }
  return stems
}

interface DeadLink {
  /** Path relative to vault root, e.g. "tickets/20-chore-docs-gw-cutover.md" */
  file: string
  /** Wikilink target that does not resolve, e.g. "motives/obsidian-native-groundwork/motive" */
  target: string
}

interface WikilinkCheckResult {
  dead: DeadLink[]
  /**
   * Count of [[...]] wikilink entries actually examined — across ALL frontmatter keys
   * in tickets/*.md, decisions/*.md, and motive.md (when it has YAML frontmatter).
   * Body prose is excluded.
   */
  examined: number
}

/**
 * Collect all wikilink targets from a single frontmatter value (recursive).
 * Handles: string values, arrays of values, objects with string values.
 * Does NOT look at body prose — only parsed frontmatter data reaches this function.
 */
function collectWikilinksFromValue(v: unknown): string[] {
  const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
  if (typeof v === 'string') {
    const targets: string[] = []
    for (const m of v.matchAll(WIKILINK_RE)) targets.push(m[1])
    return targets
  }
  if (Array.isArray(v)) return v.flatMap(collectWikilinksFromValue)
  if (v !== null && typeof v === 'object') {
    return Object.values(v as Record<string, unknown>).flatMap(collectWikilinksFromValue)
  }
  return []
}

/**
 * Find dead wikilinks in ALL frontmatter keys across tickets/, decisions/,
 * and motive.md (when it has YAML frontmatter) in one vault dir.
 *
 * Scope: frontmatter only — body prose is deliberately excluded (illustrative, not edges).
 * Frontmatter wikilinks (in any key: `links:`, `motive:`, etc.) are navigation/dependency
 * edges that MUST resolve.
 *
 * Resolution rules (mirrors Obsidian behaviour):
 *   - BARE STEM (no `/`): resolves if exactly one note with that stem exists in the vault dir.
 *   - VAULT-ROOT-RELATIVE PATH (contains `/`): when `vaultRoot` is provided, resolves if
 *     `<vaultRoot>/<target>.md` exists on disk. Without `vaultRoot`, falls through to bare
 *     stem lookup (which will miss the path form — pass `vaultRoot` for full resolution).
 *
 * @param vaultDir   Absolute path to a single motive directory (tickets/, decisions/, motive.md).
 * @param vaultRoot  Absolute path to the Obsidian vault root (one level above `motives/`).
 *                   Pass for full path-qualified resolution; omit for stem-only (test fixtures).
 */
export function findDeadWikilinksInVault(vaultDir: string, vaultRoot?: string): WikilinkCheckResult {
  const dead: DeadLink[] = []
  let examined = 0
  const stems = buildNoteStems(vaultDir)

  const filesToCheck: Array<{ file: string; fullPath: string }> = []

  const ticketsDir = path.join(vaultDir, 'tickets')
  if (existsSync(ticketsDir)) {
    for (const f of readdirSync(ticketsDir)) {
      if (f.endsWith('.md')) {
        filesToCheck.push({ file: `tickets/${f}`, fullPath: path.join(ticketsDir, f) })
      }
    }
  }

  const decisionsDir = path.join(vaultDir, 'decisions')
  if (existsSync(decisionsDir)) {
    for (const f of readdirSync(decisionsDir)) {
      if (f.endsWith('.md')) {
        filesToCheck.push({ file: `decisions/${f}`, fullPath: path.join(decisionsDir, f) })
      }
    }
  }

  const motivePath = path.join(vaultDir, 'motive.md')
  if (existsSync(motivePath)) {
    filesToCheck.push({ file: 'motive.md', fullPath: motivePath })
  }

  for (const { file, fullPath } of filesToCheck) {
    const content = readFileSync(fullPath, 'utf8')
    const { data } = matter(content)
    for (const val of Object.values(data)) {
      for (const target of collectWikilinksFromValue(val)) {
        examined++
        let resolves = stems.has(target)
        if (!resolves && vaultRoot !== undefined && target.includes('/')) {
          resolves = existsSync(path.join(vaultRoot, target + '.md'))
        }
        if (!resolves) dead.push({ file, target })
      }
    }
  }

  return { dead, examined }
}

/**
 * Ground-truth wikilink count via RAW frontmatter text extraction — structurally
 * independent from the checker (no gray-matter, no YAML parsing, no per-element
 * anchored regex, no dependence on Array.isArray guards).
 *
 * Method: isolate the frontmatter block by its `---` delimiters and count literal
 * `[[` occurrences in that raw text block. Covers tickets/, decisions/, and motive.md.
 *
 * Independence: if the checker's YAML parser or regex misses a wikilink the raw count
 * will still include it, so `examined !== groundTruth` fires and catches the blind spot.
 */
function countWikilinksRaw(vaultDir: string): number {
  let count = 0
  const filesToCount: string[] = []

  const ticketsDir = path.join(vaultDir, 'tickets')
  if (existsSync(ticketsDir)) {
    for (const f of readdirSync(ticketsDir)) {
      if (f.endsWith('.md')) filesToCount.push(path.join(ticketsDir, f))
    }
  }

  const decisionsDir = path.join(vaultDir, 'decisions')
  if (existsSync(decisionsDir)) {
    for (const f of readdirSync(decisionsDir)) {
      if (f.endsWith('.md')) filesToCount.push(path.join(decisionsDir, f))
    }
  }

  const motivePath = path.join(vaultDir, 'motive.md')
  if (existsSync(motivePath)) filesToCount.push(motivePath)

  for (const fullPath of filesToCount) {
    const text = readFileSync(fullPath, 'utf8')
    // Isolate the frontmatter block between the first pair of --- delimiters.
    // No YAML parser involved — any [[ here is a wikilink, regardless of key.
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
    if (!fmMatch) continue
    const fmBlock = fmMatch[1]
    let i = 0
    while ((i = fmBlock.indexOf('[[', i)) !== -1) {
      count++
      i += 2
    }
  }

  return count
}

/**
 * Walk all motive directories under `motiveRootDir` and accumulate dead wikilinks
 * from each vault's frontmatter (all keys, tickets + decisions + motive.md).
 */
function findDeadWikilinks(motiveRootDir: string): WikilinkCheckResult {
  const allDead: DeadLink[] = []
  let totalExamined = 0
  let slugs: string[]
  try { slugs = readdirSync(motiveRootDir) } catch { return { dead: [], examined: 0 } }
  const vaultRoot = path.join(motiveRootDir, '..')
  for (const slug of slugs) {
    const vaultDir = path.join(motiveRootDir, slug)
    if (!statSync(vaultDir).isDirectory()) continue
    const { dead, examined } = findDeadWikilinksInVault(vaultDir, vaultRoot)
    for (const d of dead) allDead.push({ file: `${slug}/${d.file}`, target: d.target })
    totalExamined += examined
  }
  return { dead: allDead, examined: totalExamined }
}

/**
 * Count all wikilinks across all motive vaults using the structurally-independent
 * raw-text method (ground truth for the coverage assertion).
 */
function countAllWikilinks(motiveRootDir: string): number {
  let total = 0
  let slugs: string[]
  try { slugs = readdirSync(motiveRootDir) } catch { return 0 }
  for (const slug of slugs) {
    const vaultDir = path.join(motiveRootDir, slug)
    if (!statSync(vaultDir).isDirectory()) continue
    total += countWikilinksRaw(vaultDir)
  }
  return total
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

  it('CLI vault: journal append does NOT introduce derived projections (D-24 enforced)', () => {
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

  // ── Live vault ───────────────────────────────────────────────────────────────

  it('live vault: conforms to D-24 (no derived projections present)', () => {
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

describe('vault frontmatter conformance', () => {
  it('positive control: ticket with invalid type IS detected by TicketSchema', () => {
    const raw = `---\nid: probe\ntitle: Probe\ntype: not-a-valid-ticket-type\nstatus: open\n---\n# Probe\n`
    const { data } = matter(raw)
    const result = TicketSchema.safeParse(data)
    expect(result.success, 'TicketSchema must reject an invalid type value').toBe(false)
  })

  it('every ticket in live vault validates against TicketSchema', () => {
    const failures: string[] = []
    for (const slug of readdirSync(LIVE_MOTIVE_ROOT)) {
      const ticketsDir = path.join(LIVE_MOTIVE_ROOT, slug, 'tickets')
      if (!existsSync(ticketsDir)) continue
      for (const f of readdirSync(ticketsDir)) {
        if (!f.endsWith('.md')) continue
        const content = readFileSync(path.join(ticketsDir, f), 'utf8')
        const { data } = matter(content)
        const result = TicketSchema.safeParse(data)
        if (!result.success) {
          failures.push(`${slug}/tickets/${f}: ${result.error.issues.map(i => i.message).join('; ')}`)
        }
      }
    }
    expect(failures, `Tickets failing TicketSchema:\n${failures.join('\n')}`).toEqual([])
  })

  it('positive control: decision note missing required key id IS detected', () => {
    const raw = `---\nstatus: proposed\ndate: '2026-01-01'\nrationale: test\nmotive: '[[test]]'\n---\n# Test\n`
    const { data } = matter(raw)
    const missing = DECISION_REQUIRED_KEYS.filter(k => data[k] === undefined)
    expect(missing, 'Decision missing id must be detected').toContain('id')
  })

  it('every decision note in live vault has required keys (id, status, date, rationale, motive)', () => {
    const failures: string[] = []
    for (const slug of readdirSync(LIVE_MOTIVE_ROOT)) {
      const decisionsDir = path.join(LIVE_MOTIVE_ROOT, slug, 'decisions')
      if (!existsSync(decisionsDir)) continue
      for (const f of readdirSync(decisionsDir)) {
        if (!f.endsWith('.md')) continue
        const content = readFileSync(path.join(decisionsDir, f), 'utf8')
        const { data } = matter(content)
        const missing = DECISION_REQUIRED_KEYS.filter(k => data[k] === undefined)
        if (missing.length > 0) failures.push(`${slug}/decisions/${f}: missing ${missing.join(', ')}`)
      }
    }
    expect(failures, `Decision notes missing required keys:\n${failures.join('\n')}`).toEqual([])
  })
})

describe('wikilink resolution — all frontmatter keys, tickets/decisions/motive.md (AC-5)', () => {
  it('positive control: dead link in tickets links: array IS detected', () => {
    const tmpVault = mkdtempSync(path.join(tmpdir(), 'vault-links-'))
    try {
      mkdirSync(path.join(tmpVault, 'tickets'), { recursive: true })
      writeFileSync(path.join(tmpVault, 'tickets', 'probe-ticket.md'), [
        '---',
        'id: probe-ticket',
        'title: Probe Ticket',
        'type: chore',
        'status: open',
        'links:',
        '  - "[[nonexistent-note-xyz]]"',
        '---',
        '# Probe Ticket',
        '',
      ].join('\n'))
      const { dead } = findDeadWikilinksInVault(tmpVault)
      expect(dead.length, 'Dead link in links: array must be detected').toBe(1)
      expect(dead[0].target).toBe('nonexistent-note-xyz')
    } finally {
      rmSync(tmpVault, { recursive: true, force: true })
    }
  })

  it('positive control: dead wikilink in decisions motive: key IS detected', () => {
    const tmpVault = mkdtempSync(path.join(tmpdir(), 'vault-decision-dead-'))
    try {
      mkdirSync(path.join(tmpVault, 'decisions'), { recursive: true })
      writeFileSync(path.join(tmpVault, 'decisions', 'D1.md'), [
        '---',
        'id: D1',
        'status: proposed',
        "date: '2026-01-01'",
        'rationale: test',
        "motive: '[[nonexistent-motive-xyz]]'",
        '---',
        '',
      ].join('\n'))
      const { dead, examined } = findDeadWikilinksInVault(tmpVault)
      expect(examined, 'motive: wikilink must be examined').toBe(1)
      expect(dead.length, 'Dead motive: wikilink must be detected').toBe(1)
      expect(dead[0].target).toBe('nonexistent-motive-xyz')
      expect(dead[0].file).toBe('decisions/D1.md')
    } finally {
      rmSync(tmpVault, { recursive: true, force: true })
    }
  })

  it('positive control: dead wikilink in motive.md YAML frontmatter IS detected', () => {
    const tmpVault = mkdtempSync(path.join(tmpdir(), 'vault-motive-dead-'))
    try {
      // motive.md with YAML frontmatter containing a wikilink
      writeFileSync(path.join(tmpVault, 'motive.md'), [
        '---',
        'id: my-motive',
        "depends_on: '[[nonexistent-dep-xyz]]'",
        '---',
        '# My Motive',
        '',
        'Body prose [[example-ref]] is not checked.',
        '',
      ].join('\n'))
      const { dead, examined } = findDeadWikilinksInVault(tmpVault)
      expect(examined, 'motive.md frontmatter wikilink must be examined').toBe(1)
      expect(dead.length, 'Dead motive.md frontmatter wikilink must be detected').toBe(1)
      expect(dead[0].target).toBe('nonexistent-dep-xyz')
      expect(dead[0].file).toBe('motive.md')
    } finally {
      rmSync(tmpVault, { recursive: true, force: true })
    }
  })

  it('frontmatter wikilinks in decisions ARE checked; body-prose wikilinks are NOT checked', () => {
    const tmpVault = mkdtempSync(path.join(tmpdir(), 'vault-prose-'))
    try {
      mkdirSync(path.join(tmpVault, 'tickets'), { recursive: true })
      mkdirSync(path.join(tmpVault, 'decisions'), { recursive: true })
      // `probe` must be a resolvable stem so the frontmatter motive: wikilink does not show as dead
      writeFileSync(path.join(tmpVault, 'tickets', 'probe.md'), [
        '---', 'id: probe', 'title: Probe', 'type: chore', 'status: open', '---', '',
      ].join('\n'))
      writeFileSync(path.join(tmpVault, 'decisions', 'D1.md'), [
        '---',
        'id: D1',
        'status: proposed',
        "date: '2026-01-01'",
        'rationale: test',
        "motive: '[[probe]]'",    // frontmatter wikilink — MUST be examined, resolves to probe.md
        '---',
        '# D1',
        '',
        'Body prose may contain [[illustrative-ref]] wikilinks that are examples, not edges.',
        '',
      ].join('\n'))
      const { dead, examined } = findDeadWikilinksInVault(tmpVault)
      // motive: '[[probe]]' is examined and resolves → no dead links
      expect(dead, 'Illustrative body-prose wikilinks must not be flagged').toEqual([])
      // frontmatter wikilink in decisions IS examined (at minimum 1 — the motive: key)
      expect(examined, 'Frontmatter wikilink in decisions motive: key must be examined').toBeGreaterThan(0)
    } finally {
      rmSync(tmpVault, { recursive: true, force: true })
    }
  })

  it('positive control: dead link at 2nd position in multi-entry array IS detected (blind-spot probe)', () => {
    const tmpVault = mkdtempSync(path.join(tmpdir(), 'vault-blind-'))
    try {
      mkdirSync(path.join(tmpVault, 'tickets'), { recursive: true })
      writeFileSync(path.join(tmpVault, 'tickets', 'real-note.md'), [
        '---', 'id: real-note', 'title: Real', 'type: chore', 'status: open', '---', '',
      ].join('\n'))
      writeFileSync(path.join(tmpVault, 'tickets', 'probe-multi.md'), [
        '---',
        'id: probe-multi',
        'title: Multi-entry probe',
        'type: chore',
        'status: open',
        'links:',
        '  - "[[real-note]]"',
        '  - "[[dead-at-second-position]]"',
        '---', '',
      ].join('\n'))
      const { dead, examined } = findDeadWikilinksInVault(tmpVault)
      expect(examined, 'Checker must examine both entries').toBe(2)
      expect(dead.length, 'Dead link at position 2 must be detected').toBe(1)
      expect(dead[0].target).toBe('dead-at-second-position')
    } finally {
      rmSync(tmpVault, { recursive: true, force: true })
    }
  })

  it('positive control: unresolvable vault-root-relative path IS detected; resolvable one is NOT', () => {
    const tmpVaultRoot = mkdtempSync(path.join(tmpdir(), 'vault-pathres-'))
    try {
      const realMotive = path.join(tmpVaultRoot, 'motives', 'real-motive')
      mkdirSync(path.join(realMotive, 'decisions'), { recursive: true })
      writeFileSync(path.join(realMotive, 'motive.md'), '---\nid: real-motive\n---\n')
      writeFileSync(path.join(realMotive, 'decisions', 'D-live.md'), [
        '---', 'id: D-live', 'status: proposed', "date: '2026-01-01'", 'rationale: r',
        "motive: '[[motives/real-motive/motive]]'",
        '---', '',
      ].join('\n'))
      writeFileSync(path.join(realMotive, 'decisions', 'D-dead.md'), [
        '---', 'id: D-dead', 'status: proposed', "date: '2026-01-01'", 'rationale: r',
        "motive: '[[motives/no-such-motive/motive]]'",
        '---', '',
      ].join('\n'))
      const { dead, examined } = findDeadWikilinksInVault(realMotive, tmpVaultRoot)
      expect(examined, 'Both path-qualified wikilinks must be examined').toBe(2)
      expect(dead.length, 'Only the non-existent path must be flagged').toBe(1)
      expect(dead[0].target).toBe('motives/no-such-motive/motive')
    } finally {
      rmSync(tmpVaultRoot, { recursive: true, force: true })
    }
  })

  it('non-vacuity proof: raw ground-truth catches a blind spot the old shared-logic truth would miss', () => {
    // This test proves the coverage invariant is genuinely independent:
    // a perturbed checker that shares the OLD ground-truth logic passes silently,
    // while the NEW raw ground-truth exposes the blind spot.
    const tmpVault = mkdtempSync(path.join(tmpdir(), 'vault-vacuity-'))
    try {
      mkdirSync(path.join(tmpVault, 'tickets'), { recursive: true })
      mkdirSync(path.join(tmpVault, 'decisions'), { recursive: true })

      // probe-a has 2 wikilinks in its links: array
      writeFileSync(path.join(tmpVault, 'tickets', 'probe-a.md'), [
        '---',
        'id: probe-a',
        'title: Probe A',
        'type: chore',
        'status: open',
        'links:',
        '  - "[[probe-b]]"',
        '  - "[[probe-c]]"',
        '---', '',
      ].join('\n'))
      writeFileSync(path.join(tmpVault, 'tickets', 'probe-b.md'), [
        '---', 'id: probe-b', 'title: Probe B', 'type: chore', 'status: open', '---', '',
      ].join('\n'))
      writeFileSync(path.join(tmpVault, 'tickets', 'probe-c.md'), [
        '---', 'id: probe-c', 'title: Probe C', 'type: chore', 'status: open', '---', '',
      ].join('\n'))
      // D1 has 1 wikilink in its motive: key (in decisions/)
      writeFileSync(path.join(tmpVault, 'decisions', 'D1.md'), [
        '---',
        'id: D1',
        'status: proposed',
        "date: '2026-01-01'",
        'rationale: test',
        "motive: '[[probe-d]]'",
        '---', '',
      ].join('\n'))
      writeFileSync(path.join(tmpVault, 'tickets', 'probe-d.md'), [
        '---', 'id: probe-d', 'title: Probe D', 'type: chore', 'status: open', '---', '',
      ].join('\n'))

      // Ground truth: raw [[ count in frontmatter across tickets + decisions
      // probe-a.md fm: 2, D1.md fm: 1 → total 3
      const groundTruth = countWikilinksRaw(tmpVault)
      expect(groundTruth, 'Ground truth must count all 3 wikilinks').toBe(3)

      // ── PERTURBED CHECKER: skips the last element of every links: array ──────
      // Simulates a parsing blind spot (e.g. off-by-one, slice logic error).
      // Also only looks at tickets/ — misses decisions/ entirely.
      // This is the class of bug the OLD shared-logic ground truth was BLIND to.
      function perturbedExaminedCount(vaultDir: string): number {
        let n = 0
        const tDir = path.join(vaultDir, 'tickets')
        if (!existsSync(tDir)) return 0
        for (const f of readdirSync(tDir)) {
          if (!f.endsWith('.md')) continue
          const { data } = matter(readFileSync(path.join(tDir, f), 'utf8'))
          const links: unknown[] = Array.isArray(data.links) ? data.links : []
          // BUG: loop stops before the last element
          for (let i = 0; i < links.length - 1; i++) {
            const link = links[i]
            if (typeof link === 'string' && /^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.test(link)) n++
          }
        }
        return n
      }

      // ── OLD SHARED-LOGIC GROUND TRUTH (mirrors the perturbed bug) ────────────
      // This was countWikilinksInVault: same matter()/anchored-regex/tickets-only logic.
      // Under the OLD design a perturbed checker with THIS blind spot would produce
      // the same count as the "ground truth" → invariant PASSES vacuously.
      function oldSharedLogicGroundTruth(vaultDir: string): number {
        const tDir = path.join(vaultDir, 'tickets')
        if (!existsSync(tDir)) return 0
        let n = 0
        for (const f of readdirSync(tDir)) {
          if (!f.endsWith('.md')) continue
          const { data } = matter(readFileSync(path.join(tDir, f), 'utf8'))
          const links: unknown[] = Array.isArray(data.links) ? data.links : []
          // Same BUG: skip last element, tickets-only
          for (let i = 0; i < links.length - 1; i++) {
            const link = links[i]
            if (typeof link === 'string' && /^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.test(link)) n++
          }
        }
        return n
      }

      const perturbedExamined = perturbedExaminedCount(tmpVault)
      const oldGT = oldSharedLogicGroundTruth(tmpVault)

      // Key proof — the blind spot is shared:
      // OLD design: perturbed (1) === oldGT (1) → invariant would PASS (vacuous)
      expect(oldGT).toBe(perturbedExamined)
      // NEW design: perturbed (1) !== groundTruth (3) → invariant would FAIL (non-vacuous)
      expect(perturbedExamined).toBeLessThan(groundTruth)

      // Real checker is correct: examined === groundTruth (new invariant passes)
      const { examined, dead } = findDeadWikilinksInVault(tmpVault)
      expect(examined, 'Real checker must examine all 3 ground-truth wikilinks').toBe(groundTruth)
      expect(dead, 'All probes are resolvable in fixture — no dead links expected').toEqual([])
    } finally {
      rmSync(tmpVault, { recursive: true, force: true })
    }
  })

  it('coverage invariant: checker examines every [[...]] wikilink in all frontmatter (raw ground-truth)', () => {
    // groundTruth: raw [[ count across tickets + decisions + motive.md frontmatter
    // If the checker's YAML parsing has a blind spot, examined < groundTruth and this fails.
    const groundTruth = countAllWikilinks(LIVE_MOTIVE_ROOT)
    const { dead, examined } = findDeadWikilinks(LIVE_MOTIVE_ROOT)

    const byFile = new Map<string, string[]>()
    for (const d of dead) {
      if (!byFile.has(d.file)) byFile.set(d.file, [])
      byFile.get(d.file)!.push(`[[${d.target}]]`)
    }
    const deadSummary = [...byFile.entries()]
      .map(([f, ts]) => `  ${f} → ${ts.join(', ')}`)
      .join('\n')

    const ticketDead = dead.filter(d => d.file.includes('/tickets/')).length
    const decisionDead = dead.filter(d => d.file.includes('/decisions/')).length
    const motiveDead = dead.filter(d => d.file.endsWith('motive.md')).length

    const tallyMsg =
      `Examined: ${examined} (of ${groundTruth} ground-truth)\n` +
      `Dead: ${dead.length} total — tickets: ${ticketDead}, decisions: ${decisionDead}, motive.md: ${motiveDead}\n` +
      (dead.length > 0 ? `Dead links:\n${deadSummary}\n` : '') +
      `NOTE: dead decision links are expected-and-transient while sibling slice S22-MOTIVELINK-REPAIR runs.`

    expect(
      examined,
      `Under-scanning: checker examined ${examined} of ${groundTruth} raw ground-truth [[entries — ` +
      `a dead link among the ${groundTruth - examined} unexamined entries would pass silently`,
    ).toBe(groundTruth)

    expect(
      dead,
      `Dead dependency edges (${dead.length} of ${examined} examined):\n${tallyMsg}`,
    ).toEqual([])
  })
})
