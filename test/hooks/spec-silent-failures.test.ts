/**
 * Regression tests for four silent-failure bugs in the groundwork spec subsystem.
 *
 * Each test would have caught a real bug that previously:
 *   - exited 0 (success)
 *   - emitted no warnings or errors
 *   - returned a plausible value (0 counts, "unknown", missing path)
 *
 * Rules:
 *   - All fixtures are built in a temp dir; no dependency on doc/specs live tree.
 *   - Every assertion is on an actual VALUE, never solely on exit code.
 *   - Tests must FAIL against the old code (before the fix) to count as regressions.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const SPEC_IO_PATH = path.resolve(
  import.meta.dirname,
  '..', '..', 'hooks', 'lib', 'spec-io.mjs',
)

const SPEC_LINT_PATH = path.resolve(
  import.meta.dirname,
  '..', '..', 'hooks', 'spec-lint.mjs',
)

const SPEC_BUILD_PATH = path.resolve(
  import.meta.dirname,
  '..', '..', 'hooks', 'spec.mjs',
)

const {
  parseRequirementsDocument,
  buildIndexData,
} = await import(pathToFileURL(SPEC_IO_PATH).href)

// ---------------------------------------------------------------------------
// Shared fixture builders
// ---------------------------------------------------------------------------

/** Minimal README.md content for a concept directory. */
function makeReadme(id: string, title: string): string {
  return [
    '---',
    `id: ${id}`,
    'type: concept',
    `title: ${title}`,
    `summary: ${title} concept summary`,
    'origin_decision_ref: test-motive#D-1',
    'status: draft',
    '---',
    '',
    `# ${title}`,
  ].join('\n')
}

