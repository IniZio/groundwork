/**
 * spec-item10.test.ts — pins the four behaviors from feedback item 10 parts A/B/C.
 *
 * 1. README/spec.yaml summary mismatch is caught with both file paths named.
 * 2. A >25-word summary is caught as a summary-length violation.
 * 3. coverage.json contains by_concept with correct counts.
 * 4. A 3-level-deep concept tree indexes correctly.
 *
 * All fixtures live in temp dirs; no dependency on the live doc/specs/ tree.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'

const SPEC_MJS = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'spec.mjs')
const LINT_MJS = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'spec-lint.mjs')
const SPEC_IO_PATH = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'lib', 'spec-io.mjs')

const { buildIndexData } = await import(pathToFileURL(SPEC_IO_PATH).href)

let projectDir: string

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), 'gw-item10-'))
  writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'test-project' }))
})

afterEach(() => rmSync(projectDir, { recursive: true, force: true }))

function specDir() { return path.join(projectDir, 'doc', 'specs') }

function makeReadme(id: string, title: string, summary: string = `${title} concept summary`): string {
  return [
    '---',
    `id: ${id}`,
    'type: concept',
    `title: ${title}`,
    `summary: ${JSON.stringify(summary)}`,
    'status: draft',
    '---',
    '',
    `# ${title}`,
  ].join('\n')
}

function makeSpecYaml(id: string, title: string, summary: string = `${title} concept summary`): string {
  return [
    `id: ${id}`,
    `title: ${title}`,
    `summary: ${JSON.stringify(summary)}`,
    'status: draft',
    'views:',
    '  - type: overview',
    '    file: README.md',
  ].join('\n')
}

function makeConstraintsMd(conceptId: string, reqId: string = `${conceptId}-R-001`): string {
  const anchor = reqId.toLowerCase()
  return [
    '---',
    `concept: ${conceptId}`,
    'origin_rfc: RFC-TEST-001',
    '---',
    '',
    `### ${reqId} — Test requirement {#${anchor}}`,
    '',
    '**When** the system starts, `hooks/spec.mjs` **shall** do the thing.',
    '',
    '- **Why** — because it matters.',
    '- **Fit criterion** — the thing is done.',
    '- **Verification** automated · **Criticality** must · **Source** RFC-TEST-001',
  ].join('\n')
}

function runLint(dir: string = projectDir): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, GROUNDWORK_PROJECT_DIR: dir }
  delete env.CLAUDE_CODE_SESSION_ID
  try {
    const stdout = execFileSync('node', [LINT_MJS], { env, encoding: 'utf8' })
    return { code: 0, stdout, stderr: '' }
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

function runBuild(dir: string = projectDir): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir }
  delete env.CLAUDE_CODE_SESSION_ID
  try {
    const stdout = execFileSync('node', [SPEC_MJS, 'build'], { env, encoding: 'utf8' })
    return { code: 0, stdout, stderr: '' }
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

// ---------------------------------------------------------------------------
// Part A — summary mismatch caught with both paths named
// ---------------------------------------------------------------------------

describe('Part A: manifest-mismatch — both file paths named in error', () => {
  it('catches summary mismatch and names both file paths and values', () => {
    const sd = specDir()
    const conceptDir = path.join(sd, 'myfeature')
    mkdirSync(conceptDir, { recursive: true })

    // README.md has summary "Alpha"
    writeFileSync(path.join(conceptDir, 'README.md'), makeReadme('C-MYFEATURE', 'My Feature', 'Alpha'))
    // spec.yaml has summary "Beta" — mismatch
    writeFileSync(path.join(conceptDir, 'spec.yaml'), makeSpecYaml('C-MYFEATURE', 'My Feature', 'Beta'))

    // Build index first (mismatch is a lint-only check, build succeeds)
    const buildResult = runBuild()
    expect(buildResult.code).toBe(0)

    const result = runLint()

    expect(result.code).toBe(1)
    // Both file paths must appear in the output
    const specYamlPath = path.join(conceptDir, 'spec.yaml')
    const readmePath = path.join(conceptDir, 'README.md')
    expect(result.stdout).toContain(specYamlPath)
    expect(result.stdout).toContain(readmePath)
    // Both values must appear
    expect(result.stdout).toContain('"Alpha"')
    expect(result.stdout).toContain('"Beta"')
    // The violation type must be named
    expect(result.stdout).toContain('manifest-mismatch')
  })
})

// ---------------------------------------------------------------------------
// Part A — >25-word summary caught as summary-length violation
// ---------------------------------------------------------------------------

describe('Part A: summary-length — >25 words is rejected', () => {
  it('rejects a summary with 26 words', () => {
    const sd = specDir()
    mkdirSync(sd, { recursive: true })
    // 26 words
    const longSummary = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six'
    writeFileSync(path.join(sd, 'README.md'), makeReadme('C-ROOT', 'Root', longSummary))

    // Build index first (build does not check summary length)
    const buildResult = runBuild()
    expect(buildResult.code).toBe(0)

    const result = runLint()
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('summary-length')
    expect(result.stdout).toContain('26')
  })

  it('accepts a summary with exactly 25 words', () => {
    const sd = specDir()
    mkdirSync(sd, { recursive: true })
    // Exactly 25 words
    const exactSummary = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five'
    writeFileSync(path.join(sd, 'README.md'), makeReadme('C-ROOT', 'Root', exactSummary))

    runBuild()

    const result = runLint()
    // No summary-length violation (there may be other violations but not this one)
    expect(result.stdout).not.toContain('summary-length')
  })
})

// ---------------------------------------------------------------------------
// Part B — coverage.json contains by_concept with correct counts
// ---------------------------------------------------------------------------

describe('Part B: coverage.json by_concept', () => {
  it('emits by_concept mapping concept id to requirement count', () => {
    const sd = specDir()

    // Concept A with 2 requirements
    const dirA = path.join(sd, 'featurea')
    mkdirSync(dirA, { recursive: true })
    writeFileSync(path.join(dirA, 'README.md'), makeReadme('C-FEATUREA', 'Feature A'))
    writeFileSync(path.join(dirA, 'spec.yaml'), makeSpecYaml('C-FEATUREA', 'Feature A'))
    writeFileSync(
      path.join(dirA, 'constraints.md'),
      makeConstraintsMd('C-FEATUREA', 'C-FEATUREA-R-001') + '\n' + makeConstraintsMd('C-FEATUREA', 'C-FEATUREA-R-002'),
    )

    // Concept B with 1 requirement
    const dirB = path.join(sd, 'featureb')
    mkdirSync(dirB, { recursive: true })
    writeFileSync(path.join(dirB, 'README.md'), makeReadme('C-FEATUREB', 'Feature B'))
    writeFileSync(path.join(dirB, 'spec.yaml'), makeSpecYaml('C-FEATUREB', 'Feature B'))
    writeFileSync(path.join(dirB, 'constraints.md'), makeConstraintsMd('C-FEATUREB', 'C-FEATUREB-R-001'))

    const buildResult = runBuild()
    expect(buildResult.code).toBe(0)

    const coveragePath = path.join(projectDir, 'doc', 'specs', '_generated', 'coverage.json')
    expect(existsSync(coveragePath)).toBe(true)

    const coverage = JSON.parse(readFileSync(coveragePath, 'utf8'))
    expect(coverage).toHaveProperty('by_concept')
    expect(coverage.by_concept['C-FEATUREA']).toBe(2)
    expect(coverage.by_concept['C-FEATUREB']).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Part C — 3-level-deep concept tree indexes correctly
// ---------------------------------------------------------------------------

describe('Part C: nested concept tree (3 levels deep)', () => {
  it('indexes a 3-level nested concept tree correctly', () => {
    const sd = specDir()

    // Level 1: doc/specs/system/README.md  (C-SYSTEM)
    const systemDir = path.join(sd, 'system')
    mkdirSync(systemDir, { recursive: true })
    writeFileSync(path.join(systemDir, 'README.md'), makeReadme('C-SYSTEM', 'System'))
    writeFileSync(path.join(systemDir, 'spec.yaml'), makeSpecYaml('C-SYSTEM', 'System'))

    // Level 2: doc/specs/system/subsystem/README.md  (C-SUBSYSTEM)
    const subsysDir = path.join(systemDir, 'subsystem')
    mkdirSync(subsysDir, { recursive: true })
    writeFileSync(path.join(subsysDir, 'README.md'), makeReadme('C-SUBSYSTEM', 'Subsystem'))
    writeFileSync(path.join(subsysDir, 'spec.yaml'), makeSpecYaml('C-SUBSYSTEM', 'Subsystem'))

    // Level 3: doc/specs/system/subsystem/module/README.md  (C-MODULE)
    const moduleDir = path.join(subsysDir, 'module')
    mkdirSync(moduleDir, { recursive: true })
    writeFileSync(path.join(moduleDir, 'README.md'), makeReadme('C-MODULE', 'Module'))
    writeFileSync(path.join(moduleDir, 'spec.yaml'), makeSpecYaml('C-MODULE', 'Module'))
    // Requirements at level 3
    writeFileSync(path.join(moduleDir, 'constraints.md'), makeConstraintsMd('C-MODULE', 'C-MODULE-R-001'))

    const { nodes, errors } = buildIndexData(sd)

    // All three concept nodes must be present
    expect(Object.keys(nodes)).toContain('C-SYSTEM')
    expect(Object.keys(nodes)).toContain('C-SUBSYSTEM')
    expect(Object.keys(nodes)).toContain('C-MODULE')

    // The requirement must be present and associated with C-MODULE
    expect(Object.keys(nodes)).toContain('C-MODULE-R-001')
    const req = nodes['C-MODULE-R-001'] as any
    expect(req.type).toBe('requirement')
    expect(req.concept).toBe('C-MODULE')

    // No errors
    const criticalErrors = (errors as any[]).filter((e: any) => e.type !== 'unknown_frontmatter_field')
    expect(criticalErrors).toHaveLength(0)
  })

  it('spec build succeeds for a 3-level nested tree and reports all nodes', () => {
    const sd = specDir()

    const systemDir = path.join(sd, 'system')
    const subsysDir = path.join(systemDir, 'subsystem')
    const moduleDir = path.join(subsysDir, 'module')
    mkdirSync(moduleDir, { recursive: true })

    writeFileSync(path.join(systemDir, 'README.md'), makeReadme('C-SYSTEM', 'System'))
    writeFileSync(path.join(systemDir, 'spec.yaml'), makeSpecYaml('C-SYSTEM', 'System'))
    writeFileSync(path.join(subsysDir, 'README.md'), makeReadme('C-SUBSYSTEM', 'Subsystem'))
    writeFileSync(path.join(subsysDir, 'spec.yaml'), makeSpecYaml('C-SUBSYSTEM', 'Subsystem'))
    writeFileSync(path.join(moduleDir, 'README.md'), makeReadme('C-MODULE', 'Module'))
    writeFileSync(path.join(moduleDir, 'spec.yaml'), makeSpecYaml('C-MODULE', 'Module'))
    writeFileSync(path.join(moduleDir, 'constraints.md'), makeConstraintsMd('C-MODULE', 'C-MODULE-R-001'))

    const result = runBuild()
    expect(result.code).toBe(0)
    // Should report 4 nodes (3 concepts + 1 requirement) and 1 requirement
    expect(result.stdout).toContain('4 nodes')
    expect(result.stdout).toContain('1 requirement')
  })
})
