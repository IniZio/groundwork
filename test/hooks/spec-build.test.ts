/**
 * spec-build tests — covers the RFC-0003 body-first index generation format.
 *
 * 1. index.md contains a full untruncated normative statement for a requirement
 * 2. index.md links use the ../concept-dir/requirements.md#anchor form
 * 3. index.json includes the new body-derived fields (anchor, why, fitCriterion, source)
 * 4. A requirement node with no anchor surfaces an error on stderr and is omitted
 *    from index.md rather than emitting a broken link
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
  projectDir = mkdtempSync(path.join(tmpdir(), 'gw-spec-build-'))
  writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'build-test' }),
  )
})
afterEach(() => rmSync(projectDir, { recursive: true, force: true }))

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir }
  delete env.CLAUDE_CODE_SESSION_ID
  // Use spawnSync so stderr is always captured regardless of exit code
  const result = spawnSync('node', [CLI, ...args], { env, encoding: 'utf8' })
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

const SPEC_DIR = () => path.join(projectDir, 'doc', 'specs')
const GEN_DIR = () => path.join(projectDir, 'doc', 'specs', '_generated')

function mkSpec() {
  mkdirSync(SPEC_DIR(), { recursive: true })
}

function writeReadme(relDir: string, id: string, title = 'Test Concept') {
  const dir = path.join(SPEC_DIR(), relDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, 'README.md'),
    [
      '---',
      `id: ${id}`,
      'type: concept',
      `title: ${title}`,
      'parent: null',
      '---',
      '',
      `# ${title}`,
      '',
    ].join('\n'),
  )
}

/**
 * Write a requirements.md file in the RFC-0003 body-first format (H3 sections).
 * The file is placed at SPEC_DIR/relDir/requirements.md.
 * fileFrontmatter is written as-is (no quoting); concept: C-XXX is typical.
 */
function writeRequirementsMd(
  relDir: string,
  requirements: Array<{
    id: string
    title: string
    anchor: string
    normative: string
    why?: string
    fitCriterion?: string
    verification?: string
    criticality?: string
    source?: string
  }>,
  fileFrontmatter: Record<string, string> = {},
) {
  const dir = path.join(SPEC_DIR(), relDir)
  mkdirSync(dir, { recursive: true })

  const fmLines = Object.entries(fileFrontmatter).map(([k, v]) => `${k}: ${v}`)
  const header = fmLines.length ? `---\n${fmLines.join('\n')}\n---\n\n` : ''

  const sections = requirements.map(req =>
    [
      `### ${req.id} — ${req.title} {#${req.anchor}}`,
      '',
      req.normative,
      '',
      `- **Why** — ${req.why ?? 'Required for correctness.'}`,
      `- **Fit criterion** — ${req.fitCriterion ?? 'Observable in output.'}`,
      `- **Verification** ${req.verification ?? 'automated'} · **Criticality** ${req.criticality ?? 'must'}${req.source ? ` · **Source** ${req.source}` : ''}`,
      '',
    ].join('\n'),
  )

  writeFileSync(
    path.join(dir, 'requirements.md'),
    header + sections.join('\n---\n\n'),
    'utf8',
  )
}

// ---------------------------------------------------------------------------
// Test 1: index.md — full untruncated normative statement
// ---------------------------------------------------------------------------

describe('index.md — full normative statement (no truncation)', () => {
  it('emits the complete normative statement without ellipsis', () => {
    mkSpec()
    writeReadme('', 'C-TRUNC', 'Truncation Test Concept')

    // A normative statement well over 80 chars — previously would be cut with "…"
    const longNormative =
      '**When** a very long normative statement spanning far beyond the old eighty-character table cell limit is present, the index **shall** include every word of the statement exactly as authored.'

    writeRequirementsMd(
      'requirements',
      [
        {
          id: 'TRUNC-R-001',
          title: 'Long normative statement preserved',
          anchor: 'trunc-r-001',
          normative: longNormative,
        },
      ],
      { concept: 'C-TRUNC' },
    )

    const r = run(['build'])
    expect(r.code, `stderr: ${r.stderr}`).toBe(0)

    const md = readFileSync(path.join(GEN_DIR(), 'index.md'), 'utf8')

    // The full normative statement must appear verbatim
    expect(md).toContain(longNormative)

    // No ellipsis truncation anywhere in the file
    expect(md).not.toContain('…')
  })
})

// ---------------------------------------------------------------------------
// Test 2: index.md — anchor link format
// ---------------------------------------------------------------------------