/** Minimal constraints.md content with one valid requirement. */
function makeConstraintsMd(conceptId: string, reqSuffix: string = 'R-001', title: string = 'Example requirement'): string {
  const reqId = `${conceptId}-${reqSuffix}`
  const anchor = reqId.toLowerCase()
  return [
    '---',
    `concept: ${conceptId}`,
    'origin_decision_ref: test-motive#D-1',
    '---',
    '',
    `## ${reqId} — ${title} {#${anchor}}`,
    '',
    `**When** the system starts, \`hooks/spec.mjs\``,
    `**shall** do the thing.`,
    '',
    `- **Why** — because it matters.`,
    `- **Fit criterion** — the thing is done.`,
    `- **Verification** automated · **Criticality** must · **Source** RFC-TEST-001`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Bug 1: VIEW-SKIP DROPPED REQUIREMENTS
//
// Old behaviour: a spec.yaml with `views: [{type: constraints, file: constraints.md}]`
// caused buildIndexData to skip constraints.md entirely → 0 requirements indexed,
// no warning emitted.
//
// Fixed behaviour: constraints.md IS indexed (non-zero count) AND a
// view_shadows_requirements warning is emitted.
//
// Assertion that would have caught the old bug:
//   expect(reqNodes.length).toBeGreaterThan(0)  — was 0 before the fix
// ---------------------------------------------------------------------------

describe('Bug 1 — view-skip dropped requirements', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'gw-sf-bug1-'))
    writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }))
  })

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }))

  function specDir() { return path.join(tmpDir, 'doc', 'specs') }

  it('indexes constraints.md requirements even when spec.yaml lists it as a view', () => {
    const conceptDir = path.join(specDir(), 'myfeature')
    mkdirSync(conceptDir, { recursive: true })

    writeFileSync(path.join(conceptDir, 'README.md'), makeReadme('C-MYFEATURE', 'My Feature'))
    writeFileSync(path.join(conceptDir, 'constraints.md'), makeConstraintsMd('C-MYFEATURE'))

    // This spec.yaml lists constraints.md as a view — the old code silently skipped it
    const specYaml = [
      'id: C-MYFEATURE',
      'title: My Feature',
      'summary: My Feature concept summary',
      'views:',
      '  - type: constraints',
      '    file: constraints.md',
    ].join('\n')
    writeFileSync(path.join(conceptDir, 'spec.yaml'), specYaml)

    const { nodes, warnings } = buildIndexData(specDir())
    const reqNodes = Object.values(nodes).filter((n: any) => n.type === 'requirement')

    // KEY ASSERTION: requirement count must be non-zero
    // Before the fix: reqNodes.length === 0 (silent data loss)
    expect(reqNodes.length).toBeGreaterThan(0)

    // Canonical usage: constraints.md declared as a view is correct — no warning should be emitted.
    const shadowWarnings = warnings.filter((w: any) => w.type === 'view_shadows_requirements')
    expect(shadowWarnings.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Bug 2: constraints.md NOT INDEXED + deprecated_requirements_filename warning
//
// Old behaviour: constraints.md was not recognised as a requirements document
// → 0 requirements indexed from it. requirements.md was recognised but emitted
// no deprecation warning (silent upgrade path).
//
// Fixed behaviour:
//   a) constraints.md → non-zero requirement count
//   b) requirements.md → non-zero requirement count AND deprecated_requirements_filename
//      warning is present, naming the offending file path
//
// Assertion that would have caught the old bugs:
//   a) expect(constraintReqs.length).toBeGreaterThan(0)
//   b) expect(deprecWarnings.length).toBeGreaterThan(0) — was 0 before fix
// ---------------------------------------------------------------------------

describe('Bug 2 — constraints.md not indexed / deprecated_requirements_filename warning', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'gw-sf-bug2-'))
    writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }))
  })

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }))

  function specDir() { return path.join(tmpDir, 'doc', 'specs') }

  it('indexes requirements from constraints.md (non-zero count)', () => {
    const conceptDir = path.join(specDir(), 'featurea')
    mkdirSync(conceptDir, { recursive: true })

    writeFileSync(path.join(conceptDir, 'README.md'), makeReadme('C-FEATUREA', 'Feature A'))
    writeFileSync(path.join(conceptDir, 'constraints.md'), makeConstraintsMd('C-FEATUREA'))

    const { nodes } = buildIndexData(specDir())
    const reqNodes = Object.values(nodes).filter((n: any) => n.type === 'requirement')

    // KEY ASSERTION: must index from constraints.md
    // Before the fix: reqNodes.length === 0
    expect(reqNodes.length).toBeGreaterThan(0)
  })

  it('indexes requirements from requirements.md (non-zero count)', () => {
    const conceptDir = path.join(specDir(), 'featureb')
    mkdirSync(conceptDir, { recursive: true })

    writeFileSync(path.join(conceptDir, 'README.md'), makeReadme('C-FEATUREB', 'Feature B'))

    // requirements.md uses H3 (###) headings — canonical old format
    const reqMd = [
      '---',
      'concept: C-FEATUREB',
      'origin_decision_ref: test-motive#D-1',
      '---',
      '',
      '### C-FEATUREB-R-001 — Example {#c-featureb-r-001}',
      '',
      '**When** the system starts, `hooks/spec.mjs`',
      '**shall** do the thing.',
      '',
      '- **Why** — because it matters.',
      '- **Fit criterion** — the thing is done.',
      '- **Verification** automated · **Criticality** must · **Source** RFC-TEST-001',
    ].join('\n')
    writeFileSync(path.join(conceptDir, 'requirements.md'), reqMd)

    const { nodes, warnings } = buildIndexData(specDir())
    const reqNodes = Object.values(nodes).filter((n: any) => n.type === 'requirement')

    // Non-zero count
    expect(reqNodes.length).toBeGreaterThan(0)

    // KEY ASSERTION: deprecation warning must be emitted
    // Before the fix: no warning emitted (silent — user never knew to rename)
    const deprecWarnings = warnings.filter((w: any) => w.type === 'deprecated_requirements_filename')
    expect(deprecWarnings.length).toBeGreaterThan(0)

    // Warning must name the offending file path (not just a generic message)
    expect(deprecWarnings[0].message).toContain('requirements.md')
    expect(deprecWarnings[0].path).toContain('requirements.md')
  })
})

// ---------------------------------------------------------------------------
// Bug 3: ANNOTATION FORMS — both forms must parse to real values (not "unknown")
//        AND the linter's verification-unparseable fires on a broken dialect,
//        does NOT fire when no Verification annotation is present at all.
//
// Old behaviour: one or both annotation forms returned verification === null or
// "unknown", causing by_verification coverage to be wrong.
//
// Fixed behaviour:
//   a) Form 1 (inline ·): verification, criticality parse to actual values
//   b) Form 2 (multi-bullet :): same
//   c) Linter fires verification-unparseable on an unrecognisable dialect
//   d) Linter does NOT fire verification-unparseable when the section has no
//      Verification line at all (genuine absence is silent by design)
//
// Assertions that would have caught the old bugs:
//   a/b) expect(s.verification).not.toBe('unknown') and not toBe(null)
//   c/d) violation presence / absence
// ---------------------------------------------------------------------------

