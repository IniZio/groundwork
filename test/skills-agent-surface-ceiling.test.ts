/**
 * T34 (token-economy / lever-3 / AC-8): Skills+agent description surface ceiling.
 *
 * Baseline measured 2026-09-08 via tiktoken cl100k_base across:
 *   - skills/groundwork/** (24 skills, excl. .codex-overlays): 805 tokens
 *   - agents-src/*.md (12 agents):                             511 tokens
 *   - Combined tiktoken total:                                1316 tokens
 *   - estimateTokens (ceil(utf8bytes/3.5)) at same snapshot:  1810
 *
 * Ceiling is 1810 — the current estimateTokens value — following T28's design
 * exactly: the ceiling IS the snapshot value, with zero added slack. The 1.19
 * figure in T28's docblock is the estimator-vs-tiktoken conversion ratio
 * (11192 / 9383) recorded for provenance; it is NOT a growth allowance.
 *
 * Full surface breakdown (tiktoken cl100k_base, 2026-09-08):
 *   skills+agents (groundwork-controlled): 1316 tok  (26.5%)
 *   MCP tool names (162 tools):            1880 tok  (37.8%) — not owned here
 *   MCP server instructions:               1004 tok  (20.2%) — not owned here
 *   Other plugin skills (23):               766 tok  (15.4%) — not owned here
 *   Total measured surface:               ~4972 tok
 *
 * Honest reduction verdict: ZERO tokens removed. Every description is at
 * minimum viable size — "Triggers on:" suffixes carry routing keywords and
 * agent descriptions carry behavioral constraints. D-14 estimated ~750-950
 * reducible tokens; the actual reducible amount is 0 (honest negative).
 *
 * @verifies token-economy-r-011
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { join } from 'node:path'
import { estimateTokens } from '../hooks/lib/doc-io.mjs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/, '')

function parseFrontmatterField(content: string, field: string): string | null {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!fmMatch) return null
  const vm = fmMatch[1].match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))
  return vm ? vm[1].trim() : null
}

function buildListing(paths: string[]): string {
  let text = ''
  for (const p of paths) {
    const content = readFileSync(p, 'utf8')
    const name = parseFrontmatterField(content, 'name')
    const desc = parseFrontmatterField(content, 'description')
    if (name && desc) text += `- ${name}: ${desc}\n`
  }
  return text
}

const SKILLS_AGENT_SURFACE_CEILING = 1810 // estimateTokens snapshot 2026-09-08; tiktoken baseline 1316

describe('Skills+agent description surface ceiling — T34 (token-economy lever-3)', () => {
  it(`combined estimateTokens <= ${SKILLS_AGENT_SURFACE_CEILING} (tiktoken baseline 1316)`, () => {
    const skillPaths = globSync('skills/groundwork/**/SKILL.md', { cwd: ROOT })
      .map(p => join(ROOT, p))
      .filter(p => !p.includes('/.codex-overlays/'))
      .sort()

    const agentPaths = globSync('agents-src/*.md', { cwd: ROOT })
      .map(p => join(ROOT, p))
      .sort()

    const combined = buildListing(skillPaths) + buildListing(agentPaths)
    const estimated = estimateTokens(combined)

    expect(skillPaths.length, 'skills/groundwork glob returned no files').toBeGreaterThanOrEqual(20)
    expect(agentPaths.length, 'agents-src glob returned no files').toBeGreaterThanOrEqual(10)
    expect(
      estimated,
      `Skills+agent listing grew past ceiling (${estimated} > ${SKILLS_AGENT_SURFACE_CEILING}). ` +
      `Audit recent description additions in skills/groundwork/**/SKILL.md and agents-src/*.md.`,
    ).toBeLessThanOrEqual(SKILLS_AGENT_SURFACE_CEILING)
  })
})
