/**
 * spec-view-doublecount tests
 *
 * Regression guard: a constraints.md (or requirements.md) declared as a view in
 * spec.yaml must NOT be double-counted.  The view-skip exemption that was added to
 * preserve requirements means the file is indexed exactly once — as a requirements
 * document — and never again as a view.
 *
 * Covers:
 *   1. index.json contains exactly one node entry for each requirement in constraints.md
 *   2. coverage.json `total` equals the number of requirements in the file (not 2×)
 *   3. coverage.json `by_verification` and `by_criticality` counts match single-count
 *   4. Build exits 0 and emits a human-readable warning (not a hard error)
 */

import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const CLI = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'spec.mjs')

let projectDir: string

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), 'gw-view-doublecount-'))
  writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'view-doublecount-test' }),
  )
})
afterEach(() => rmSync(projectDir, { recursive: true, force: true }))

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir }
  delete env.CLAUDE_CODE_SESSION_ID
  const result = spawnSync('node', [CLI, ...args], { env, encoding: 'utf8' })
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

const SPEC_DIR = () => path.join(projectDir, 'doc', 'specs')
const GEN_DIR = () => path.join(projectDir, 'doc', 'specs', '_generated')

function setup(): void {
  const conceptDir = path.join(SPEC_DIR(), 'my-concept')
  mkdirSync(conceptDir, { recursive: true })

  // Concept node
  writeFileSync(
    path.join(conceptDir, 'README.md'),
    [
      '---',
      'id: C-MY-CONCEPT',
      'type: concept',
      'title: My Concept',
      'summary: A test concept',
      '---',
      '',
      '# My Concept',
    ].join('\n'),
  )

  // constraints.md with two requirements
  writeFileSync(
    path.join(conceptDir, 'constraints.md'),
    [
      '# My Concept Constraints',
      '',
      '## MY-CONCEPT-R-001 — First requirement {#my-concept-r-001}',
      '',
      'The system **shall** do the first thing.',
      '',
      '- **Why** — Needed for testing.',
      '- **Fit criterion** — It does the first thing.',
      '- **Verification** automated · **Criticality** must · **Source** RFC-0001',
      '',
      '## MY-CONCEPT-R-002 — Second requirement {#my-concept-r-002}',
      '',
      'The system **shall** do the second thing.',
      '',
      '- **Why** — Also needed for testing.',
      '- **Fit criterion** — It does the second thing.',
      '- **Verification** manual · **Criticality** should · **Source** RFC-0001',
    ].join('\n'),
  )

  // spec.yaml that declares constraints.md as a view
  writeFileSync(
    path.join(conceptDir, 'spec.yaml'),
    [
      'views:',
      '  - type: constraints',
      '    file: constraints.md',
    ].join('\n'),
  )
}

describe('constraints.md declared as a view in spec.yaml', () => {
  it('build exits 0', () => {
    setup()
    const { code } = run(['build'])
    expect(code).toBe(0)
  })

  it('does NOT emit a view_shadows_requirements warning — constraints.md as declared view is canonical usage', () => {
    setup()
    const { stderr } = run(['build'])
    expect(stderr).not.toContain('view_shadows_requirements')
    expect(stderr).not.toContain('is listed under spec.yaml views:')
  })

  it('index.json contains exactly one node per requirement — no double-count', () => {
    setup()
    run(['build'])
    const idx = JSON.parse(readFileSync(path.join(GEN_DIR(), 'index.json'), 'utf8'))
    const reqNodes = Object.values(idx.nodes as Record<string, { type: string }>).filter(
      (n) => n.type === 'requirement',
    )
    // Two requirements in the file → exactly two requirement nodes
    expect(reqNodes).toHaveLength(2)
    // Each ID appears exactly once (object keys are inherently unique, but confirm both present)
    expect(idx.nodes).toHaveProperty('MY-CONCEPT-R-001')
    expect(idx.nodes).toHaveProperty('MY-CONCEPT-R-002')
  })

  it('coverage.json total equals 2 (not 4)', () => {
    setup()
    run(['build'])
    const cov = JSON.parse(readFileSync(path.join(GEN_DIR(), 'coverage.json'), 'utf8'))
    expect(cov.total).toBe(2)
  })

  it('coverage.json by_verification counts are correct (not doubled)', () => {
    setup()
    run(['build'])
    const cov = JSON.parse(readFileSync(path.join(GEN_DIR(), 'coverage.json'), 'utf8'))
    // One automated, one manual — each should appear exactly once
    expect(cov.by_verification).toEqual({ automated: 1, manual: 1 })
  })

  it('coverage.json by_criticality counts are correct (not doubled)', () => {
    setup()
    run(['build'])
    const cov = JSON.parse(readFileSync(path.join(GEN_DIR(), 'coverage.json'), 'utf8'))
    // One must, one should
    expect(cov.by_criticality).toEqual({ must: 1, should: 1 })
  })

  it('coverage.json by_requirement has exactly 2 entries', () => {
    setup()
    run(['build'])
    const cov = JSON.parse(readFileSync(path.join(GEN_DIR(), 'coverage.json'), 'utf8'))
    expect(Object.keys(cov.by_requirement)).toHaveLength(2)
    expect(cov.by_requirement).toHaveProperty('MY-CONCEPT-R-001')
    expect(cov.by_requirement).toHaveProperty('MY-CONCEPT-R-002')
  })
})