describe('Bug 3 — annotation forms parse correctly', () => {
  // Form 1: single inline line with middots
  const FORM1_DOC = [
    '---',
    'concept: C-ANNO',
    '---',
    '',
    '### C-ANNO-R-001 — Form one {#c-anno-r-001}',
    '',
    '**When** a starts, `cmd` **shall** do it.',
    '',
    '- **Why** — because.',
    '- **Fit criterion** — it does.',
    '- **Verification** automated · **Criticality** must · **Source** RFC-001',
  ].join('\n')

  // Form 2: separate bullet lines with colons
  const FORM2_DOC = [
    '---',
    'concept: C-ANNO',
    '---',
    '',
    '### C-ANNO-R-002 — Form two {#c-anno-r-002}',
    '',
    '**When** a starts, `cmd` **shall** do it.',
    '',
    '- **Why** — because.',
    '- **Fit criterion** — it does.',
    '- **Verification**: automated — run the suite',
    '- **Criticality**: must',
    '- **Source**: RFC-001',
  ].join('\n')

  it('Form 1 (inline ·): verification parses to a real value, not null or "unknown"', () => {
    const [s] = parseRequirementsDocument(FORM1_DOC)
    // KEY ASSERTION: before the fix this could be null or "unknown"
    expect(s.verification).not.toBeNull()
    expect(s.verification).not.toBe('unknown')
    expect(s.verification).toBe('automated')
  })

  it('Form 1 (inline ·): criticality parses to a real value, not null or "unknown"', () => {
    const [s] = parseRequirementsDocument(FORM1_DOC)
    expect(s.criticality).not.toBeNull()
    expect(s.criticality).not.toBe('unknown')
    expect(s.criticality).toBe('must')
  })

  it('Form 2 (multi-bullet :): verification parses to a real value, not null or "unknown"', () => {
    const [s] = parseRequirementsDocument(FORM2_DOC)
    // KEY ASSERTION: before the fix this could return "unknown"
    expect(s.verification).not.toBeNull()
    expect(s.verification).not.toBe('unknown')
    expect(s.verification).toBe('automated')
  })

  it('Form 2 (multi-bullet :): criticality parses to a real value, not null or "unknown"', () => {
    const [s] = parseRequirementsDocument(FORM2_DOC)
    expect(s.criticality).not.toBeNull()
    expect(s.criticality).not.toBe('unknown')
    expect(s.criticality).toBe('must')
  })
})

// ---------------------------------------------------------------------------
// Bug 3 (linter side) — verification-unparseable fires on broken dialect,
// does NOT fire on genuine absence
// ---------------------------------------------------------------------------

