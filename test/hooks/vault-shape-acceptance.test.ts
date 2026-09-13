/**
 * Wave-1 tracer: vault-shape acceptance test.
 *
 * Invariant (D-13): nothing MACHINE-REGENERATED under `.groundwork/motives/**`.
 * Deviation risk comes from regeneration — a hand-authored file cannot deviate
 * from itself, so the rule is not "nothing but two names" but "nothing generated".
 *
 * Allowed under each motive slug:
 *   - `motive.md`        — hand-authored charter
 *   - `tickets/**`       — created-if-absent, never rewritten
 *   - `evidence/**`      — hand-authored artefacts (D-13)
 *
 * Non-conforming: `MAP.md`, `open-items/**`, `TRACE.html`, `journal/**`,
 * and anything else not in the above set.
 *
 * RED case: fails against the live vault at HEAD because MAP.md, open-items/,
 * and TRACE.html are still present. Removed by slices T7 and T11 in Wave 3.
 *
 * GREEN cases: (a) conforming fixture → zero violations; (b) evidence/ fixture
 * → zero violations (proves evidence/ is accepted); (c) journal/ fixture →
 * exactly that path (proves the checker can still see a banned entry after the
 * allowlist was widened — guards against silently-accept-all regression).
 *
 * Covers: AC-3, D-3, D-11, D-13.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')

/**
 * Walk all motive directories under `motiveRootDir` and return every relative
 * path that violates the vault-shape invariant (D-13): nothing machine-generated.
 *
 * Allowed under a motive slug: `motive.md`, `tickets/` and its contents,
 * `evidence/` and its contents. Everything else is non-conforming.
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
          rel === 'tickets' ||
          rel.startsWith('tickets/') ||
          rel === 'evidence' ||
          rel.startsWith('evidence/')

        if (!conforming) {
          offending.push(`${slug}/${rel}`)
        }

        if (isDir) walk(full, rel)
      }
    }

    walk(motiveDir, '')
  }

  return offending.sort()
}

const LIVE_MOTIVE_ROOT = path.join(ROOT, '.groundwork', 'motives')
const FIXTURE_ROOT = path.join(ROOT, 'test', 'fixtures', 'vault-shape', 'motives')

describe('vault-shape invariant', () => {
  it('positive control: conforming fixture (motive.md + tickets/) returns no violations', () => {
    const violations = findNonConformingVaultPaths(FIXTURE_ROOT).filter(p =>
      p.startsWith('demo-motive/'),
    )
    expect(
      violations,
      `demo-motive fixture must be violation-free but found: ${violations.join(', ')}`,
    ).toEqual([])
  })

  it('positive control: evidence/ fixture returns no violations (D-13 allowance)', () => {
    const violations = findNonConformingVaultPaths(FIXTURE_ROOT).filter(p =>
      p.startsWith('evidence-motive/'),
    )
    expect(
      violations,
      `evidence-motive fixture must be violation-free but found: ${violations.join(', ')}`,
    ).toEqual([])
  })

  it('negative control: journal/ fixture reports exactly that entry (allowlist not vacuous)', () => {
    const violations = findNonConformingVaultPaths(FIXTURE_ROOT).filter(p =>
      p.startsWith('journal-motive/'),
    )
    expect(violations).toEqual([
      'journal-motive/journal',
      'journal-motive/journal/2026-01-01.jsonl',
    ])
  })

  it('wave-1 tracer: live vault contains non-conforming paths (RED until Wave 3)', () => {
    const violations = findNonConformingVaultPaths(LIVE_MOTIVE_ROOT)

    const preview = violations.slice(0, 10).join('\n  ')
    const summary =
      `Found ${violations.length} non-conforming path(s) under .groundwork/motives/.\n` +
      `First up to 10:\n  ${preview}\n` +
      `(Removed by slices T7 and T11 in Wave 3.)`

    expect(violations, summary).toEqual([])
  })
})