describe('index.md — anchor link format', () => {
  it('emits links in the form ../concept-dir/requirements.md#anchor', () => {
    mkSpec()
    writeReadme('myfeature', 'C-MYFEATURE', 'My Feature')
    writeRequirementsMd(
      'myfeature',
      [
        {
          id: 'MYFEATURE-R-001',
          title: 'First requirement',
          anchor: 'myfeature-r-001',
          normative: '**When** invoked, the system **shall** respond correctly.',
        },
      ],
      { concept: 'C-MYFEATURE' },
    )

    const r = run(['build'])
    expect(r.code, `stderr: ${r.stderr}`).toBe(0)

    const md = readFileSync(path.join(GEN_DIR(), 'index.md'), 'utf8')

    // Link must use the ../relPath#anchor form (relative from _generated/ to spec root)
    expect(md).toContain('../myfeature/requirements.md#myfeature-r-001')

    // Must not use a bare fragment anchor (which would be a same-page link, not a cross-file link)
    expect(md).not.toMatch(/\]\(#myfeature-r-001\)/)
  })

  it('links are grouped under the concept name as a section heading', () => {
    mkSpec()
    writeReadme('alpha', 'C-ALPHA', 'Alpha Module')
    writeRequirementsMd(
      'alpha',
      [
        {
          id: 'ALPHA-R-001',
          title: 'Alpha requirement',
          anchor: 'alpha-r-001',
          normative: '**When** called, the system **shall** do alpha.',
        },
      ],
      { concept: 'C-ALPHA' },
    )

    const r = run(['build'])
    expect(r.code, `stderr: ${r.stderr}`).toBe(0)

    const md = readFileSync(path.join(GEN_DIR(), 'index.md'), 'utf8')

    // The concept name must appear as a section heading
    expect(md).toMatch(/^## Alpha Module/m)

    // The requirement must appear under it
    const conceptIdx = md.indexOf('## Alpha Module')
    const reqIdx = md.indexOf('ALPHA-R-001')
    expect(reqIdx).toBeGreaterThan(conceptIdx)
  })
})

// ---------------------------------------------------------------------------
// Test 3: index.json — new body-derived fields
// ---------------------------------------------------------------------------

describe('index.json — body-derived fields present', () => {
  it('includes anchor, why, fitCriterion, and source on requirement nodes', () => {
    mkSpec()
    writeReadme('', 'C-FIELDS', 'Fields Test Concept')
    writeRequirementsMd(
      'requirements',
      [
        {
          id: 'FIELDS-R-001',
          title: 'Body fields test requirement',
          anchor: 'fields-r-001',
          normative:
            '**When** the build runs, the system **shall** emit all body-derived fields in index.json.',
          why: 'Downstream consumers need the rationale to understand context.',
          fitCriterion:
            'The index.json node for FIELDS-R-001 contains non-null why and fitCriterion.',
          verification: 'automated',
          criticality: 'must',
          source: 'RFC-0003',
        },
      ],
      { concept: 'C-FIELDS' },
    )

    const r = run(['build'])
    expect(r.code, `stderr: ${r.stderr}`).toBe(0)

    const idx = JSON.parse(readFileSync(path.join(GEN_DIR(), 'index.json'), 'utf8'))
    const node = idx.nodes['FIELDS-R-001']
    expect(node).toBeDefined()

    // anchor must match the {#...} value from the heading
    expect(node.anchor).toBe('fields-r-001')

    // why must contain the rationale text
    expect(node.why).toContain('rationale')

    // fitCriterion must contain the criterion text
    expect(node.fitCriterion).toContain('non-null')

    // source must be the RFC identifier from the attribute line
    expect(node.source).toBe('RFC-0003')
  })

  it('concept nodes have null anchor (anchor is a body-only field)', () => {
    mkSpec()
    writeReadme('', 'C-CONCEPTONLY', 'Concept Only')

    const r = run(['build'])
    expect(r.code, `stderr: ${r.stderr}`).toBe(0)

    const idx = JSON.parse(readFileSync(path.join(GEN_DIR(), 'index.json'), 'utf8'))
    const conceptNode = idx.nodes['C-CONCEPTONLY']
    expect(conceptNode).toBeDefined()
    // Concepts have no body anchor; must be null (not undefined, not a broken value)
    expect(conceptNode.anchor).toBeNull()
    expect(conceptNode.why).toBeNull()
    expect(conceptNode.fitCriterion).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Test 4b: coverage.json — verified / unverified_automated / by_requirement
// ---------------------------------------------------------------------------

describe('coverage.json — actual verification fields', () => {
  it('sets verified=true and tests list when a @verifies annotation exists', () => {
    mkSpec()
    writeReadme('', 'C-COV', 'Coverage Test Concept')
    writeRequirementsMd(
      'requirements',
      [
        {
          id: 'COV-R-001',
          title: 'Covered requirement',
          anchor: 'cov-r-001',
          normative: '**When** tested, the system **shall** be annotated.',
          verification: 'automated',
          criticality: 'must',
          source: 'RFC-TEST',
        },
      ],
      { concept: 'C-COV' },
    )

    // Write a fake test file with a @verifies annotation
    mkdirSync(path.join(projectDir, 'test'), { recursive: true })
    writeFileSync(
      path.join(projectDir, 'test', 'example.test.ts'),
      '// @verifies COV-R-001\nit("does stuff", () => {})\n',
      'utf8',
    )

    const r = run(['build'])
    expect(r.code, `stderr: ${r.stderr}`).toBe(0)

    const cov = JSON.parse(readFileSync(path.join(GEN_DIR(), 'coverage.json'), 'utf8'))

    // verified count must be 1
    expect(cov.verified).toBe(1)

    // unverified_automated must be empty
    expect(cov.unverified_automated).toEqual([])

    // by_requirement must reflect the annotation
    expect(cov.by_requirement['COV-R-001']).toMatchObject({
      declared: 'automated',
      verified: true,
    })
    expect(cov.by_requirement['COV-R-001'].tests).toContain('test/example.test.ts')
  })

  it('lists automated requirements without @verifies in unverified_automated', () => {
    mkSpec()
    writeReadme('', 'C-UNGAP', 'Ungapped Concept')
    writeRequirementsMd(
      'requirements',
      [
        {
          id: 'UNGAP-R-001',
          title: 'Untested automated requirement',
          anchor: 'ungap-r-001',
          normative: '**When** not annotated, the system **shall** be listed as a gap.',
          verification: 'automated',
          criticality: 'must',
          source: 'RFC-TEST',
        },
        {
          id: 'UNGAP-R-002',
          title: 'Manual requirement — not a gap',
          anchor: 'ungap-r-002',
          normative: '**When** manually reviewed, the system **shall** be accepted.',
          verification: 'manual',
          criticality: 'should',
          source: 'RFC-TEST',
        },
      ],
      { concept: 'C-UNGAP' },
    )

    // No test files with @verifies annotations

    const r = run(['build'])
    expect(r.code, `stderr: ${r.stderr}`).toBe(0)

    const cov = JSON.parse(readFileSync(path.join(GEN_DIR(), 'coverage.json'), 'utf8'))

    // Only the automated one should appear in the gap list
    expect(cov.unverified_automated).toContain('UNGAP-R-001')
    expect(cov.unverified_automated).not.toContain('UNGAP-R-002')

    // Manual requirement should show declared=manual and verified=false (no test)
    expect(cov.by_requirement['UNGAP-R-002']).toMatchObject({
      declared: 'manual',
      verified: false,
      tests: [],
    })

    expect(cov.verified).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Test 4: missing anchor — error on stderr, no broken link in index.md
// ---------------------------------------------------------------------------

describe('missing anchor — error surfaced, requirement omitted from index.md', () => {
  it('reports the requirement on stderr and omits it from index.md', () => {
    mkSpec()
    writeReadme('', 'C-NOANCHOR', 'No Anchor Concept')

    // Write an old-format requirement file (not requirements.md).
    // Such files produce a requirement node via frontmatter parsing, but they have
    // no anchor field (anchor is a body-only construct for requirements.md sections).
    mkdirSync(path.join(SPEC_DIR(), 'requirements'), { recursive: true })
    writeFileSync(
      path.join(SPEC_DIR(), 'requirements', 'old-format-req.md'),
      [
        '---',
        'id: NOANCHOR-R-001',
        'concept: C-NOANCHOR',
        'type: requirement',
        'status: active',
        'verification: automated',
        'criticality: must',
        '---',
        '',
        '# Old format requirement',
        '',
      ].join('\n'),
    )

    const r = run(['build'])
    // Build must still succeed (missing anchor is non-blocking)
    expect(r.code, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0)

    const md = readFileSync(path.join(GEN_DIR(), 'index.md'), 'utf8')

    // The requirement must NOT appear as a link in index.md (no broken link)
    expect(md).not.toContain('NOANCHOR-R-001')

    // Stderr must report the omission and name the requirement and the reason
    expect(r.stderr).toContain('NOANCHOR-R-001')
    expect(r.stderr).toContain('anchor')
  })
})
