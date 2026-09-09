// AC-5 (T6): commit-msg · commit-message-guard · gw commit-lint parity test.
// All three must reach the same verdict on every corpus message.
// Positive control 'reject-invalid-type' ensures no surface is silently absent.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync, execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  makeHostRepo,
  installedHookVerdict,
  commitLintVerdict as hostCommitLintVerdict,
  guardVerdict as hostGuardVerdict,
  conformingHistory,
  conformingHistoryWithBodies,
  nonConformingHistory,
  seedHistory,
} from './host-convention-harness.js'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const HOOKS_DIR = join(REPO_ROOT, 'hooks')
const HOOK_SHIM = join(REPO_ROOT, 'bin', 'gw-hook')

interface CorpusEntry {
  id: string
  message: string
  verdict: 'accept' | 'reject'
  trailerOnly?: boolean
}

const CORPUS: CorpusEntry[] = [
  { id: 'valid-subject-only', message: 'feat: add initial implementation', verdict: 'accept' },
  { id: 'valid-with-scope', message: 'fix(auth): correct token expiry check', verdict: 'accept' },
  { id: 'valid-breaking', message: 'feat(api)!: remove deprecated endpoint', verdict: 'accept' },
  { id: 'valid-chore', message: 'chore: update dependencies', verdict: 'accept' },
  { id: 'valid-revert', message: 'revert: undo previous merge', verdict: 'accept' },

  // POSITIVE CONTROL — all three currently reject; proves each surface is reached
  { id: 'reject-invalid-type', message: 'notatype: this should always be rejected', verdict: 'reject' },

  { id: 'reject-over-length', message: 'feat: ' + 'x'.repeat(73), verdict: 'reject' },
  { id: 'reject-bad-scope-space', message: 'feat(bad scope): something here', verdict: 'reject' },
  { id: 'reject-body', message: 'feat: add feature\n\nThis is a body line', verdict: 'reject' },
  { id: 'reject-gate-cycle', message: 'fix: resolve gate cycle regression', verdict: 'reject' },
  { id: 'reject-advisor-approve', message: 'feat: complete advisor APPROVE step', verdict: 'reject' },
  { id: 'reject-slice-id', message: 'chore: implement T5 completion', verdict: 'reject' },
  { id: 'reject-decision-id', message: 'fix: address D-7 feedback', verdict: 'reject' },

  // Trailers stripped before linting — accepted by all three; strip tested separately
  { id: 'trailer-claude-session', message: 'chore: update config\n\nClaude-Session: https://claude.ai/code/session_test', verdict: 'accept', trailerOnly: true },
  { id: 'trailer-co-authored', message: 'feat: add implementation\n\nCo-Authored-By: Claude <claude@anthropic.com>', verdict: 'accept', trailerOnly: true },
  { id: 'trailer-generated', message: 'chore: cleanup\n\nGenerated with Claude Code 1.0.0', verdict: 'accept', trailerOnly: true },
]

let hookRepo: string
let hookFileSeq = 0

function commitMsgVerdict(message: string, extraEnv: Record<string, string> = {}): 'accept' | 'reject' {
  const name = `hf${++hookFileSeq}.txt`
  writeFileSync(join(hookRepo, name), String(hookFileSeq))
  execSync(`git add ${name}`, { cwd: hookRepo })
  const result = spawnSync('git', ['commit', '-m', message], {
    cwd: hookRepo,
    env: { ...process.env, CLAUDE_PROJECT_DIR: hookRepo, ...extraEnv },
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    execSync('git restore --staged .', { cwd: hookRepo })
    return 'reject'
  }
  return 'accept'
}

function guardVerdict(message: string, extraEnv: Record<string, string> = {}): 'accept' | 'reject' {
  const command = `git commit -m '${message}'`
  const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command } })
  const result = spawnSync(HOOK_SHIM, ['hook', 'commit-message-guard'], {
    input: stdin,
    encoding: 'utf-8',
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'parity-test', CLAUDE_PROJECT_DIR: '', ...extraEnv },
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

let cliRepo: string
let cliFileSeq = 0

function commitLintVerdict(message: string, extraEnv: Record<string, string> = {}): 'accept' | 'reject' {
  const name = `cf${++cliFileSeq}.txt`
  writeFileSync(join(cliRepo, name), String(cliFileSeq))
  execSync(`git add ${name}`, { cwd: cliRepo })
  const baseSha = execSync('git rev-parse HEAD', { cwd: cliRepo, encoding: 'utf8' }).trim()
  spawnSync('git', ['commit', '--no-verify', '-m', message], { cwd: cliRepo, encoding: 'utf8' })
  const headSha = execSync('git rev-parse HEAD', { cwd: cliRepo, encoding: 'utf8' }).trim()
  const result = spawnSync(HOOK_SHIM, ['commit-lint', 'report', '--range', `${baseSha}..${headSha}`], {
    cwd: cliRepo,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cliRepo, CLAUDE_PLUGIN_ROOT: '', ...extraEnv },
    timeout: 10_000,
  })
  execSync(`git reset --hard -q ${baseSha}`, { cwd: cliRepo })
  const out = (result.stdout ?? '').trim()
  if (!out) return 'accept'
  try {
    const parsed = JSON.parse(out) as { totalViolations?: number }
    return (parsed.totalViolations ?? 0) > 0 ? 'reject' : 'accept'
  } catch {
    return 'accept'
  }
}

