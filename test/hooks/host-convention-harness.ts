// Both enforcers are driven through their DEPLOYED path (a real `git commit`; bin/gw-hook
// + stdin). Nothing under test is imported; renderCommitMsgHook only writes the file.
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { renderCommitMsgHook } from '../../hooks/lib/commit-msg-template.mjs'

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const HOOKS_LIB = join(REPO_ROOT, 'hooks', 'lib')
export const HOOK_SHIM = join(REPO_ROOT, 'bin', 'gw-hook')
export const FIXTURES = join(REPO_ROOT, 'test', 'fixtures', 'gitmessage')

export type Verdict = 'accept' | 'reject'

const CLEAN_ENV: Record<string, string> = {
  CLAUDE_PROJECT_DIR: '',
  CLAUDE_PLUGIN_ROOT: '',
  CLAUDE_CODE_SESSION_ID: 'host-convention-test',
  GIT_CONFIG_NOSYSTEM: '1',
  HOME: tmpdir(),
}

export interface HostRepoOptions {
  gitmessage: string | null
  subjects?: string
  subjectList?: string[]
  seedSubject?: string
  installHook?: boolean
}

// conformingHistory satisfies groundwork's convention; the WithBodies variant keeps those
// subjects but adds bodies; nonConformingHistory is scope-first and satisfies none of it.
export function conformingHistory(n = 30): string[] {
  const types = ['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'build', 'ci']
  return Array.from({ length: n }, (_, i) => `${types[i % types.length]}: change number ${i} landed`)
}

export function conformingHistoryWithBodies(n = 30): string[] {
  return conformingHistory(n).map(
    (subject, i) => `${subject}\n\nThis body paragraph explains why change number ${i} was made.`,
  )
}

export function nonConformingHistory(n = 30): string[] {
  const scopes = ['web', 'backend', 'infra', 'db', 'teacher']
  return Array.from({ length: n }, (_, i) => `${scopes[i % scopes.length]}: Change number ${i} landed`)
}

// Without this a scratch repo holds one "init" commit, too thin to measure anything.
export function seedHistory(repo: string, subjects: string[], env?: NodeJS.ProcessEnv): void {
  for (const subject of subjects) {
    execFileSync(
      'git',
      ['commit', '--allow-empty', '--no-verify', '--no-gpg-sign', '-q', '-m', subject],
      { cwd: repo, env: { ...process.env, ...env } },
    )
  }
}

export function makeHostRepo(opts: HostRepoOptions): string {
  const repo = mkdtempSync(join(tmpdir(), 'gw-host-conv-'))
  const run = (args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...CLEAN_ENV } })

  run(['init', '-q'])
  run(['config', 'user.email', 'host@test.example'])
  run(['config', 'user.name', 'Host Test'])
  run(['config', 'commit.gpgsign', 'false'])

  if (opts.gitmessage !== null) {
    copyFileSync(join(FIXTURES, opts.gitmessage), join(repo, '.gitmessage'))
  }

  writeFileSync(join(repo, 'README.md'), 'init\n')
  run(['add', '-A'])
  run(['commit', '--no-verify', '-q', '-m', opts.seedSubject ?? 'seed: initial import'])

  const subjects = opts.subjects
    ? readFileSync(join(FIXTURES, opts.subjects), 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
    : (opts.subjectList ?? [])
  subjects.forEach((subject, i) => {
    writeFileSync(join(repo, `h${i}.txt`), String(i))
    run(['add', '-A'])
    run(['commit', '--no-verify', '-q', '-m', subject])
  })

  if (opts.installHook !== false) {
    const hooksDir = join(repo, '.git', 'hooks')
    mkdirSync(hooksDir, { recursive: true })
    const hookPath = join(hooksDir, 'commit-msg')
    writeFileSync(hookPath, renderCommitMsgHook({ hooksLibPath: HOOKS_LIB, version: '0.0.0-test' }))
    chmodSync(hookPath, 0o755)
  }

  return repo
}

let seq = 0

/** Drives the INSTALLED commit-msg hook through a real `git commit`. */
export function installedHookVerdict(repo: string, message: string): Verdict {
  const name = `c${++seq}.txt`
  writeFileSync(join(repo, name), String(seq))
  execFileSync('git', ['add', name], { cwd: repo, env: { ...process.env, ...CLEAN_ENV } })
  const result = spawnSync('git', ['commit', '-m', message], {
    cwd: repo,
    env: { ...process.env, ...CLEAN_ENV },
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    execFileSync('git', ['reset', '-q', 'HEAD', '--', name], {
      cwd: repo,
      env: { ...process.env, ...CLEAN_ENV },
    })
    return 'reject'
  }
  return 'accept'
}

// Rewinds after auditing, so the message under test never shifts the self-validation sample.
export function commitLintVerdict(repo: string, message: string): Verdict {
  const env = { ...process.env, ...CLEAN_ENV }
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env }).trim()
  const name = `l${++seq}.txt`
  writeFileSync(join(repo, name), String(seq))
  git(['add', name])
  const base = git(['rev-parse', 'HEAD'])
  git(['commit', '--no-verify', '-q', '-m', message])
  const head = git(['rev-parse', 'HEAD'])
  const result = spawnSync(HOOK_SHIM, ['commit-lint', 'report', '--range', `${base}..${head}`], {
    cwd: repo,
    encoding: 'utf8',
    env,
    timeout: 20_000,
  })
  git(['reset', '--hard', '-q', base])
  const out = (result.stdout ?? '').trim()
  if (!out) return 'accept'
  try {
    const parsed = JSON.parse(out) as { totalViolations?: number }
    return (parsed.totalViolations ?? 0) > 0 ? 'reject' : 'accept'
  } catch {
    return 'accept'
  }
}

/** Drives the PreToolUse guard through bin/gw-hook with a stdin payload. */
export function guardVerdict(repo: string, message: string): Verdict {
  const command = `git commit -m '${message}'`
  const result = spawnSync(HOOK_SHIM, ['hook', 'commit-message-guard'], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command, cwd: repo } }),
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...CLEAN_ENV },
    timeout: 20_000,
  })
  const out = (result.stdout ?? '').trim()
  if (!out) return 'accept'
  try {
    const parsed = JSON.parse(out) as { hookSpecificOutput?: { permissionDecision?: string } }
    return parsed.hookSpecificOutput?.permissionDecision === 'deny' ? 'reject' : 'accept'
  } catch {
    return 'accept'
  }
}
