/**
 * spec-divergences.test.ts — pins the two docs/hooks divergences resolved by empirical QA.
 *
 * DIVERGENCE 1 — requirements.md deprecated filename alias vs view type name
 *   (i)  type: constraints + file: requirements.md  → build+lint clean (just deprecation warning)
 *   (ii) type: requirements + file: requirements.md → lint unknown-view-type with targeted hint
 *
 * DIVERGENCE 2 — verification: manual "### Manual procedure" sub-section (doc fix only)
 *   The SKILL.md previously said "must" but lint never enforced it.  Decision: soften to
 *   "recommended" (existing tests in spec-lint.test.ts use manual verification without a
 *   procedure section and cannot be modified).  The doc now matches the actual behavior.
 *   Tests pin: a manual verification WITHOUT a procedure section does NOT cause a lint error.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SPEC_MJS = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'spec.mjs')
const LINT_MJS = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'spec-lint.mjs')

let projectDir: string

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), 'gw-diverg-'))
  writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'test-project' }))
})

afterEach(() => rmSync(projectDir, { recursive: true, force: true }))

function specDir() { return path.join(projectDir, 'doc', 'specs') }

function runBuild(dir: string = projectDir): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir }
  delete env.CLAUDE_CODE_SESSION_ID
  const result = spawnSync('node', [SPEC_MJS, 'build'], { env, encoding: 'utf8' })
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function runLint(dir: string = projectDir): { code: number; stdout: string } {
  const env = { ...process.env, GROUNDWORK_PROJECT_DIR: dir }
  delete env.CLAUDE_CODE_SESSION_ID
  try {
    const stdout = execFileSync('node', [LINT_MJS], { env, encoding: 'utf8' })
    return { code: 0, stdout }
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string }
    return { code: err.status ?? 1, stdout: err.stdout ?? '' }
  }
}

/** Create a minimal valid concept with a spec.yaml pointing at the given view entry. */
function scaffold(opts: { viewType: string; viewFile: string; fileContent: string }) {
  const sd = specDir()
  const conceptDir = path.join(sd, 'myfeat')
  mkdirSync(conceptDir, { recursive: true })

  writeFileSync(
    path.join(sd, 'README.md'),
    [
      '---',
      'id: C-ROOT',
      'type: concept',
      'title: Root',
      'summary: Root concept for testing.',
      'status: draft',
      '---',
      '',
      '# Root',
    ].join('\n'),
  )

  writeFileSync(
    path.join(conceptDir, 'README.md'),
    [
      '---',
      'id: C-MYFEAT',
      'type: concept',
      'title: My Feature',
      'summary: My feature concept summary.',
      'status: draft',
      'parent: C-ROOT',
      '---',
      '',
      '# My Feature',
    ].join('\n'),
  )

  writeFileSync(
    path.join(conceptDir, 'spec.yaml'),
    [
      'id: C-MYFEAT',
      'title: My Feature',
      'summary: My feature concept summary.',
      'status: draft',
      'views:',
      `  - type: ${opts.viewType}`,
      `    file: ${opts.viewFile}`,
    ].join('\n'),
  )

  writeFileSync(path.join(conceptDir, opts.viewFile), opts.fileContent)
}

const CONSTRAINTS_BODY_AUTO = [
  '---',
  'type: constraints',
  'id: C-MYFEAT',
  '---',
  '',
  '## C-MYFEAT-R-001 — The system shall process input {#c-myfeat-r-001}',
  '',
  'The system **shall** process input.',
  '',
  '- **Why** — Without processing input the system cannot function.',
  '- **Fit criterion** — After calling process(), the result is non-null.',
  '- **Verification**: automated — Unit test asserts result is non-null.',
  '- **Criticality**: must',
].join('\n')

const CONSTRAINTS_BODY_MANUAL_NO_PROC = [
  '---',
  'type: constraints',
  'id: C-MYFEAT',
  '---',
  '',
  '## C-MYFEAT-R-001 — The system shall process input {#c-myfeat-r-001}',
  '',
  'The system **shall** process input.',
  '',
  '- **Why** — Without processing input the system cannot function.',
  '- **Fit criterion** — After calling process(), the result is non-null.',
  '- **Verification**: manual — Manually run the process and check the result.',
  '- **Criticality**: must',
].join('\n')