beforeAll(() => {
  hookRepo = mkdtempSync(join(tmpdir(), 'gw-parity-hook-'))
  execSync('git init', { cwd: hookRepo })
  execSync('git config user.email "parity@test.example"', { cwd: hookRepo })
  execSync('git config user.name "Parity Test"', { cwd: hookRepo })
  execSync(`git config core.hooksPath "${HOOKS_DIR}"`, { cwd: hookRepo })
  writeFileSync(join(hookRepo, 'README.md'), 'init')
  execSync('git add README.md', { cwd: hookRepo })
  execSync('git commit --no-verify -m "init"', { cwd: hookRepo })
  seedHistory(hookRepo, conformingHistory(30))

  cliRepo = mkdtempSync(join(tmpdir(), 'gw-parity-cli-'))
  execSync('git init', { cwd: cliRepo })
  execSync('git config user.email "parity@test.example"', { cwd: cliRepo })
  execSync('git config user.name "Parity Test"', { cwd: cliRepo })
  writeFileSync(join(cliRepo, 'README.md'), 'init')
  execSync('git add README.md', { cwd: cliRepo })
  execSync('git commit --no-verify -m "init"', { cwd: cliRepo })
  seedHistory(cliRepo, conformingHistory(30))
})

afterAll(() => {
  rmSync(hookRepo, { recursive: true, force: true })
  rmSync(cliRepo, { recursive: true, force: true })
})

describe('three-enforcer parity: same verdict from all surfaces', () => {
  for (const entry of CORPUS) {
    it(`[${entry.id}]`, () => {
      const hookV = commitMsgVerdict(entry.message)
      const guardV = guardVerdict(entry.message)
      const cliV = commitLintVerdict(entry.message)

      expect(hookV, `commit-msg [${entry.id}]`).toBe(entry.verdict)
      expect(guardV, `guard [${entry.id}]`).toBe(entry.verdict)
      expect(cliV, `commit-lint [${entry.id}]`).toBe(entry.verdict)
      expect(guardV, `guard vs commit-msg [${entry.id}]`).toBe(hookV)
      expect(cliV, `commit-lint vs commit-msg [${entry.id}]`).toBe(hookV)
    })
  }
})

describe('positive control: each surface independently rejects invalid type', () => {
  const CONTROL = 'notatype: this should always be rejected'

  it('commit-msg rejects (surface 1 is live)', () => {
    expect(commitMsgVerdict(CONTROL)).toBe('reject')
  })

  it('guard denies (surface 2 is live)', () => {
    expect(guardVerdict(CONTROL)).toBe('reject')
  })

  it('commit-lint reports violation (surface 3 is live)', () => {
    expect(commitLintVerdict(CONTROL)).toBe('reject')
  })
})

