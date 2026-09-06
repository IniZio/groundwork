/**
 * test/hooks/advisor-density-gate.test.ts
 *
 * Verifies that the comment-density gate is wired into the advisor's
 * Verification Protocol (agents-src/advisor.md) and the advisor-gate skill
 * (skills/groundwork/advisor-gate/SKILL.md), and that generated mirrors carry
 * the same comment-density wording as their authority sources.
 *
 * Acceptance criteria covered: AC-3 (APPROVE block), AC-10 (haiku dispatch).
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

const ADVISOR_SRC = join(REPO_ROOT, 'agents-src', 'advisor.md')
const ADVISOR_MIRROR = join(REPO_ROOT, 'agents', 'advisor.md')
const SKILL_SRC = join(REPO_ROOT, 'skills', 'groundwork', 'advisor-gate', 'SKILL.md')
const SKILL_MIRROR = join(REPO_ROOT, 'skills', 'advisor-gate', 'SKILL.md')

const advisorSrc = readFileSync(ADVISOR_SRC, 'utf8')
const advisorMirror = readFileSync(ADVISOR_MIRROR, 'utf8')
const skillSrc = readFileSync(SKILL_SRC, 'utf8')
const skillMirror = readFileSync(SKILL_MIRROR, 'utf8')

// Key sentence that must appear identically in source and mirror
const REPORT_INVOCATION = 'comment-density report --json'
const REMEDIATE_INVOCATION = 'comment-density remediate-plan'
const APPROVE_BLOCK = 'APPROVE is blocked while any flagged file has no registered cleanup slice'

describe('comment-density gate — advisor protocol wiring', () => {
  it('agents/advisor.md mirror carries comment-density report --json', () => {
    expect(advisorMirror).toContain(REPORT_INVOCATION)
  })

  it('skills/advisor-gate/SKILL.md mirror carries APPROVE-refusal sentence', () => {
    expect(skillMirror).toContain(APPROVE_BLOCK)
  })

  it('advisor.md invokes comment-density report --json', () => {
    expect(advisorSrc).toContain('comment-density report --json')
  })

  it('advisor.md invokes comment-density remediate-plan', () => {
    expect(advisorSrc).toContain('comment-density remediate-plan')
  })

  it('advisor.md blocks APPROVE while any flagged file has no cleanup slice', () => {
    expect(advisorSrc).toContain(
      'APPROVE is blocked while any flagged file has no registered cleanup slice',
    )
  })

  it('advisor-gate SKILL.md invokes comment-density report --json', () => {
    expect(skillSrc).toContain('comment-density report --json')
  })

  it('advisor-gate SKILL.md invokes comment-density remediate-plan', () => {
    expect(skillSrc).toContain('comment-density remediate-plan')
  })

  it('advisor-gate SKILL.md blocks APPROVE while any flagged file has no cleanup slice', () => {
    expect(skillSrc).toContain(
      'APPROVE is blocked while any flagged file has no registered cleanup slice',
    )
  })
})
