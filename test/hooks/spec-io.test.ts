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

import { pathToFileURL } from 'node:url'

const SPEC_IO = path.resolve(
  import.meta.dirname,
  '..', '..', 'hooks', 'lib', 'spec-io.mjs',
)

// Dynamic import resolves to ESM, which vitest supports.
const {
  parseRequirementsDocument,
  buildIndexData,
  ALLOWED_FRONTMATTER_FIELDS,
  isRequirementsDoc,
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
// Suite 5: ALLOWED_FRONTMATTER_FIELDS excludes ears and verify; includes D-15 fields
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

  it('includes D-15 RequirementSchema fields', () => {
    for (const field of ['ears_pattern', 'verification_method', 'design', 'source', 'verifies']) {
      expect(ALLOWED_FRONTMATTER_FIELDS.has(field), `expected D-15 field ${field} to be allowed`).toBe(true)
    }
  })

  it('includes D-15 ConceptIndexSchema fields', () => {
    for (const field of ['tags', 'aliases', 'depends_on', 'date_updated']) {
      expect(ALLOWED_FRONTMATTER_FIELDS.has(field), `expected D-15 field ${field} to be allowed`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Suite 5b: isRequirementsDoc — D-15 requirements/ subdir detection
// ---------------------------------------------------------------------------

describe('isRequirementsDoc — D-15 requirements/ subdir', () => {
  it('returns true for a file inside requirements/ subdir', () => {
    expect(isRequirementsDoc('enforcement/requirements/enforcement-r-001-something.md')).toBe(true)
  })

  it('returns true for requirements/ at root level', () => {
    expect(isRequirementsDoc('requirements/test-r-001.md')).toBe(true)
  })

  it('still returns true for monolithic constraints.md', () => {
    expect(isRequirementsDoc('artifact/constraints.md')).toBe(true)
  })

  it('still returns true for monolithic requirements.md', () => {
    expect(isRequirementsDoc('artifact/requirements.md')).toBe(true)
  })

  it('returns false for a file not in requirements/', () => {
    expect(isRequirementsDoc('enforcement/design/overview.md')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Suite 5c: extractAttributeLine — indented bullet (TRAP 1) and prose-quote (TRAP 2)
//
// T69 hardened the parser in two ways:
//   (a) Added ^ anchors to re1/re2v/re2c/re2s.
//   (b) Widened `bare` from `line.slice(2)` to `line.replace(/^\s*[-*]\s+/, '')`,
//       stripping any leading `<whitespace><bullet><space>` prefix, not just "- ".
//
// TRAP 1 tests (INDENTED_ATTRS fixture) are ANCHOR-REGRESSION GUARDS, not bite
// proofs.  The pre-T69 parser's unanchored re2v/re2c/re2s matched indented
// attribute bullets by accident — the regex found "**Verification**" mid-string
// even when `bare` left the leading "  - " in place.  So the old parser returned
// the correct value; these three tests pass against both the old and the new
// parser.  They exist solely to prevent a future regression where the ^ anchors
// are kept but the widened `bare` is reverted: without the whitespace strip,
// an indented bullet ("  - **Verification**: x") would not match the anchored
// regex and the field would be silently dropped.  They do NOT demonstrate that
// the pre-anchor parser was broken or that T69 fixed a pre-existing silent drop.
//
// TRAP 2 tests (PROSE_QUOTING_FORM1 fixture) are GENUINE bite proofs.  The
// pre-T69 unanchored re1 matched form-1 syntax quoted inside a **Why** bullet,
// returning source "R-FAKE`" (with trailing backtick).  The ^ anchor on re1
// prevents mid-string matching, so form-2 fields win and return "R-REAL".
//
// Corpus differential — 229 files (186 under doc/specs + 43 under test/),
// old parser (HEAD before T69) vs new parser (T69 working tree):
//   1 file differs:
//     doc/specs/spec-tooling/requirements/
//       spec-tooling-r-006-requirement-body-structure.md [SPEC-TOOLING-R-006]
//       verification: "`" -> "manual"
//       criticality:  "`" -> "must"
//   This is the TRAP 2 fix (anchored re1) firing on a real corpus file whose
//   **Why** bullet prose-quoted the form-1 attribute syntax in backticks.
//   All other 228 files produce identical output from the old and new parsers.
// ---------------------------------------------------------------------------

describe('extractAttributeLine — T69 parser hardening', () => {
  // Fixture: attribute fields appear as indented sub-bullets (two spaces + dash)
  const INDENTED_ATTRS = `---
concept: C-TEST
---

# Test

### TEST-R-001 — Indented attribute bullet {#test-r-001}

**When** something, the system **shall** do a thing.

- **Why** — because reasons.
- **Fit criterion** — it does the thing.
  - **Verification**: automated
  - **Criticality**: must
  - **Source**: R-TRAP1
`

  // These three tests are anchor-regression guards (see suite comment above).
  // They pass against both old and new parsers and do NOT bite against the
  // pre-anchor parser.  Their purpose: if a future change keeps ^ anchors on
  // re2v/re2c/re2s but reverts bare's whitespace strip, these turn red.
  it('TRAP 1 anchor-regression guard — indented Verification bullet still reaches anchored re2v', () => {
    const sections = parseRequirementsDocument(INDENTED_ATTRS)
    expect(sections).toHaveLength(1)
    expect(sections[0].verification).toBe('automated')
  })

  it('TRAP 1 anchor-regression guard — indented Criticality bullet still reaches anchored re2c', () => {
    const sections = parseRequirementsDocument(INDENTED_ATTRS)
    expect(sections[0].criticality).toBe('must')
  })

  it('TRAP 1 anchor-regression guard — indented Source bullet still reaches anchored re2s', () => {
    const sections = parseRequirementsDocument(INDENTED_ATTRS)
    expect(sections[0].source).toBe('R-TRAP1')
  })

  // Fixture: a **Why** bullet prose-quotes the form-1 syntax in backtick code;
  // the real attributes appear as form-2 bullets below.
  // TRAP 2: unanchored re1 would match mid-string inside the Why bullet,
  // returning the fake quoted value instead of the real form-2 attribute.
  const PROSE_QUOTING_FORM1 = `---
concept: C-TEST
---

# Test

### TEST-R-002 — Prose-quoted form-1 syntax {#test-r-002}

**When** something, the system **shall** do a thing.

- **Why** — the format \`**Verification** automated · **Criticality** must · **Source** R-FAKE\` is a valid attribute line.
- **Fit criterion** — it does the thing.
- **Verification**: real-automated
- **Criticality**: must
- **Source**: R-REAL
`

  it('TRAP 2 — does not miscapture prose-quoted form-1 syntax; returns real form-2 Source', () => {
    const sections = parseRequirementsDocument(PROSE_QUOTING_FORM1)
    expect(sections).toHaveLength(1)
    // Before the fix, re1 was unanchored and matched mid-string inside the Why bullet,
    // returning source 'R-FAKE`' (with trailing backtick). After the fix, form-2 wins.
    expect(sections[0].source).toBe('R-REAL')
  })

  it('TRAP 2 — does not miscapture prose-quoted form-1 syntax; returns real form-2 Verification', () => {
    const sections = parseRequirementsDocument(PROSE_QUOTING_FORM1)
    expect(sections[0].verification).toBe('real-automated')
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

// ---------------------------------------------------------------------------
// Suite 7: buildIndexData — D-15 individual requirement files in requirements/
// ---------------------------------------------------------------------------

const VALID_D15_REQ_FILE = `---
id: ENFORCEMENT-R-001
title: Nesting guard blocks depth-2 spawns
concept: C-ENFORCEMENT
criticality: must
verification: automated
---

## Statement

**When** a depth-1 junior-orchestrator attempts to spawn another
junior-orchestrator, the nesting-guard hook **shall** deny the spawn and
exit non-zero.

## Why

Unconstrained nesting depth defeats the delegation model and makes fan-out
analysis impossible.

## Fit criterion

Given a junior-orchestrator trying to spawn a junior-orchestrator, the hook
exits 1 and the outer task receives an error rather than a spawned child.

## Verification procedure

Run the nesting-guard hook with a synthetic payload simulating a depth-2
junior-orchestrator spawn and assert exit code 1.
`

describe('buildIndexData — D-15 individual requirement files', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'gw-spec-io-d15-'))
    writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }))
  })

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }))

  function specDir() {
    return path.join(tmpDir, 'doc', 'specs')
  }

  it('indexes a D-15 individual requirement file with correct id and type', () => {
    const conceptDir = path.join(specDir(), 'enforcement')
    const reqDir = path.join(conceptDir, 'requirements')
    mkdirSync(reqDir, { recursive: true })
    writeFileSync(path.join(conceptDir, 'index.md'), [
      '---',
      'id: C-ENFORCEMENT',
      'type: moc',
      'title: Enforcement',
      'summary: "Enforcement hooks."',
      'status: draft',
      '---',
      '',
      '# Enforcement',
    ].join('\n'))
    writeFileSync(path.join(reqDir, 'enforcement-r-001-nesting-guard.md'), VALID_D15_REQ_FILE)

    const { nodes, errors } = buildIndexData(specDir())
    expect(errors.filter((e: { type: string }) => e.type !== 'requirement_parse_error')).toHaveLength(0)
    expect(Object.keys(nodes)).toContain('ENFORCEMENT-R-001')
    expect(nodes['ENFORCEMENT-R-001'].type).toBe('requirement')
    expect(nodes['ENFORCEMENT-R-001'].title).toBe('Nesting guard blocks depth-2 spawns')
    expect(nodes['ENFORCEMENT-R-001'].verification).toBe('automated')
    expect(nodes['ENFORCEMENT-R-001'].criticality).toBe('must')
  })

  it('extracts normative statement from ## Statement section', () => {
    const conceptDir = path.join(specDir(), 'enforcement')
    const reqDir = path.join(conceptDir, 'requirements')
    mkdirSync(reqDir, { recursive: true })
    writeFileSync(path.join(conceptDir, 'index.md'), [
      '---', 'id: C-ENFORCEMENT', 'type: moc', 'title: Enforcement', '---', '',
    ].join('\n'))
    writeFileSync(path.join(reqDir, 'enforcement-r-001-nesting-guard.md'), VALID_D15_REQ_FILE)

    const { nodes } = buildIndexData(specDir())
    expect(nodes['ENFORCEMENT-R-001'].ears).toContain('**shall**')
  })

  it('emits error when D-15 file is missing ## Statement with **shall**', () => {
    const conceptDir = path.join(specDir(), 'enforcement')
    const reqDir = path.join(conceptDir, 'requirements')
    mkdirSync(reqDir, { recursive: true })
    writeFileSync(path.join(conceptDir, 'index.md'), [
      '---', 'id: C-ENFORCEMENT', 'type: moc', 'title: Enforcement', '---', '',
    ].join('\n'))
    writeFileSync(path.join(reqDir, 'enforcement-r-002-bad.md'), [
      '---',
      'id: ENFORCEMENT-R-002',
      'title: Bad requirement',
      '---',
      '',
      '## Why',
      '',
      'Because.',
      '',
      '## Fit criterion',
      '',
      'Passes.',
    ].join('\n'))

    const { errors } = buildIndexData(specDir())
    const parseErrors = errors.filter((e: { type: string }) => e.type === 'requirement_parse_error')
    expect(parseErrors.some((e: { message: string }) => e.message.includes('**shall**'))).toBe(true)
  })

  it('skips D-15 files without id frontmatter', () => {
    const conceptDir = path.join(specDir(), 'enforcement')
    const reqDir = path.join(conceptDir, 'requirements')
    mkdirSync(reqDir, { recursive: true })
    writeFileSync(path.join(conceptDir, 'index.md'), [
      '---', 'id: C-ENFORCEMENT', 'type: moc', 'title: Enforcement', '---', '',
    ].join('\n'))
    writeFileSync(path.join(reqDir, 'no-id.md'), '# Just markdown, no frontmatter id\n')

    const { nodes } = buildIndexData(specDir())
    // Only C-ENFORCEMENT should be indexed
    expect(Object.keys(nodes)).toEqual(['C-ENFORCEMENT'])
  })

  it('rejects unknown frontmatter fields in D-15 individual files', () => {
    const conceptDir = path.join(specDir(), 'enforcement')
    const reqDir = path.join(conceptDir, 'requirements')
    mkdirSync(reqDir, { recursive: true })
    writeFileSync(path.join(conceptDir, 'index.md'), [
      '---', 'id: C-ENFORCEMENT', 'type: moc', 'title: Enforcement', '---', '',
    ].join('\n'))
    writeFileSync(path.join(reqDir, 'enforcement-r-003-stale.md'), [
      '---',
      'id: ENFORCEMENT-R-003',
      'title: Stale',
      'ears: old stale field',
      '---',
      '',
      '## Statement',
      '',
      'The system **shall** do something.',
      '',
      '## Why',
      '',
      'Because.',
      '',
      '## Fit criterion',
      '',
      'It does the thing.',
    ].join('\n'))

    const { errors } = buildIndexData(specDir())
    const unknownErrors = errors.filter((e: { type: string }) => e.type === 'unknown_frontmatter_field')
    expect(unknownErrors.some((e: { field: string }) => e.field === 'ears')).toBe(true)
  })

  it('skips files in design/ subdirectory', () => {
    const conceptDir = path.join(specDir(), 'enforcement')
    const designDir = path.join(conceptDir, 'design')
    mkdirSync(designDir, { recursive: true })
    writeFileSync(path.join(conceptDir, 'index.md'), [
      '---', 'id: C-ENFORCEMENT', 'type: moc', 'title: Enforcement', '---', '',
    ].join('\n'))
    writeFileSync(path.join(designDir, 'overview.md'), [
      '# Design overview',
      '',
      'Some design content.',
    ].join('\n'))

    const { nodes } = buildIndexData(specDir())
    // design/overview.md has no id, so it should be skipped anyway; C-ENFORCEMENT indexed
    expect(Object.keys(nodes)).toContain('C-ENFORCEMENT')
    // no phantom node for the design file
    expect(Object.values(nodes).every((n: any) => n.relPath !== 'enforcement/design/overview.md')).toBe(true)
  })
})