// The temp repos above carry no .gitmessage; their seeded history conforms to
// groundwork's convention, which is why the CORPUS verdicts hold there. The two blocks
// below repeat the parity claim in the other two contexts a host repo can be in.
describe('three-enforcer parity in a host repo with its own .gitmessage', () => {
  let hostRepo: string

  const HOST_CORPUS: Array<{ id: string; message: string; verdict: 'accept' | 'reject' }> = [
    { id: 'host-scope-accepted', message: 'web: Ignore CancelledError and offline fetch noise in GlitchTip', verdict: 'accept' },
    { id: 'host-scope-db-accepted', message: 'db: Restore slim MATH tc modules fixture', verdict: 'accept' },
    { id: 'groundwork-type-accepted', message: 'feat(web): something', verdict: 'accept' },
    { id: 'groundwork-bare-type-accepted', message: 'chore: update dependencies', verdict: 'accept' },
    { id: 'body-rejected', message: 'web: add a thing\n\nThis is a body line', verdict: 'reject' },
    { id: 'process-vocab-rejected', message: 'web: fix the second gate cycle thing', verdict: 'reject' },
  ]

  beforeAll(() => {
    hostRepo = makeHostRepo({
      gitmessage: 'hanlun-lms.gitmessage',
      subjects: 'hanlun-lms.subjects.txt',
    })
  }, 180_000)

  afterAll(() => {
    if (hostRepo) rmSync(hostRepo, { recursive: true, force: true })
  })

  for (const entry of HOST_CORPUS) {
    it(`[${entry.id}]`, () => {
      const hookV = installedHookVerdict(hostRepo, entry.message)
      const guardV = hostGuardVerdict(hostRepo, entry.message)
      const cliV = hostCommitLintVerdict(hostRepo, entry.message)

      expect(hookV, `installed commit-msg [${entry.id}]`).toBe(entry.verdict)
      expect(guardV, `guard vs installed commit-msg [${entry.id}]`).toBe(hookV)
      expect(cliV, `commit-lint vs installed commit-msg [${entry.id}]`).toBe(hookV)
    }, 30_000)
  }
})

describe('three-enforcer parity in a no-.gitmessage repo: history cannot disarm the convention', () => {
  let refutingRepo: string

  const REFUTING_CORPUS: Array<{ id: string; message: string; verdict: 'accept' | 'reject' }> = [
    { id: 'own-style-rejected', message: 'web: Ignore CancelledError noise', verdict: 'reject' },
    { id: 'shapeless-rejected', message: 'Just some words with no shape at all', verdict: 'reject' },
    { id: 'over-length-rejected', message: 'feat: ' + 'x'.repeat(73), verdict: 'reject' },
    { id: 'body-rejected', message: 'infra: add feature\n\nThis is a body line', verdict: 'reject' },
    { id: 'process-vocab-rejected', message: 'web: resolve the gate cycle regression', verdict: 'reject' },
    { id: 'slice-id-rejected', message: 'web: implement T39 completion', verdict: 'reject' },
  ]

  beforeAll(() => {
    refutingRepo = makeHostRepo({
      gitmessage: null,
      seedSubject: 'repo: initial import',
      subjectList: nonConformingHistory(30),
    })
  }, 180_000)

  afterAll(() => {
    if (refutingRepo) rmSync(refutingRepo, { recursive: true, force: true })
  })

  for (const entry of REFUTING_CORPUS) {
    it(`[${entry.id}]`, () => {
      const hookV = installedHookVerdict(refutingRepo, entry.message)
      const guardV = hostGuardVerdict(refutingRepo, entry.message)
      const cliV = hostCommitLintVerdict(refutingRepo, entry.message)

      expect(hookV, `installed commit-msg [${entry.id}]`).toBe(entry.verdict)
      expect(guardV, `guard vs installed commit-msg [${entry.id}]`).toBe(hookV)
      expect(cliV, `commit-lint vs installed commit-msg [${entry.id}]`).toBe(hookV)
    }, 30_000)
  }
})

