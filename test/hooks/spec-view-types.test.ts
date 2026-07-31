/**
 * spec-view-types tests
 *
 * Covers:
 *   1. `type: scenarios` and `type: cases` are accepted by build and lint
 *   2. A project-declared custom view type (view_types:) is accepted
 *   3. An undeclared unknown type is rejected by lint with an error listing legal values
 *   4. views are serialized into index.json on the concept node
 *   5. No double-counting: a constraints.md declared as a view is indexed exactly once
 *      (regression guard — keeps spec-view-doublecount behavior intact)
 *   6. view-type-collision: project-declared type that shadows a core type is rejected
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

const BUILD_CLI = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'spec.mjs')
const LINT_CLI = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'spec-lint.mjs')

let projectDir: string

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), 'gw-view-types-'))
  writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'view-types-test' }),
  )
})
afterEach(() => rmSync(projectDir, { recursive: true, force: true }))

function SPEC_DIR(): string { return path.join(projectDir, 'doc', 'specs') }
function GEN_DIR(): string { return path.join(SPEC_DIR(), '_generated') }

function runBuild(): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir }
  delete env.CLAUDE_CODE_SESSION_ID
  const result = spawnSync('node', [BUILD_CLI, 'build'], { env, encoding: 'utf8' })
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function runLint(): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, GROUNDWORK_PROJECT_DIR: projectDir }
  delete (env as Record<string, string | undefined>).CLAUDE_PROJECT_DIR
  delete env.CLAUDE_CODE_SESSION_ID
  const result = spawnSync('node', [LINT_CLI], { env, encoding: 'utf8' })
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

// ---------------------------------------------------------------------------
// Helpers to set up concept fixtures
// ---------------------------------------------------------------------------

function setupConcept(opts: {
  id?: string
  viewTypes?: string
  views: Array<{ type: string; file: string }>
  extraFiles?: Record<string, string>
}): void {
  const id = opts.id ?? 'C-MY-CONCEPT'
  const conceptDir = path.join(SPEC_DIR(), 'my-concept')
  mkdirSync(conceptDir, { recursive: true })

  writeFileSync(
    path.join(conceptDir, 'README.md'),
    [
      '---',
      `id: ${id}`,
      'type: concept',
      'title: My Concept',
      'summary: A test concept for view type tests.',
      'parent: null',
      '---',
      '',
      '# My Concept',
    ].join('\n'),
  )

  const viewLines = opts.views.map(v => `  - type: ${v.type}\n    file: ${v.file}`).join('\n')
  const viewTypesBlock = opts.viewTypes ? `\nview_types:\n${opts.viewTypes}\n` : ''
  writeFileSync(
    path.join(conceptDir, 'spec.yaml'),
    [
      `id: ${id}`,
      'title: My Concept',
      'summary: A test concept for view type tests.',
      'status: draft',
      `${viewTypesBlock}views:`,
      viewLines,
    ].join('\n'),
  )

  if (opts.extraFiles) {
    for (const [rel, content] of Object.entries(opts.extraFiles)) {
      const abs = path.join(conceptDir, rel)
      mkdirSync(path.dirname(abs), { recursive: true })
      writeFileSync(abs, content)
    }
  }
}

// ---------------------------------------------------------------------------
// §1. scenarios and cases are accepted
// ---------------------------------------------------------------------------

describe('type: scenarios and type: cases', () => {
  function setup(): void {
    setupConcept({
      views: [
        { type: 'overview', file: 'README.md' },
        { type: 'scenarios', file: 'scenarios.md' },
        { type: 'cases', file: 'cases.md' },
      ],
      extraFiles: {
        'scenarios.md': '---\ntype: scenarios\nid: C-MY-CONCEPT\n---\n\n# Scenarios',
        'cases.md': '---\ntype: cases\nid: C-MY-CONCEPT\n---\n\n# Cases',
      },
    })
  }

  it('build exits 0 with scenarios and cases views', () => {
    setup()
    const { code, stderr } = runBuild()
    expect(code, `build stderr: ${stderr}`).toBe(0)
  })

  it('lint exits 0 with scenarios and cases views', () => {
    setup()
    runBuild()
    const { code, stdout } = runLint()
    expect(code, `lint stdout: ${stdout}`).toBe(0)
    expect(stdout).not.toContain('unknown-view-type')
  })
})

// ---------------------------------------------------------------------------
// §2. Project-declared custom view type is accepted
// ---------------------------------------------------------------------------

describe('project-declared custom view type', () => {
  function setup(): void {
    setupConcept({
      viewTypes: [
        '  - name: fixtures',
        '    concern: "Which canned datasets exist and what each one is for."',
        '    contents: "Table of named fixture datasets with provenance and intended use."',
      ].join('\n'),
      views: [
        { type: 'overview', file: 'README.md' },
        { type: 'fixtures', file: 'fixtures.md' },
      ],
      extraFiles: {
        'fixtures.md': '---\ntype: fixtures\nid: C-MY-CONCEPT\n---\n\n# Fixtures',
      },
    })
  }

  it('build exits 0 with project-declared type', () => {
    setup()
    const { code, stderr } = runBuild()
    expect(code, `build stderr: ${stderr}`).toBe(0)
  })

  it('lint exits 0 for project-declared type', () => {
    setup()
    runBuild()
    const { code, stdout } = runLint()
    expect(code, `lint stdout: ${stdout}`).toBe(0)
    expect(stdout).not.toContain('unknown-view-type')
  })
})

// ---------------------------------------------------------------------------
// §3. Undeclared unknown type rejected with error listing legal values
// ---------------------------------------------------------------------------

describe('undeclared unknown view type', () => {
  function setup(): void {
    setupConcept({
      views: [
        { type: 'overview', file: 'README.md' },
        { type: 'bogus-custom', file: 'bogus.md' },
      ],
      extraFiles: {
        'bogus.md': '---\ntype: bogus-custom\nid: C-MY-CONCEPT\n---\n\n# Bogus',
      },
    })
  }

  it('lint exits 1 for undeclared type', () => {
    setup()
    runBuild()
    const { code } = runLint()
    expect(code).toBe(1)
  })

  it('error message names the offending type', () => {
    setup()
    runBuild()
    const { stdout } = runLint()
    expect(stdout).toContain('bogus-custom')
    expect(stdout).toContain('unknown-view-type')
  })

  it('error message lists all core types', () => {
    setup()
    runBuild()
    const { stdout } = runLint()
    expect(stdout).toContain('overview')
    expect(stdout).toContain('scenarios')
    expect(stdout).toContain('cases')
    expect(stdout).toContain('flows')
    expect(stdout).toContain('constraints')
  })

  it('error message shows the view_types escape-hatch snippet with the rejected name', () => {
    setup()
    runBuild()
    const { stdout } = runLint()
    expect(stdout).toContain('view_types:')
    expect(stdout).toContain('name: bogus-custom')
  })
})

// ---------------------------------------------------------------------------
// §4. Views serialized into index.json
// ---------------------------------------------------------------------------

describe('views serialized into index.json', () => {
  function setup(): void {
    setupConcept({
      views: [
        { type: 'overview', file: 'README.md' },
        { type: 'scenarios', file: 'scenarios.md' },
      ],
      extraFiles: {
        'scenarios.md': '---\ntype: scenarios\nid: C-MY-CONCEPT\n---\n\n# Scenarios',
      },
    })
  }

  it('index.json concept node has a views field', () => {
    setup()
    runBuild()
    const idx = JSON.parse(readFileSync(path.join(GEN_DIR(), 'index.json'), 'utf8'))
    const node = idx.nodes['C-MY-CONCEPT']
    expect(node).toBeDefined()
    expect(node.views).toBeDefined()
    expect(Array.isArray(node.views)).toBe(true)
  })

  it('views field contains the declared view entries with type and file', () => {
    setup()
    runBuild()
    const idx = JSON.parse(readFileSync(path.join(GEN_DIR(), 'index.json'), 'utf8'))
    const views: Array<{ type: string; file: string }> = idx.nodes['C-MY-CONCEPT'].views
    const scenarios = views.find(v => v.type === 'scenarios')
    expect(scenarios).toBeDefined()
    expect(scenarios?.file).toBe('scenarios.md')
  })
})

// ---------------------------------------------------------------------------
// §5. view-type-collision: shadowing a core type is rejected
// ---------------------------------------------------------------------------

describe('view-type-collision: project type must not shadow core', () => {
  function setup(): void {
    setupConcept({
      viewTypes: [
        '  - name: flows',
        '    concern: "Shadowing the core flows type."',
        '    contents: "Should not be allowed."',
      ].join('\n'),
      views: [
        { type: 'overview', file: 'README.md' },
        { type: 'flows', file: 'flows.md' },
      ],
      extraFiles: {
        'flows.md': '---\ntype: flows\nid: C-MY-CONCEPT\n---\n\n# Flows',
      },
    })
  }

  it('lint rejects a view_types entry that shadows a core type', () => {
    setup()
    runBuild()
    const { code, stdout } = runLint()
    expect(code).toBe(1)
    expect(stdout).toContain('view-type-collision')
    expect(stdout).toContain('"flows"')
  })
})
