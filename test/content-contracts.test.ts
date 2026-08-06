/**
 * Content contract tests — pinned against independent expected values.
 *
 * CONTRACT 1: RESOLVABLE_REF_RE (hooks/lib/motive-ticket-doc.mjs, D-81)
 *   Asserts accept/reject branches of the research-citation lint via the
 *   exported lintResearchCitation function. Both branches are exercised so
 *   the test bites (red→green sensitivity: removing a positive assertion
 *   in the accept cases, or flipping the false/true in the reject cases,
 *   will cause the test to fail).
 *
 * CONTRACT 2: D-82 provenance mandate in planner agent definitions
 *   Pins the D-82 mandate text in BOTH source trees (agents-src/planner.md
 *   and agents-pi/planner.md) against an independently hard-coded token list.
 *   Does NOT compare source against generated output — that would only prove
 *   consistency, not correctness (see memory: freshness-checks-prove-consistency-
 *   not-correctness). Optionally verifies the compiled mirror (agents/planner.md)
 *   carries the same tokens.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lintResearchCitation } from '../hooks/lib/motive-ticket-doc.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/, '')

function readSrc(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

/**
 * Build a minimal research-type ticket with the given evidence and links bodies.
 * All 7 required sections are present so the "empty section" lint cannot
 * interfere with the citation lint verdict.
 */