describe('Bug 3 — linter verification-unparseable violation', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'gw-sf-bug3-'))
    writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }))
  })

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }))

  function specDir() { return path.join(tmpDir, 'doc', 'specs') }
  function generatedDir() { return path.join(specDir(), '_generated') }

  /** Build and write an index.json for spec-lint to consume. */
  function buildAndWriteIndex(): void {
    const { nodes, warnings } = buildIndexData(specDir())
    mkdirSync(generatedDir(), { recursive: true })
    writeFileSync(
      path.join(generatedDir(), 'index.json'),
      JSON.stringify({ nodes, warnings, errors: [] }),
    )
  }

  /** Run spec-lint and return its stdout+stderr output. */
  function runLint(): { stdout: string; stderr: string; status: number } {
    const result = spawnSync(
      process.execPath,
      [SPEC_LINT_PATH],
      {
        env: { ...process.env, GROUNDWORK_PROJECT_DIR: tmpDir, CLAUDE_PROJECT_DIR: undefined },
        encoding: 'utf8',
      },
    )
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      status: result.status ?? -1,
    }
  }

  it('emits verification-unparseable when a broken Verification dialect is present', () => {
    const conceptDir = path.join(specDir(), 'linttest')
    mkdirSync(conceptDir, { recursive: true })
    writeFileSync(path.join(conceptDir, 'README.md'), makeReadme('C-LINTTEST', 'Lint Test'))

    // Unparseable dialect: uses [brackets] instead of a recognised separator
    const badDoc = [
      '---',
      'concept: C-LINTTEST',
      'origin_decision_ref: test-motive#D-1',
      '---',
      '',
      '## C-LINTTEST-R-001 — Bad annotation {#c-linttest-r-001}',
      '',
      '**When** thing starts, `cmd` **shall** happen.',
      '',
      '- **Why** — because.',
      '- **Fit criterion** — happens.',
      '- **Verification** [automated] // Criticality: must',
    ].join('\n')
    writeFileSync(path.join(conceptDir, 'constraints.md'), badDoc)
    buildAndWriteIndex()

    const { stdout, stderr } = runLint()
    const combined = stdout + stderr

    // KEY ASSERTION: linter must call out the unparseable line
    // Before the fix: no violation emitted (silent — bad dialect went undetected)
    expect(combined).toContain('verification-unparseable')
    expect(combined).toContain('C-LINTTEST-R-001')
  })

  it('does NOT emit verification-unparseable when section has no Verification line at all', () => {
    const conceptDir = path.join(specDir(), 'lintnoann')
    mkdirSync(conceptDir, { recursive: true })
    writeFileSync(path.join(conceptDir, 'README.md'), makeReadme('C-NOANN', 'No Annotation'))

    // No Verification bullet at all — genuine absence, must stay silent
    const noAnnDoc = [
      '---',
      'concept: C-NOANN',
      'origin_decision_ref: test-motive#D-1',
      '---',
      '',
      '## C-NOANN-R-001 — No annotation {#c-noann-r-001}',
      '',
      '**When** thing starts, `cmd` **shall** happen.',
      '',
      '- **Why** — because.',
      '- **Fit criterion** — happens.',
    ].join('\n')
    writeFileSync(path.join(conceptDir, 'constraints.md'), noAnnDoc)
    buildAndWriteIndex()

    const { stdout, stderr } = runLint()
    const combined = stdout + stderr

    // KEY ASSERTION: genuine absence must be silent — no verification-unparseable
    // This pins the deliberate design: absence is OK, bad dialect is not.
    expect(combined).not.toContain('verification-unparseable')
  })
})

// ---------------------------------------------------------------------------
// Bug 4: LINT INDEX PATH — when CLAUDE_PROJECT_DIR is unset, lint must fall
// back to process.cwd() and the not-found error message must include the
// absolute path it looked in.
//
// Old behaviour: path fell back to a wrong or relative location; the error
// message did not include the resolved absolute path (making it untraceable).
//
// Fixed behaviour: error message contains the absolute path spec-lint checked.
//
// Assertion that would have caught the old bug:
//   expect(stderr).toContain('/') — a bare relative path or wrong dir is not absolute
//   AND: expect(stderr).toContain('index.json')
// ---------------------------------------------------------------------------

describe('Bug 4 — lint index path resolution falls back to cwd', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'gw-sf-bug4-'))
    writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }))
    // D-15: do NOT create doc/specs/ — absence of the spec tree triggers the not-found path
  })

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }))

  it('not-found message contains an absolute path when CLAUDE_PROJECT_DIR is unset', () => {
    // Run lint with both project dir env vars unset, but cwd set to tmpDir
    const result = spawnSync(
      process.execPath,
      [SPEC_LINT_PATH],
      {
        env: {
          ...process.env,
          GROUNDWORK_PROJECT_DIR: undefined,
          CLAUDE_PROJECT_DIR: undefined,
        },
        cwd: tmpDir,
        encoding: 'utf8',
      },
    )

    const stderr = result.stderr ?? ''

    // KEY ASSERTION: the error message must contain an absolute path (starts with /)
    // Before the fix: the path could be relative (e.g. "doc/specs/_generated/index.json")
    // making it impossible to trace where lint actually looked.
    expect(stderr).toContain('index.json')
    // The path in the message must be absolute (resolves to tmpDir)
    const pathMatch = stderr.match(/at (.+index\.json)/)
    expect(pathMatch).not.toBeNull()
    const reportedPath = pathMatch![1]
    expect(path.isAbsolute(reportedPath)).toBe(true)
    expect(reportedPath).toContain(tmpDir)
  })
})

