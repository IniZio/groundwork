import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

const ADVISOR_SRC = join(REPO_ROOT, 'agents-src', 'advisor.md')
const SKILL_SRC = join(REPO_ROOT, 'skills', 'groundwork', 'advisor-gate', 'SKILL.md')

const ADVISOR_MIRROR = join(REPO_ROOT, 'agents', 'advisor.md')
const ADVISOR_PI_MIRROR = join(REPO_ROOT, 'agents-pi', 'advisor.md')
const SKILL_MIRROR = join(REPO_ROOT, 'skills', 'advisor-gate', 'SKILL.md')
const AGENT_DEFS_MIRROR = join(REPO_ROOT, 'src', 'lib', 'agent-definitions.generated.ts')

const advisorSrc = readFileSync(ADVISOR_SRC, 'utf8')
const skillSrc = readFileSync(SKILL_SRC, 'utf8')
const advisorMirror = readFileSync(ADVISOR_MIRROR, 'utf8')
const advisorPiMirror = readFileSync(ADVISOR_PI_MIRROR, 'utf8')
const skillMirror = readFileSync(SKILL_MIRROR, 'utf8')
const agentDefsMirror = readFileSync(AGENT_DEFS_MIRROR, 'utf8')

const REPORT_INVOCATION = 'comment-density report --json'
const PIPE_INVOCATION = 'comment-density report --json | bin/gw-hook comment-density remediate-plan'
const APPROVE_BLOCK = 'APPROVE is blocked while any flagged file has no registered cleanup slice'

describe('comment-density gate — advisor protocol wiring', () => {
  it('advisor.md (src) invokes comment-density report --json', () => {
    expect(advisorSrc).toContain(REPORT_INVOCATION)
  })

  it('advisor.md (src) uses pipe invocation for remediate-plan', () => {
    expect(advisorSrc).toContain(PIPE_INVOCATION)
  })

  it('advisor.md (src) blocks APPROVE while any flagged file has no cleanup slice', () => {
    expect(advisorSrc).toContain(APPROVE_BLOCK)
  })

  it('advisor-gate SKILL.md (src) invokes comment-density report --json', () => {
    expect(skillSrc).toContain(REPORT_INVOCATION)
  })

  it('advisor-gate SKILL.md (src) uses pipe invocation for remediate-plan', () => {
    expect(skillSrc).toContain(PIPE_INVOCATION)
  })

  it('advisor-gate SKILL.md (src) blocks APPROVE while any flagged file has no cleanup slice', () => {
    expect(skillSrc).toContain(APPROVE_BLOCK)
  })
})

describe('comment-density gate — generated mirrors carry identical wording', () => {
  it('agents/advisor.md carries comment-density report --json', () => {
    expect(advisorMirror).toContain(REPORT_INVOCATION)
  })

  it('agents/advisor.md uses pipe invocation for remediate-plan', () => {
    expect(advisorMirror).toContain(PIPE_INVOCATION)
  })

  it('agents/advisor.md carries APPROVE-refusal sentence', () => {
    expect(advisorMirror).toContain(APPROVE_BLOCK)
  })

  it('agents-pi/advisor.md carries comment-density report --json', () => {
    expect(advisorPiMirror).toContain(REPORT_INVOCATION)
  })

  it('agents-pi/advisor.md uses pipe invocation for remediate-plan', () => {
    expect(advisorPiMirror).toContain(PIPE_INVOCATION)
  })

  it('agents-pi/advisor.md carries APPROVE-refusal sentence', () => {
    expect(advisorPiMirror).toContain(APPROVE_BLOCK)
  })

  it('skills/advisor-gate/SKILL.md mirror carries comment-density report --json', () => {
    expect(skillMirror).toContain(REPORT_INVOCATION)
  })

  it('skills/advisor-gate/SKILL.md mirror uses pipe invocation for remediate-plan', () => {
    expect(skillMirror).toContain(PIPE_INVOCATION)
  })

  it('skills/advisor-gate/SKILL.md mirror carries APPROVE-refusal sentence', () => {
    expect(skillMirror).toContain(APPROVE_BLOCK)
  })

  it('src/lib/agent-definitions.generated.ts carries comment-density report --json', () => {
    expect(agentDefsMirror).toContain(REPORT_INVOCATION)
  })

  it('src/lib/agent-definitions.generated.ts uses pipe invocation for remediate-plan', () => {
    expect(agentDefsMirror).toContain(PIPE_INVOCATION)
  })

  it('src/lib/agent-definitions.generated.ts carries APPROVE-refusal sentence', () => {
    expect(agentDefsMirror).toContain(APPROVE_BLOCK)
  })
})

describe('comment-density gate — documented pipe invocation is executable', () => {
  it('pipe invocation exits 0 with zero gw ledger add lines for clean input', () => {
    const result = spawnSync(
      'sh',
      [
        '-c',
        'GROUNDWORK_COMMENT_DENSITY=0 bin/gw-hook comment-density report --json | bin/gw-hook comment-density remediate-plan --motive x',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    const output = (result.stdout ?? '') + (result.stderr ?? '')
    const ledgerAddLines = output.split('\n').filter((l) => l.includes('gw ledger add'))
    expect(ledgerAddLines).toHaveLength(0)
  })
})
