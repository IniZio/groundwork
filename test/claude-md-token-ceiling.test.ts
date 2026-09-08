/**
 * T28 (D-18/D-13): CLAUDE.md token-count ceiling.
 *
 * Baseline re-measured 2026-09-08 via tiktoken cl100k_base: 9607 tokens.
 * estimateTokens (ceil(utf8bytes/3.5)) at the same snapshot: 11494.
 * The ceiling is set to 11494 using the project's own estimator so this
 * test runs without a Python tiktoken dependency.
 *
 * The ~1.19 ratio between estimator and tiktoken is a unit-conversion ratio
 * between the two measurement methods — NOT a growth allowance or headroom.
 *
 * Ceiling history:
 *   11192 → 11494 on 2026-09-08: admitted the "Acceptance criteria are
 *   withdrawn, never rewritten" rule in ## Mandatory completion flow
 *   (+302 estimator tokens). The rule passed an advisor gate before insertion;
 *   the raise was authorized by the operator, not taken by an agent.
 *
 * A failure means CLAUDE.md grew past the baseline — audit and prune.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { estimateTokens } from '../hooks/lib/doc-io.mjs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/, '')

const CLAUDE_MD_TOKEN_CEILING = 11494

describe('CLAUDE.md token ceiling — T28 (D-18/D-13)', () => {
  it(`estimated tokens <= ${CLAUDE_MD_TOKEN_CEILING} (tiktoken baseline 9607)`, () => {
    const content = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
    const estimated = estimateTokens(content)
    expect(estimated).toBeLessThanOrEqual(CLAUDE_MD_TOKEN_CEILING)
  })
})
