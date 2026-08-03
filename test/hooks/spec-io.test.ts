/**
 * Tests for hooks/lib/spec-io.mjs — RFC-0003 body-format changes.
 *
 * Covers:
 *   1. Valid new-format requirements document parses correctly
 *   2. `ears`/`verify` in frontmatter triggers unknown_frontmatter_field error
 *   3. A requirement missing its {#anchor} is detected
 *   4. A requirement missing **Why** or **Fit criterion** is detected
 *   5. The attribute line (Verification · Criticality · Source) parses correctly
 *   6. ALLOWED_FRONTMATTER_FIELDS excludes ears and verify
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// We use createRequire so we can import the .mjs module from TypeScript
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SPEC_IO = path.resolve(
  import.meta.dirname,
  '..', '..', 'hooks', 'lib', 'spec-io.mjs',
)

// Dynamic import resolves to ESM, which vitest supports.
const {
  parseRequirementsDocument,
  buildIndexData,
  ALLOWED_FRONTMATTER_FIELDS,
} = await import(pathToFileURL(SPEC_IO).href)

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const VALID_REQ_DOC = `---
concept: C-ARTIFACT
---

# Artifact Requirements

### ARTIFACT-R-001 — Ledger records slice completion {#artifact-r-001}

**When** a vertical slice is marked complete via the ledger CLI, \`hooks/ledger.mjs\`
**shall** persist the slice id, completion timestamp, and session id to
\`.groundwork/runs/<session_id>.json\`.

- **Why** — the Stop hook reads the ledger to gate session end; an entry without a
  session id cannot be attributed to the run that produced it.
- **Fit criterion** — after \`ledger complete s3\`, the \`s3\` entry carries non-null
  \`id\`, ISO-8601 \`completed_at\`, and \`session_id\` matching the completing session.
- **Verification** automated · **Criticality** must · **Source** R-20260726-K4M2QX
- **See also** [ARTIFACT-R-002](#artifact-r-002)

### ARTIFACT-R-002 — Index reflects all requirements {#artifact-r-002}

**When** the spec index is built, \`hooks/spec.mjs build\`
**shall** include every requirement found in any \`requirements.md\` file under \`doc/specs/\`.

- **Why** — an index that omits requirements is invisible to search and validation tools.
- **Fit criterion** — given a spec tree with N requirements, the generated index.json
  contains exactly N requirement entries.
- **Verification** automated · **Criticality** must · **Source** R-20260726-K4M2QX
`

// ---------------------------------------------------------------------------
// Suite 1: parseRequirementsDocument — valid document
// ---------------------------------------------------------------------------

describe('parseRequirementsDocument — valid document', () => {
  it('returns one section per H3 requirement heading', () => {
    const sections = parseRequirementsDocument(VALID_REQ_DOC)
    expect(sections).toHaveLength(2)
  })

  it('extracts id and title from H3 heading', () => {
    const [s1] = parseRequirementsDocument(VALID_REQ_DOC)
    expect(s1.id).toBe('ARTIFACT-R-001')
    expect(s1.title).toBe('Ledger records slice completion')
  })

  it('extracts anchor from {#anchor} in heading', () => {
    const [s1] = parseRequirementsDocument(VALID_REQ_DOC)
    expect(s1.anchor).toBe('artifact-r-001')
  })

  it('extracts normative statement containing **shall**', () => {
    const [s1] = parseRequirementsDocument(VALID_REQ_DOC)
    expect(s1.normativeStatement).toBeTruthy()
    expect(s1.normativeStatement).toContain('**shall**')
    expect(s1.normativeStatement).toContain('ledger.mjs')
  })

  it('extracts Why rationale', () => {
    const [s1] = parseRequirementsDocument(VALID_REQ_DOC)
    expect(s1.why).toBeTruthy()
    expect(s1.why).toContain('Stop hook')
  })

  it('extracts Fit criterion', () => {
    const [s1] = parseRequirementsDocument(VALID_REQ_DOC)
    expect(s1.fitCriterion).toBeTruthy()
    expect(s1.fitCriterion).toContain('ledger complete s3')
  })

  it('reports zero errors for a fully-valid section', () => {
    const sections = parseRequirementsDocument(VALID_REQ_DOC)
    for (const s of sections) {
      expect(s.errors, `section ${s.id} has errors: ${s.errors.join(', ')}`).toHaveLength(0)
    }
  })

  it('extracts cross-reference refs (See also links)', () => {
    const [s1] = parseRequirementsDocument(VALID_REQ_DOC)
    expect(s1.seeAlso).toContain('artifact-r-002')
  })

  it('extracts refs ID from section body', () => {
    const [s1] = parseRequirementsDocument(VALID_REQ_DOC)
    // ARTIFACT-R-002 appears in the See also link of s1
    expect(s1.refs).toContain('ARTIFACT-R-002')
  })
})

// ---------------------------------------------------------------------------
// Suite 2: parseRequirementsDocument — attribute line
// ---------------------------------------------------------------------------

describe('parseRequirementsDocument — attribute line', () => {
  it('parses Verification from attribute line', () => {
    const [s1] = parseRequirementsDocument(VALID_REQ_DOC)
    expect(s1.verification).toBe('automated')
  })

  it('parses Criticality from attribute line', () => {
    const [s1] = parseRequirementsDocument(VALID_REQ_DOC)
    expect(s1.criticality).toBe('must')
  })

  it('parses Source from attribute line', () => {
    const [s1] = parseRequirementsDocument(VALID_REQ_DOC)
    expect(s1.source).toBe('R-20260726-K4M2QX')
  })
})

// ---------------------------------------------------------------------------
// Suite 3: parseRequirementsDocument — missing anchor
// ---------------------------------------------------------------------------

describe('parseRequirementsDocument — missing anchor', () => {
  const WITHOUT_ANCHOR = `
### ARTIFACT-R-003 — Missing anchor heading

**When** something happens, the system **shall** do a thing.

- **Why** — because reasons.
- **Fit criterion** — it does the thing.
- **Verification** manual · **Criticality** should · **Source** R-TEST
`

  it('does not produce a section when the heading has no {#anchor}', () => {
    // A heading without {#anchor} doesn't match the heading regex; no section returned
    const sections = parseRequirementsDocument(WITHOUT_ANCHOR)
    expect(sections).toHaveLength(0)
  })

  it('detects anchor/id mismatch as an error', () => {
    const WRONG_ANCHOR = `
### ARTIFACT-R-003 — Title {#artifact-r-999}

**When** something happens, the system **shall** do a thing.

- **Why** — because reasons.
- **Fit criterion** — it does the thing.
- **Verification** manual · **Criticality** should · **Source** R-TEST
`
    const sections = parseRequirementsDocument(WRONG_ANCHOR)
    expect(sections).toHaveLength(1)
    expect(sections[0].errors.some((e: string) => e.includes('anchor'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Suite 4: parseRequirementsDocument — missing Why or Fit criterion
// ---------------------------------------------------------------------------

describe('parseRequirementsDocument — missing required bullets', () => {
  const WITHOUT_WHY = `
### ARTIFACT-R-004 — No Why {#artifact-r-004}

**When** something happens, the system **shall** do a thing.

- **Fit criterion** — it does the thing.
- **Verification** manual · **Criticality** should · **Source** R-TEST
`

  it('detects missing **Why** bullet', () => {
    const sections = parseRequirementsDocument(WITHOUT_WHY)
    expect(sections).toHaveLength(1)
    expect(sections[0].errors.some((e: string) => e.includes('Why'))).toBe(true)
  })

  const WITHOUT_FIT = `
### ARTIFACT-R-005 — No Fit {#artifact-r-005}

**When** something happens, the system **shall** do a thing.

- **Why** — because reasons.
- **Verification** manual · **Criticality** should · **Source** R-TEST
`

  it('detects missing **Fit criterion** bullet', () => {
    const sections = parseRequirementsDocument(WITHOUT_FIT)
    expect(sections).toHaveLength(1)
    expect(sections[0].errors.some((e: string) => e.includes('Fit criterion'))).toBe(true)
  })

  it('why is null when absent', () => {
    const sections = parseRequirementsDocument(WITHOUT_WHY)
    expect(sections[0].why).toBeNull()
  })

  it('fitCriterion is null when absent', () => {
    const sections = parseRequirementsDocument(WITHOUT_FIT)
    expect(sections[0].fitCriterion).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Suite 5: ALLOWED_FRONTMATTER_FIELDS excludes ears and verify
// ---------------------------------------------------------------------------

describe('ALLOWED_FRONTMATTER_FIELDS', () => {
  it('does not include ears', () => {
    expect(ALLOWED_FRONTMATTER_FIELDS.has('ears')).toBe(false)
  })

  it('does not include verify', () => {
    expect(ALLOWED_FRONTMATTER_FIELDS.has('verify')).toBe(false)
  })

  it('includes id, type, concept, parent, title, summary, origin_decision_ref, status, pattern, verification, criticality', () => {
    for (const field of ['id', 'type', 'concept', 'parent', 'title', 'summary', 'origin_decision_ref', 'status', 'pattern', 'verification', 'criticality']) {
      expect(ALLOWED_FRONTMATTER_FIELDS.has(field), `expected ${field} to be allowed`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Suite 6: buildIndexData — ears/verify in frontmatter rejected
// ---------------------------------------------------------------------------

describe('buildIndexData — unknown frontmatter fields rejected', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'gw-spec-io-'))
    writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }))
  })

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }))

  function specDir() {
    return path.join(tmpDir, 'doc', 'specs')
  }

  it('emits unknown_frontmatter_field error when ears: is in a README.md', () => {
    const dir = path.join(specDir(), 'artifact')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'README.md'), [
      '---',
      'id: C-ARTIFACT',
      'type: concept',
      'title: Artifact',
      'ears: The system shall do something.',
      '---',
      '',
      '# Artifact',
    ].join('\n'))

    const { errors } = buildIndexData(specDir())
    const unknownErrors = errors.filter((e: { type: string }) => e.type === 'unknown_frontmatter_field')
    expect(unknownErrors.length).toBeGreaterThan(0)
    expect(unknownErrors.some((e: { field: string }) => e.field === 'ears')).toBe(true)
  })

  it('emits unknown_frontmatter_field error when verify: is in a README.md', () => {
    const dir = path.join(specDir(), 'enforcement')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'README.md'), [
      '---',
      'id: C-ENFORCEMENT',
      'type: concept',
      'title: Enforcement',
      'verify: The system does the thing.',
      '---',
      '',
      '# Enforcement',
    ].join('\n'))

    const { errors } = buildIndexData(specDir())
    const unknownErrors = errors.filter((e: { type: string }) => e.type === 'unknown_frontmatter_field')
    expect(unknownErrors.some((e: { field: string }) => e.field === 'verify')).toBe(true)
  })

  it('emits unknown_frontmatter_field error when ears: is in a requirements.md frontmatter', () => {
    const dir = path.join(specDir(), 'artifact')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'README.md'), [
      '---',
      'id: C-ARTIFACT',
      'type: concept',
      'title: Artifact',
      '---',
      '',
      '# Artifact',
    ].join('\n'))
    writeFileSync(path.join(dir, 'requirements.md'), [
      '---',
      'ears: stale field',
      '---',
      '',
      '# Artifact Requirements',
    ].join('\n'))

    const { errors } = buildIndexData(specDir())
    const unknownErrors = errors.filter((e: { type: string }) => e.type === 'unknown_frontmatter_field')
    expect(unknownErrors.some((e: { field: string }) => e.field === 'ears')).toBe(true)
  })

  it('indexes a valid requirements.md with no errors', () => {
    const dir = path.join(specDir(), 'artifact')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'README.md'), [
      '---',
      'id: C-ARTIFACT',
      'type: concept',
      'title: Artifact',
      '---',
      '',
      '# Artifact',
    ].join('\n'))
    writeFileSync(path.join(dir, 'requirements.md'), VALID_REQ_DOC)

    const { nodes, errors } = buildIndexData(specDir())
    expect(errors).toHaveLength(0)
    expect(Object.keys(nodes)).toContain('ARTIFACT-R-001')
    expect(Object.keys(nodes)).toContain('ARTIFACT-R-002')
    expect(nodes['ARTIFACT-R-001'].type).toBe('requirement')
    expect(nodes['ARTIFACT-R-001'].ears).toContain('**shall**')
  })
})
