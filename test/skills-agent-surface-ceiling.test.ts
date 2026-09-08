/**
 * T34 (token-economy / lever-3 / AC-8): Skills+agent description surface ceiling.
 * Baseline 2026-09-08: tiktoken cl100k_base 1316 tokens; estimateTokens 1810.
 * Ceiling is 1810 (snapshot value, zero slack — T28's design: no growth headroom).
 * The 1.19 figure in T28's docblock is the estimator-vs-tiktoken conversion ratio
 * (11192/9383), NOT a growth allowance. Full breakdown: token-economy-r-011.
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
