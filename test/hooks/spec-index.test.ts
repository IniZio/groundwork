/**
 * spec-index tests — S3 acceptance criteria for the ## Concepts section in index.md.
 *
 * These tests run against the real doc/specs/ tree (not a temp-dir fixture), because the
 * acceptance criteria reference the concept directories that actually exist in this repo.
 *
 * S3-AC1 — index.md contains a ## Concepts table listing all 7 concept IDs
 * S3-AC2 — Concepts table has all 7 rows; D-15 layout (spec.yaml removed) shows fallback values
 * S3-AC3 — doc/specs/INDEX.md does NOT exist after build
 * S3-AC4 — coverage.json is byte-identical across two consecutive builds; no generated_at field
 * S3-AC5 — isIndexStale returns false immediately after a fresh build
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'

// Pull helper functions from spec-io so paths are derived the same way the CLI does.
const SPEC_IO_PATH = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'lib', 'spec-io.mjs')
const { isIndexStale, specDirPath, generatedDirPath } = await import(pathToFileURL(SPEC_IO_PATH).href)

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..')
const CLI = path.join(PROJECT_ROOT, 'hooks', 'spec.mjs')
const SPEC_DIR: string = specDirPath(PROJECT_ROOT)
const GEN_DIR: string = generatedDirPath(SPEC_DIR)

/** Run `node hooks/spec.mjs build` against the real project. */
function runBuild(): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_ROOT }
  delete (env as Record<string, string | undefined>).CLAUDE_CODE_SESSION_ID
  const result = spawnSync('node', [CLI, 'build'], { env, encoding: 'utf8' })
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

/**
 * Extract the text of the ## Concepts section from index.md.
 * Returns everything between the end of the "## Concepts" line and the next
 * top-level "## " heading line (or EOF). Uses plain string search — no regex —
 * to avoid multiline-flag gotchas.
 */
function extractConceptsSection(md: string): string {
  const HEADING = '## Concepts'
  const headingIdx = md.indexOf(HEADING)
  if (headingIdx === -1) return ''
  // Move past the heading line itself
  const afterHeadingLine = md.indexOf('\n', headingIdx) + 1
  // Find the next top-level heading
  const nextHeadingIdx = md.indexOf('\n## ', afterHeadingLine)
  return nextHeadingIdx === -1
    ? md.slice(afterHeadingLine)
    : md.slice(afterHeadingLine, nextHeadingIdx)
}

// ---------------------------------------------------------------------------
// S3-AC1 — ## Concepts table present; all 7 concept IDs appear
// ---------------------------------------------------------------------------

describe('S3-AC1 — index.md Concepts section lists all 7 concept IDs', () => {
  it('S3-AC1: build succeeds and index.md contains a ## Concepts table with all 7 concept IDs', { timeout: 30_000 }, () => {
    const r = runBuild()
    expect(r.code, `build failed\nstdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0)

    const indexMd = path.join(GEN_DIR, 'index.md')
    expect(existsSync(indexMd), `${indexMd} not found after build`).toBe(true)

    const md = readFileSync(indexMd, 'utf8')
    const section = extractConceptsSection(md)

    expect(section, 'index.md must contain a ## Concepts section').not.toBe('')

    // Table header
    expect(section).toContain('| Concept |')
    expect(section).toContain('| Summary |')
    expect(section).toContain('| Status |')
    expect(section).toContain('| Views |')

    // All 7 concept IDs must appear in the Concepts section table (D-15 layout: 7 concept dirs)
    const EXPECTED_CONCEPT_IDS = [
      'C-ARTIFACT', 'C-ENFORCEMENT', 'C-MOTIVE-DAG', 'C-ORCHESTRATION',
      'C-VERIFICATION', 'C-TRACEABILITY', 'C-TOKEN-ECONOMY',
    ]
    for (const id of EXPECTED_CONCEPT_IDS) {
      expect(section, `Concepts section must contain concept ID "${id}"`).toContain(id)
    }
  })
})

// ---------------------------------------------------------------------------
// S3-AC2 — Concepts table has 7 rows; D-15 layout (spec.yaml removed, fallback active)
// ---------------------------------------------------------------------------

describe('S3-AC2 — Concepts table has all 7 rows; D-15 layout shows fallback values (no spec.yaml)', () => {
  // D-15: Concepts table must source summary/status/views from index.md frontmatter —
  // tracked as ledger slice S4-SPEC-CONSUMERS
  it.todo('S3-AC2: all 7 concepts appear as table rows; spec.yaml absent so *(no manifest)* marker and fallback status/views expected — D-15: Concepts table must source summary/status/views from index.md frontmatter — tracked as ledger slice S4-SPEC-CONSUMERS')
})

// ---------------------------------------------------------------------------
// S3-AC3 — doc/specs/INDEX.md does NOT exist
// ---------------------------------------------------------------------------

describe('S3-AC3 — doc/specs/INDEX.md does not exist after build', () => {
  it('S3-AC3: doc/specs/INDEX.md is absent after spec build', { timeout: 30_000 }, () => {
    const r = runBuild()
    expect(r.code, `build failed\nstdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0)

    const legacyIndex = path.join(SPEC_DIR, 'INDEX.md')
    expect(
      existsSync(legacyIndex),
      `doc/specs/INDEX.md must NOT exist after build (path: ${legacyIndex})`,
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// S3-AC4 — coverage.json is byte-identical across two builds; no generated_at
// ---------------------------------------------------------------------------

describe('S3-AC4 — coverage.json is stable across consecutive builds', () => {
  it('S3-AC4: two consecutive builds produce byte-identical coverage.json with no generated_at field', { timeout: 60_000 }, () => {
    const coveragePath = path.join(GEN_DIR, 'coverage.json')

    const r1 = runBuild()
    expect(r1.code, `first build failed\nstdout: ${r1.stdout}\nstderr: ${r1.stderr}`).toBe(0)
    expect(existsSync(coveragePath), 'coverage.json must exist after first build').toBe(true)
    const first = readFileSync(coveragePath, 'utf8')

    const r2 = runBuild()
    expect(r2.code, `second build failed\nstdout: ${r2.stdout}\nstderr: ${r2.stderr}`).toBe(0)
    const second = readFileSync(coveragePath, 'utf8')

    // Must be byte-identical (deterministic output)
    expect(second, 'coverage.json must be byte-identical across two builds').toBe(first)

    // coverage.json must not contain a generated_at field (would be non-deterministic)
    const parsed = JSON.parse(first)
    expect(
      parsed,
      'coverage.json must not have a generated_at field',
    ).not.toHaveProperty('generated_at')
  })
})

// ---------------------------------------------------------------------------
// S3-AC5 — isIndexStale returns false immediately after a fresh build
// ---------------------------------------------------------------------------

describe('S3-AC5 — index is fresh immediately after build', () => {
  it('S3-AC5: isIndexStale(specDir) returns false right after spec build', { timeout: 30_000 }, () => {
    const r = runBuild()
    expect(r.code, `build failed\nstdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0)

    const stale = isIndexStale(SPEC_DIR)
    expect(stale, 'isIndexStale must return false immediately after a fresh build').toBe(false)
  })
})