describe('non-canonical view file containing requirement headings', () => {
  function setupWithShadowingView(): void {
    const conceptDir = path.join(SPEC_DIR(), 'my-concept')
    mkdirSync(conceptDir, { recursive: true })

    writeFileSync(
      path.join(conceptDir, 'README.md'),
      ['---', 'id: C-MY-CONCEPT', 'type: concept', 'title: My Concept', 'summary: A test concept', '---', '', '# My Concept'].join('\n'),
    )

    // A non-canonical file (not constraints.md) declared as a view but containing requirement headings.
    // Its requirements will be silently dropped — this is the genuinely hazardous case.
    writeFileSync(
      path.join(conceptDir, 'extra.md'),
      [
        '# Extra notes',
        '',
        '## MY-CONCEPT-R-003 — Requirement hiding in a view {#my-concept-r-003}',
        '',
        'The system **shall** do the extra thing.',
        '',
        '- **Why** — Testing the warning path.',
        '- **Fit criterion** — It does the extra thing.',
        '- **Verification** automated · **Criticality** must · **Source** RFC-0001',
      ].join('\n'),
    )

    writeFileSync(
      path.join(conceptDir, 'spec.yaml'),
      ['views:', '  - type: extra', '    file: extra.md'].join('\n'),
    )
  }

  it('emits a view_shadows_requirements warning for a non-canonical view with requirement headings', () => {
    setupWithShadowingView()
    const { stderr } = run(['build'])
    expect(stderr).toContain('extra.md is listed under spec.yaml views:')
    expect(stderr).toContain('silently dropped')
  })

  it('the shadowed requirement is NOT in the index — data loss confirmed and warned', () => {
    setupWithShadowingView()
    run(['build'])
    const idx = JSON.parse(readFileSync(path.join(GEN_DIR(), 'index.json'), 'utf8'))
    expect(idx.nodes).not.toHaveProperty('MY-CONCEPT-R-003')
  })
})

describe('requirements.md declared as a view in spec.yaml (alias + view corner)', () => {
  // Regression guard: when a project uses the deprecated alias `requirements.md` AND
  // declares it as a view in spec.yaml, the deprecated_requirements_filename warning
  // MUST still fire.  The view-skip exemption must not silently swallow the deprecation.
  function setupAliasView(): void {
    const conceptDir = path.join(SPEC_DIR(), 'my-concept')
    mkdirSync(conceptDir, { recursive: true })

    writeFileSync(
      path.join(conceptDir, 'README.md'),
      ['---', 'id: C-MY-CONCEPT', 'type: concept', 'title: My Concept', 'summary: A test concept', '---', '', '# My Concept'].join('\n'),
    )

    writeFileSync(
      path.join(conceptDir, 'requirements.md'),
      [
        '# My Concept Constraints',
        '',
        '## MY-CONCEPT-R-001 — First requirement {#my-concept-r-001}',
        '',
        'The system **shall** do the first thing.',
        '',
        '- **Why** — Needed for testing.',
        '- **Fit criterion** — It does the first thing.',
        '- **Verification** automated · **Criticality** must · **Source** RFC-0001',
      ].join('\n'),
    )

    writeFileSync(
      path.join(conceptDir, 'spec.yaml'),
      ['views:', '  - type: constraints', '    file: requirements.md'].join('\n'),
    )
  }

  it('build exits 0', () => {
    setupAliasView()
    const { code } = run(['build'])
    expect(code).toBe(0)
  })

  it('emits deprecated_requirements_filename warning even when requirements.md is declared as a view', () => {
    setupAliasView()
    const { stderr } = run(['build'])
    expect(stderr).toContain('requirements.md is deprecated')
    expect(stderr).toContain('rename this file to constraints.md')
  })

  it('does NOT emit a view_shadows_requirements warning — requirements.md as view is exempt (alias of canonical)', () => {
    setupAliasView()
    const { stderr } = run(['build'])
    expect(stderr).not.toContain('view_shadows_requirements')
  })

  it('requirement is indexed (not silently dropped by view-skip)', () => {
    setupAliasView()
    run(['build'])
    const idx = JSON.parse(readFileSync(path.join(GEN_DIR(), 'index.json'), 'utf8'))
    expect(idx.nodes).toHaveProperty('MY-CONCEPT-R-001')
  })
})
