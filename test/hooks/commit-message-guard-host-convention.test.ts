// Hotfix (motive commit-message-gate): the PreToolUse commit guard must not
// impose groundwork's commit format on a host repository that ships its own
// .gitmessage. Process-vocabulary rejection still applies everywhere.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync, execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { conformingHistory, seedHistory } from './host-convention-harness.js'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const HOOK_SHIM = join(REPO_ROOT, 'bin', 'gw-hook')

function guardVerdict(command: string, cwd: string): 'accept' | 'reject' {
  const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command, cwd } })
  const result = spawnSync(HOOK_SHIM, ['hook', 'commit-message-guard'], {
    input: stdin,
    encoding: 'utf-8',
    cwd,
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'host-convention-test', CLAUDE_PROJECT_DIR: '' },
    timeout: 10_000,
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

function initRepo(prefix: string, withGitmessage: boolean, history: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  execSync('git init', { cwd: dir })
  execSync('git config user.email "host@test.example"', { cwd: dir })
  execSync('git config user.name "Host Test"', { cwd: dir })
  writeFileSync(join(dir, 'README.md'), 'init\n')
  if (withGitmessage) {
    writeFileSync(
      join(dir, '.gitmessage'),
      '<scope>: <subject>\n\nDO NOT use conventional-commit prefixes (feat:, fix:, chore:).\nOptional prose body wrapped at 72 characters.\n',
    )
  }
  execSync('git add -A', { cwd: dir })
  execSync('git commit --no-verify -m "init"', { cwd: dir })
  seedHistory(dir, history)
  return dir
}

let hostRepo: string
let plainRepo: string

beforeAll(() => {
  hostRepo = initRepo('gw-hostconv-with-', true)
  // Case 3 asserts groundwork's convention IS enforced here, which it only is once the
  // repo's own history has confirmed the convention fits it.
  plainRepo = initRepo('gw-hostconv-without-', false, conformingHistory(30))
})

afterAll(() => {
  rmSync(hostRepo, { recursive: true, force: true })
  rmSync(plainRepo, { recursive: true, force: true })
})

describe('commit-message-guard — host repo with its own .gitmessage', () => {
  it('case 1: hanlun-style subject in a repo with .gitmessage is ALLOWED', () => {
    const verdict = guardVerdict(
      'git commit -m "web: Ignore CancelledError and offline fetch noise"',
      hostRepo,
    )
    expect(verdict).toBe('accept')
  })

  it('case 2: process vocabulary is still DENIED in a repo with .gitmessage', () => {
    const verdict = guardVerdict(
      'git commit -m "web: resolve the gate cycle regression"',
      hostRepo,
    )
    expect(verdict).toBe('reject')
  })

  it('case 5: multi-line prose body is DENIED in a repo with .gitmessage', () => {
    const verdict = guardVerdict(
      'git commit -m "web: Ignore CancelledError" -m "This explains why the change was made and\nwraps at seventy-two characters as the template asks."',
      hostRepo,
    )
    expect(verdict).toBe('reject')
  })

  it('case 3: non-conventional subject in a repo WITHOUT .gitmessage is still DENIED', () => {
    const verdict = guardVerdict(
      'git commit -m "web: Ignore CancelledError and offline fetch noise"',
      plainRepo,
    )
    expect(verdict).toBe('reject')
  })

  it('case 4: non-conventional subject in groundwork itself is still DENIED', () => {
    const verdict = guardVerdict(
      'git commit -m "web: Ignore CancelledError and offline fetch noise"',
      REPO_ROOT,
    )
    expect(verdict).toBe('reject')
  })
})
