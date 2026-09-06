import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { type GwEnvelope, errEnvelope, okEnvelope } from '../envelope.js'

export const COMMIT_LINT_SUBCOMMANDS = ['report', 'remediate-plan'] as const

export interface CommitViolation {
  sha: string
  shortSha: string
  subject: string
  violations: Array<{ line: number; reason: string }>
}

export interface CommitLintReport {
  range: string
  totalViolations: number
  commits: CommitViolation[]
}

function parseFlags(args: string[]): { flags: Record<string, string | true>; positionals: string[] } {
  const flags: Record<string, string | true> = {}
  const positionals: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const next = args[i + 1]
      if (next && !next.startsWith('--')) { flags[a.slice(2)] = next; i++ }
      else flags[a.slice(2)] = true
    } else { positionals.push(a) }
  }
  return { flags, positionals }
}

function readSessionLedger(cwd: string): { base_commit?: string } | null {
  const sessionId = process.env['CLAUDE_CODE_SESSION_ID']
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] || cwd
  if (!sessionId) return null
  try {
    const p = join(projectDir, '.groundwork', 'runs', `${sessionId}.json`)
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function resolveRange(flags: Record<string, string | true>, cwd: string): string {
  if (typeof flags['range'] === 'string') return flags['range']
  if (typeof flags['since'] === 'string') return `${flags['since']}..HEAD`
  const ledger = readSessionLedger(cwd)
  if (typeof ledger?.base_commit === 'string') return `${ledger.base_commit}..HEAD`
  return ''
}

async function runReport(args: string[], cwd: string): Promise<GwEnvelope> {
  if (process.env['GROUNDWORK_COMMIT_LINT'] === '0') {
    const empty: CommitLintReport = { range: 'disabled', totalViolations: 0, commits: [] }
    return okEnvelope('commit-lint report', empty)
  }

  const { flags } = parseFlags(args)
  const range = resolveRange(flags, cwd)
  if (!range) {
    return errEnvelope('commit-lint report', 'NO_RANGE', 'No commit range: pass --range <a>..<b>, --since <ref>, or run inside a session with a ledger base_commit', 2)
  }

  const logResult = spawnSync('git', ['log', '--reverse', '--pretty=format:%H %s', range], { cwd, encoding: 'utf8' })
  if (logResult.status !== 0) {
    return errEnvelope('commit-lint report', 'GIT_ERROR', logResult.stderr || 'git log failed', 1)
  }

  const { lintMessage } = await import('../../../../hooks/lib/commit-convention.mjs') as unknown as { lintMessage: (text: string) => { violations: Array<{ line: number; reason: string }> } }

  const violating: CommitViolation[] = []
  for (const rawLine of logResult.stdout.split('\n').filter(Boolean)) {
    const [sha, ...subjectParts] = rawLine.split(' ')
    const subject = subjectParts.join(' ')
    if (!sha) continue
    const shortSha = sha.slice(0, 7)
    const msgResult = spawnSync('git', ['log', '-1', '--format=%B', sha], { cwd, encoding: 'utf8' })
    const message = msgResult.stdout ?? ''
    const violations = lintMessage(message).violations
    if (violations.length > 0) {
      violating.push({ sha, shortSha, subject, violations })
    }
  }

  const report: CommitLintReport = {
    range,
    totalViolations: violating.reduce((n, c) => n + c.violations.length, 0),
    commits: violating,
  }
  return okEnvelope('commit-lint report', report)
}

async function runRemediatePlan(args: string[], cwd: string): Promise<GwEnvelope> {
  if (process.env['GROUNDWORK_COMMIT_LINT'] === '0') {
    return okEnvelope('commit-lint remediate-plan', { content: '' })
  }

  const { flags } = parseFlags(args)
  const range = resolveRange(flags, cwd)
  if (!range) {
    return errEnvelope('commit-lint remediate-plan', 'NO_RANGE', 'No commit range: pass --range <a>..<b>, --since <ref>, or run inside a session with a ledger base_commit', 2)
  }

  const logResult = spawnSync('git', ['log', '--reverse', '--pretty=format:%H %s', range], { cwd, encoding: 'utf8' })
  if (logResult.status !== 0) {
    return errEnvelope('commit-lint remediate-plan', 'GIT_ERROR', logResult.stderr || 'git log failed', 1)
  }

  const { lintMessage } = await import('../../../../hooks/lib/commit-convention.mjs') as unknown as { lintMessage: (text: string) => { violations: Array<{ line: number; reason: string }> } }

  const SQUASH_RE = /^(fixup!|squash!|wip\b|fix typo|address review|typo|oops|cleanup|nit\b)/i

  const lines: string[] = []
  lines.push(`# Interactive rebase plan for: ${range}`)
  lines.push('# DO NOT EXECUTE — this is a plan only.')
  lines.push('# Review, then run: git rebase -i <base-ref>')
  lines.push('#')
  lines.push('# Actions: pick=keep as-is  reword=fix message  squash=merge into previous  drop=discard')
  lines.push('')

  const rawCommits = logResult.stdout.split('\n').filter(Boolean)
  for (const rawLine of rawCommits) {
    const [sha, ...subjectParts] = rawLine.split(' ')
    const subject = subjectParts.join(' ')
    if (!sha) continue
    const shortSha = sha.slice(0, 7)
    const msgResult = spawnSync('git', ['log', '-1', '--format=%B', sha], { cwd, encoding: 'utf8' })
    const message = msgResult.stdout ?? ''
    const violations = lintMessage(message).violations

    if (SQUASH_RE.test(subject)) {
      lines.push(`squash ${shortSha} ${subject}`)
    } else if (violations.length > 0) {
      lines.push(`reword ${shortSha} ${subject}`)
      for (const v of violations) {
        lines.push(`  #   line ${v.line}: ${v.reason}`)
      }
    } else {
      lines.push(`pick   ${shortSha} ${subject}`)
    }
  }

  if (rawCommits.length === 0) {
    lines.push('# No commits in range.')
  }

  return okEnvelope('commit-lint remediate-plan', { content: lines.join('\n') })
}

export async function run(args: string[], cwd: string): Promise<GwEnvelope> {
  const [subcmd, ...rest] = args
  if (subcmd === 'report') return runReport(rest, cwd)
  if (subcmd === 'remediate-plan') return runRemediatePlan(rest, cwd)
  return errEnvelope(
    'commit-lint',
    'UNKNOWN_SUBCOMMAND',
    `Unknown subcommand: "${subcmd}". Use: ${COMMIT_LINT_SUBCOMMANDS.join(', ')}`,
    2,
  )
}
