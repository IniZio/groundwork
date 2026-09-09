/**
 * test/hooks/commit-convention-concatenation.test.ts
 *
 * The host-repo convention is CONCATENATED, not derived: the project's .gitmessage
 * supplies its own text, groundwork's universal rules apply on top, and neither source
 * can switch the other off. The fixture is the case the old deriver silently disarmed —
 * an all-commented template that declares a body section, over a history of commits that
 * all carry bodies. Under derivation both signals dropped the body rule and the loss was
 * invisible; under concatenation the rule is stated, enforced, and reportable.
 *
 * Drives the deployed entry point (bin/gw-hook -> dist/gw.mjs when bun is present).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import os from 'node:os'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const GW_HOOK = join(REPO_ROOT, 'bin', 'gw-hook')

const ALL_COMMENTED_TEMPLATE = [
  '# <scope>: <subject>',
  '#',
  '# Scopes: api | ui | core',
  '#',
  '# Body: explain what changed and why, if needed.',
  '',
].join('\n')

const ENV: NodeJS.ProcessEnv = (() => {
  const e: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CODE_SESSION_ID: 'test-session',
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  }
  delete e['CLAUDE_PROJECT_DIR']
  delete e['GROUNDWORK_COMMIT_LINT']
  return e
})()

let hostRepo: string
let firstSha: string

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: hostRepo, encoding: 'utf8', env: ENV })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}

function gw(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(GW_HOOK, args, { cwd: hostRepo, encoding: 'utf8', env: ENV })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function payloadOf(r: { stdout: string; stderr: string }): Record<string, unknown> {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(r.stdout)
  } catch {
    throw new Error(`gw produced no JSON. stdout=${JSON.stringify(r.stdout)} stderr=${r.stderr}`)
  }
  return (parsed['data'] as Record<string, unknown>) ?? parsed
}

function reasonsIn(report: Record<string, unknown>): string {
  const commits = (report['commits'] ?? []) as Array<{ violations: Array<{ reason: string }> }>
  return commits.flatMap((c) => c.violations.map((v) => v.reason)).join('\n')
}

beforeAll(() => {
  hostRepo = mkdtempSync(join(realpathSync(os.tmpdir()), 'gw-concat-'))
  git(['init', '-q', '.'])
  writeFileSync(join(hostRepo, '.gitmessage'), ALL_COMMENTED_TEMPLATE)
  git(['add', '.gitmessage'])
  git(['commit', '-q', '-m', 'core: add commit template\n\nSo the project states its own style.'])
  firstSha = git(['rev-parse', 'HEAD'])
  for (let i = 1; i <= 13; i++) {
    writeFileSync(join(hostRepo, `f${i}.txt`), `${i}\n`)
    git(['add', `f${i}.txt`])
    git(['commit', '-q', '-m', `core: change number ${i}\n\nA body explaining change ${i}.`])
  }
})

afterAll(() => {
  if (hostRepo) rmSync(hostRepo, { recursive: true, force: true })
})

describe('host-repo commit convention is concatenated, not derived', () => {
  it('reports the active ruleset so an agent never has to infer whether a rule applies', () => {
    const r = gw(['commit-lint', 'convention'])
    expect(r.status, `gw commit-lint convention failed: ${r.stderr}${r.stdout}`).toBe(0)
    const view = payloadOf(r)
    expect(view['scope']).toBe('host-repo')
    expect((view['universalRules'] as string[]).join('\n')).toMatch(/no commit body/i)
    expect(view['bodyPermitted']).toBe(false)
    expect(view['enforcedGroups']).toContain('body')
  })

  it("carries the project's own .gitmessage text alongside the universal rules", () => {
    const view = payloadOf(gw(['commit-lint', 'convention']))
    const template = view['projectTemplate'] as { path: string; text: string }
    expect(template.path).toMatch(/\.gitmessage$/)
    expect(template.text).toContain('<scope>: <subject>')
    expect(template.text).toContain('Body: explain what changed and why')
  })

  it('enforces the no-body rule even though the template declares a body and every commit has one', () => {
    const r = gw(['commit-lint', 'report', '--range', `${firstSha}..HEAD`])
    expect(r.status, `gw commit-lint report failed: ${r.stderr}${r.stdout}`).toBe(0)
    const report = payloadOf(r)
    expect(report['totalViolations']).toBeGreaterThan(0)
    expect(reasonsIn(report)).toMatch(/body has \d+ non-blank lines/)
  })

  it("does not impose groundwork's subject grammar on a host project", () => {
    const report = payloadOf(gw(['commit-lint', 'report', '--range', `${firstSha}..HEAD`]))
    expect(reasonsIn(report)).not.toMatch(/subject does not match/)
  })
})