function researchTicket(evidenceBody: string, linksBody: string): string {
  return [
    '# Research: test fixture',
    'Type: research',
    'Status: open',
    'Blocked by: —',
    '',
    '## Question',
    'What is the contract?',
    '',
    '## Context',
    'Testing the RESOLVABLE_REF_RE contract.',
    '',
    '## Evidence',
    evidenceBody,
    '',
    '## Decision',
    'Pending.',
    '',
    '## Ruled out',
    'N/A.',
    '',
    '## Revisions',
    'None.',
    '',
    '## Links',
    linksBody,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// CONTRACT 1 — RESOLVABLE_REF_RE accept branches
//
// The regex accepts:
//   a) https?:// — http or https URL
//   b) \.\.?\/ — relative file paths (./ or ../)
//   c) (?:^|[ \t(["'])\/ — absolute path starting with /
//   d) \b[A-Z][A-Z0-9]*-R-\d+\b — doc/specs requirement id (e.g. ARTIFACT-R-012)
// ---------------------------------------------------------------------------

describe('RESOLVABLE_REF_RE — accept branches (D-81)', () => {
  it('accepts an https URL in Evidence', () => {
    const { pass } = lintResearchCitation(
      researchTicket('See https://example.com/primary-source for details.', ''),
    )
    // Red→green: if this assertion is removed the test no longer verifies accept
    expect(pass).toBe(true)
  })

  it('accepts an http URL in Evidence', () => {
    const { pass } = lintResearchCitation(
      researchTicket('Reference: http://internal.corp/docs/spec.html', ''),
    )
    expect(pass).toBe(true)
  })

  it('accepts a relative file path (./) in Evidence', () => {
    const { pass } = lintResearchCitation(
      researchTicket('File at ./doc/specs/artifact/requirements/r-007.md', ''),
    )
    expect(pass).toBe(true)
  })

  it('accepts a parent-relative file path (../) in Links', () => {
    const { pass } = lintResearchCitation(
      researchTicket('', '../hooks/lib/motive-ticket-doc.mjs'),
    )
    expect(pass).toBe(true)
  })

  it('accepts an absolute file path in Links', () => {
    const { pass } = lintResearchCitation(
      researchTicket('', '/home/newman/.local/share/groundwork/doc/specs/something.md'),
    )
    expect(pass).toBe(true)
  })

  it('accepts a doc/specs requirement id (ARTIFACT-R-012) as sole citation', () => {
    // This is the "requirement id" accept case explicitly listed in D-81
    const { pass } = lintResearchCitation(
      researchTicket('Grounded in ARTIFACT-R-012.', ''),
    )
    expect(pass).toBe(true)
  })

  it('accepts a requirement id in Links', () => {
    const { pass } = lintResearchCitation(
      researchTicket('', 'ORCHESTRATION-R-003'),
    )
    expect(pass).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// CONTRACT 1 — RESOLVABLE_REF_RE reject branches
//
// Prose-only content with no URL, file path, or requirement id MUST fail.
// These assertions probe the predicate from the other side so the test bites:
// if lintResearchCitation were changed to always return pass:true, these
// expectations would catch it.
// ---------------------------------------------------------------------------

describe('RESOLVABLE_REF_RE — reject branches (D-81)', () => {
  it('rejects prose-only Evidence with no resolvable reference', () => {
    const { pass, reason } = lintResearchCitation(
      researchTicket(
        'The analysis revealed several patterns across the team.',
        'See prior sections above for context.',
      ),
    )
    // Both sides must be asserted — the reject side proves the test bites
    expect(pass).toBe(false)
    expect(reason).toMatch(/resolvable reference/)
  })

  it('rejects a research ticket with empty Evidence and Links', () => {
    const { pass } = lintResearchCitation(researchTicket('', ''))
    expect(pass).toBe(false)
  })

  it('rejects text that contains a colon but no URL scheme (no http/https)', () => {
    // "source: the team agreed" looks URL-ish but is prose — must fail
    const { pass } = lintResearchCitation(
      researchTicket('source: the team agreed on the approach', 'context: see above'),
    )
    expect(pass).toBe(false)
  })

  it('rejects a lowercase requirement-id-shaped token (case-sensitive: must be uppercase)', () => {
    // artifact-r-012 (lowercase) must NOT match — the regex requires uppercase concept letters
    const { pass } = lintResearchCitation(
      researchTicket('grounded in artifact-r-012 (lowercase variant)', ''),
    )
    // The regex \b[A-Z][A-Z0-9]*-R-\d+\b requires uppercase — lowercase must fail
    expect(pass).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// CONTRACT 1 — lint verdict (pass/fail) through lintResearchCitation
// ---------------------------------------------------------------------------

describe('lintResearchCitation verdict — citation present vs absent (D-81)', () => {
  it('returns pass:true and reason:null when a URL citation is present', () => {
    const { pass, reason } = lintResearchCitation(
      researchTicket('See https://spec.example.org/v2 for the primary source.', ''),
    )
    expect(pass).toBe(true)
    expect(reason).toBeNull()
  })

  it('returns pass:false and a non-null reason string when no citation', () => {
    const { pass, reason } = lintResearchCitation(
      researchTicket('The team discussed this in the last sprint.', ''),
    )
    expect(pass).toBe(false)
    expect(typeof reason).toBe('string')
    expect(reason!.length).toBeGreaterThan(0)
  })

  it('non-research ticket (type: build) always passes regardless of citation absence', () => {
    const content = researchTicket('no refs at all', '').replace('Type: research', 'Type: build')
    const { pass, reason } = lintResearchCitation(content)
    expect(pass).toBe(true)
    expect(reason).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// CONTRACT 2 — D-82 provenance mandate pinned token list
//
// These tokens are INDEPENDENTLY hard-coded here (not read from the source
// and compared to itself). If the mandate is removed or its key phrases
// change, these tests catch it.
//
// Distinctive tokens required by the D-82 mandate:
//   - The mandate label: "D-82 provenance mandate"
//   - The instruction: "Tag every load-bearing premise"
//   - The three provenance token names: research:<ticket-id>, spec:<req-id>,
//     unverified-assumption
//   - The Wave-0 gate: "Wave-0 premise gate (D-82)"
// ---------------------------------------------------------------------------

const D82_REQUIRED_TOKENS = [
  'D-82 provenance mandate',
  'Tag every load-bearing premise',
  'research:<ticket-id>',
  'spec:<req-id>',
  'unverified-assumption',
  'Wave-0 premise gate (D-82)',
] as const

describe('D-82 provenance mandate — agents-src/planner.md', () => {
  const content = readSrc('agents-src/planner.md')

  for (const token of D82_REQUIRED_TOKENS) {
    it(`contains required token: "${token}"`, () => {
      expect(content).toContain(token)
    })
  }

  it('contains Phase 0 context intake section', () => {
    // D-83: Phase 0 runs BEFORE any decomposition
    expect(content).toContain('Phase 0: Context Intake')
    expect(content).toContain('runs BEFORE any decomposition')
  })
})

describe('D-82 provenance mandate — agents-pi/planner.md (overlay tree)', () => {
  const content = readSrc('agents-pi/planner.md')

  for (const token of D82_REQUIRED_TOKENS) {
    it(`contains required token: "${token}"`, () => {
      expect(content).toContain(token)
    })
  }

  it('contains Phase 0 context intake section', () => {
    expect(content).toContain('Phase 0: Context Intake')
    expect(content).toContain('runs BEFORE any decomposition')
  })
})

describe('D-82 provenance mandate — agents/planner.md (compiled mirror)', () => {
  const content = readSrc('agents/planner.md')

  for (const token of D82_REQUIRED_TOKENS) {
    it(`contains required token: "${token}"`, () => {
      // The compiled mirror must carry the same mandate; if the generator
      // drops it, this catches it independently of the source assertion.
      expect(content).toContain(token)
    })
  }
})