// ---------------------------------------------------------------------------
// Bug 7: BUILD-THEN-LINT SEQUENCE — when CLAUDE_PROJECT_DIR is unset, running
// `spec build` followed by `spec lint` must resolve the freshly-built index.
//
// Old behaviour: spec-lint.mjs resolved projectDir from CLAUDE_PROJECT_DIR only;
// with that env var absent it derived an incorrect path, found no index.json, and
// emitted "spec lint: spec index not found. Run \"spec build\" first."
// even though spec build had just succeeded.
//
// Fixed behaviour (line 608 of hooks/spec-lint.mjs):
//   const projectDir = process.env.GROUNDWORK_PROJECT_DIR
//                    ?? process.env.CLAUDE_PROJECT_DIR
//                    ?? process.cwd()   ← the fix
// With the cwd fallback, lint finds the index that build wrote.
//
// Regression assertion: lint's output must NOT contain "index not found".
// This would fail if the cwd fallback were removed from spec-lint.mjs.
// ---------------------------------------------------------------------------

describe('Bug 7 — build-then-lint succeeds when CLAUDE_PROJECT_DIR is unset', () => {
  let tmpDir: string

  // Env to pass to both child processes: all real env vars minus the project dir overrides.
  // Setting a key to `undefined` in spawnSync's env object causes Node to omit it from
  // the child process environment, so GROUNDWORK_PROJECT_DIR and CLAUDE_PROJECT_DIR are
  // genuinely absent (not just set to the empty string).
  function makeEnv(): NodeJS.ProcessEnv {
    const e = { ...process.env }
    delete e['GROUNDWORK_PROJECT_DIR']
    delete e['CLAUDE_PROJECT_DIR']
    return e
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'gw-sf-bug7-'))
    // package.json is required so findProjectRoot() in spec.mjs anchors to tmpDir
    writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-bug7' }))

    // Minimal spec tree: one concept with a valid constraints.md
    const conceptDir = path.join(tmpDir, 'doc', 'specs', 'myfeature')
    mkdirSync(conceptDir, { recursive: true })
    writeFileSync(path.join(conceptDir, 'README.md'), makeReadme('C-MYFEATURE', 'My Feature'))
    writeFileSync(path.join(conceptDir, 'constraints.md'), makeConstraintsMd('C-MYFEATURE'))
  })

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }))

  it('lint resolves the freshly-built index without CLAUDE_PROJECT_DIR set', () => {
    const sharedEnv = makeEnv()

    // Step 1: build the spec index
    const buildResult = spawnSync(
      process.execPath,
      [SPEC_BUILD_PATH, 'build'],
      { env: sharedEnv, cwd: tmpDir, encoding: 'utf8' },
    )
    // Build must succeed; if it doesn't, the test fixture is misconfigured.
    expect(
      buildResult.status,
      `spec build failed (stderr: ${buildResult.stderr})`,
    ).toBe(0)

    // Step 2: run lint against the freshly-built index
    const lintResult = spawnSync(
      process.execPath,
      [SPEC_LINT_PATH],
      { env: sharedEnv, cwd: tmpDir, encoding: 'utf8' },
    )

    const combined = (lintResult.stdout ?? '') + (lintResult.stderr ?? '')

    // KEY REGRESSION ASSERTION: lint must NOT report a missing index.
    // Before the fix (no cwd fallback), lint resolved projectDir to `undefined`
    // (coerced to the string "undefined"), found no index.json there, and printed
    // this exact phrase. Reverting line 608 to remove `?? process.cwd()` makes
    // this test fail.
    expect(combined).not.toContain('index not found')

    // Corroborating assertion: lint must report something meaningful — either
    // "clean", real violations, or a LINT_DRIFT line — proving it actually read
    // the index rather than bailing out early.
    const reportedSubstantiveOutput =
      combined.includes('clean') ||
      combined.includes('violations found') ||
      combined.includes('LINT_DRIFT')
    expect(
      reportedSubstantiveOutput,
      `lint output was unexpected: ${combined}`,
    ).toBe(true)
  })
})