// A body-writing history no longer buys a body exemption. All three surfaces must agree
// on that, so none of them can be the one that quietly still permits a body.
describe('three-enforcer parity where history writes bodies but the rule stands', () => {
  let bodiesRepo: string

  const BODIES_CORPUS: Array<{ id: string; message: string; verdict: 'accept' | 'reject' }> = [
    { id: 'conforming-with-body-rejected', message: 'feat: add feature\n\nThis is a body line', verdict: 'reject' },
    { id: 'malformed-subject-rejected', message: 'web: Ignore CancelledError noise', verdict: 'reject' },
    { id: 'invalid-type-rejected', message: 'notatype: this should always be rejected', verdict: 'reject' },
    { id: 'over-length-rejected', message: 'feat: ' + 'x'.repeat(73), verdict: 'reject' },
    { id: 'bullet-body-rejected', message: 'chore: tidy imports\n\n- one\n- two', verdict: 'reject' },
    { id: 'process-vocab-in-body-rejected', message: 'feat: add feature\n\nThis closes the second gate cycle.', verdict: 'reject' },
  ]

  beforeAll(() => {
    bodiesRepo = makeHostRepo({
      gitmessage: null,
      seedSubject: 'chore: initial import',
      subjectList: conformingHistoryWithBodies(30),
    })
  }, 240_000)

  afterAll(() => {
    if (bodiesRepo) rmSync(bodiesRepo, { recursive: true, force: true })
  })

  for (const entry of BODIES_CORPUS) {
    it(`[${entry.id}]`, () => {
      const hookV = installedHookVerdict(bodiesRepo, entry.message)
      const guardV = hostGuardVerdict(bodiesRepo, entry.message)
      const cliV = hostCommitLintVerdict(bodiesRepo, entry.message)

      expect(hookV, `installed commit-msg [${entry.id}]`).toBe(entry.verdict)
      expect(guardV, `guard vs installed commit-msg [${entry.id}]`).toBe(hookV)
      expect(cliV, `commit-lint vs installed commit-msg [${entry.id}]`).toBe(hookV)
    }, 30_000)
  }
})

describe('attribution-trailer strip (commit-msg mutates; guard and CLI do not)', () => {
  it('commit-msg strips Claude-Session trailer from the committed log', () => {
    const verdict = commitMsgVerdict('chore: test strip\n\nClaude-Session: https://claude.ai/code/session_strip-test')
    expect(verdict).toBe('accept')
    const log = execSync('git log -1 --pretty=%B', { cwd: hookRepo, encoding: 'utf8' })
    expect(log).toContain('chore: test strip')
    expect(log).not.toContain('Claude-Session')
  })

  // Guard reads -F <path> when reachable; passthrough only when unreachable
  // (missing/unreadable file, editor-driven commit, bare --amend).
  describe('-F file commits: guard reads when reachable, passes through when not', () => {
    let fTmpDir: string

    beforeAll(() => {
      fTmpDir = mkdtempSync(join(tmpdir(), 'gw-parity-ffile-'))
    })

    afterAll(() => {
      rmSync(fTmpDir, { recursive: true, force: true })
    })

    it('-F file with violating message → guard denies, naming offending lines', () => {
      const msgPath = join(fTmpDir, 'bad-commit.txt')
      writeFileSync(msgPath, 'notatype: this message violates convention')
      const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `git commit -F ${msgPath}` } })
      const result = spawnSync(HOOK_SHIM, ['hook', 'commit-message-guard'], {
        input: stdin, encoding: 'utf-8',
        env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'parity-test' },
        timeout: 10_000,
      })
      const out = (result.stdout ?? '').trim()
      expect(out, 'guard must produce output (deny JSON)').not.toBe('')
      const parsed = JSON.parse(out) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }
      expect(parsed.hookSpecificOutput?.permissionDecision, 'permissionDecision must be deny').toBe('deny')
      expect(parsed.hookSpecificOutput?.permissionDecisionReason, 'reason must name a line').toMatch(/line \d+/)
    })

    it('-F file with conforming message → guard allows', () => {
      const msgPath = join(fTmpDir, 'good-commit.txt')
      writeFileSync(msgPath, 'feat: add new capability')
      const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `git commit -F ${msgPath}` } })
      const result = spawnSync(HOOK_SHIM, ['hook', 'commit-message-guard'], {
        input: stdin, encoding: 'utf-8',
        env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'parity-test' },
        timeout: 10_000,
      })
      expect((result.stdout ?? '').trim()).toBe('')
    })

    it('-F path that does not exist → guard passes through', () => {
      // missingPath is inside fTmpDir (which exists) but was never written — deterministically absent
      const missingPath = join(fTmpDir, 'does-not-exist.txt')
      const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `git commit -F ${missingPath}` } })
      const result = spawnSync(HOOK_SHIM, ['hook', 'commit-message-guard'], {
        input: stdin, encoding: 'utf-8',
        env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'parity-test' },
        timeout: 10_000,
      })
      expect((result.stdout ?? '').trim()).toBe('')
    })
  })

  it('guard passes through editor-driven commits with no -m flag', () => {
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit --amend' } })
    const result = spawnSync(HOOK_SHIM, ['hook', 'commit-message-guard'], {
      input: stdin, encoding: 'utf-8',
      env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'parity-test' },
      timeout: 10_000,
    })
    expect((result.stdout ?? '').trim()).toBe('')
  })
})