const CONSTRAINTS_BODY_MANUAL_WITH_PROC = [
  '---',
  'type: constraints',
  'id: C-MYFEAT',
  '---',
  '',
  '## C-MYFEAT-R-001 — The system shall process input {#c-myfeat-r-001}',
  '',
  'The system **shall** process input.',
  '',
  '- **Why** — Without processing input the system cannot function.',
  '- **Fit criterion** — After calling process(), the result is non-null.',
  '- **Verification**: manual — Manually run the process and check the result.',
  '- **Criticality**: must',
  '',
  '### Manual procedure',
  '',
  '1. Run `node process.mjs input.txt`.',
  '2. Confirm output is non-null.',
].join('\n')

// ---------------------------------------------------------------------------
// DIVERGENCE 1 — deprecated filename alias
// ---------------------------------------------------------------------------

describe('Divergence 1(i): type: constraints + file: requirements.md', () => {
  it('build accepts it (deprecation warning only, not an error)', () => {
    scaffold({ viewType: 'constraints', viewFile: 'requirements.md', fileContent: CONSTRAINTS_BODY_AUTO })
    const build = runBuild()
    expect(build.code).toBe(0)
    // Warning may appear on stdout or stderr depending on impl
    expect(build.stdout + build.stderr).toContain('requirements.md is deprecated')
  })

  it('lint does not emit unknown-view-type', () => {
    scaffold({ viewType: 'constraints', viewFile: 'requirements.md', fileContent: CONSTRAINTS_BODY_AUTO })
    runBuild()
    const lint = runLint()
    expect(lint.stdout).not.toContain('unknown-view-type')
  })
})

describe('Divergence 1(ii): type: requirements + file: requirements.md', () => {
  it('build accepts it (deprecation warning only)', () => {
    scaffold({ viewType: 'requirements', viewFile: 'requirements.md', fileContent: CONSTRAINTS_BODY_AUTO })
    const build = runBuild()
    expect(build.code).toBe(0)
    expect(build.stdout + build.stderr).toContain('requirements.md is deprecated')
  })

  it('lint emits unknown-view-type for type: requirements', () => {
    scaffold({ viewType: 'requirements', viewFile: 'requirements.md', fileContent: CONSTRAINTS_BODY_AUTO })
    runBuild()
    const lint = runLint()
    expect(lint.code).toBe(1)
    expect(lint.stdout).toContain('unknown-view-type')
  })

  it('unknown-view-type error hints that type: constraints is the fix', () => {
    scaffold({ viewType: 'requirements', viewFile: 'requirements.md', fileContent: CONSTRAINTS_BODY_AUTO })
    runBuild()
    const lint = runLint()
    // Must name the fix explicitly — the reader must not need to guess
    expect(lint.stdout).toContain('type: constraints')
    expect(lint.stdout).toContain('"requirements" is not a view type')
  })
})

// ---------------------------------------------------------------------------
// DIVERGENCE 2 — verification: manual and ### Manual procedure (doc fix, not enforced)
//
// The SKILL.md rule said "must include ... section" but lint never enforced it.
// Existing spec-lint.test.ts fixtures use verification: manual without a procedure section
// and those files cannot be modified.  Decision: soften SKILL.md to "strongly recommended".
//
// These tests pin the ACTUAL behaviour: lint does not fail for missing ### Manual procedure.
// ---------------------------------------------------------------------------

describe('Divergence 2: verification: manual without ### Manual procedure', () => {
  it('lint does NOT emit any manual-procedure violation (rule is recommended, not enforced)', () => {
    scaffold({ viewType: 'constraints', viewFile: 'constraints.md', fileContent: CONSTRAINTS_BODY_MANUAL_NO_PROC })
    runBuild()
    const lint = runLint()
    // No manual-procedure violation — the rule is a doc recommendation only
    expect(lint.stdout).not.toContain('manual-procedure')
  })

  it('lint does NOT emit any manual-procedure violation when procedure section IS present (recommendation, not enforced either way)', () => {
    scaffold({ viewType: 'constraints', viewFile: 'constraints.md', fileContent: CONSTRAINTS_BODY_MANUAL_WITH_PROC })
    runBuild()
    const lint = runLint()
    // The presence of a procedure section must not trigger over-eager enforcement
    expect(lint.stdout).not.toContain('manual-procedure')
  })
})
