/**
 * T28 (D-18/D-13): CLAUDE.md token-count ceiling.
 *
 * Baseline measured 2026-09-08 via tiktoken cl100k_base: 9383 tokens.
 * estimateTokens (ceil(utf8bytes/3.5)) at the same snapshot: 11192.
 * The ceiling is set to 11192 using the project's own estimator so this
 * test runs without a Python tiktoken dependency.
 *
 * A failure means CLAUDE.md grew past the T28 baseline — audit and prune.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { estimateTokens } from '../hooks/lib/doc-io.mjs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/, '')

const CLAUDE_MD_TOKEN_CEILING = 11192

describe('CLAUDE.md token ceiling — T28 (D-18/D-13)', () => {
  it(`estimated tokens <= ${CLAUDE_MD_TOKEN_CEILING} (tiktoken baseline 9383)`, () => {
    const content = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
    const estimated = estimateTokens(content)
    expect(estimated).toBeLessThanOrEqual(CLAUDE_MD_TOKEN_CEILING)
  })
})
