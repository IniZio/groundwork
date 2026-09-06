import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '#src/gw/cli/commands/commit-lint.js'

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'commit-lint-test-'))
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })
  execSync('git config commit.gpgsign false', { cwd: dir, stdio: 'pipe' })
  execSync('git commit --allow-empty -m "chore: initial"', { cwd: dir, stdio: 'pipe' })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function addCommit(dir: string, message: string): string {
  execSync(`git commit --allow-empty -m ${JSON.stringify(message)}`, { cwd: dir, stdio: 'pipe' })
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim()
}

function headSha(dir: string): string {
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim()
}

function reflog(dir: string): string {
  return execSync('git reflog --oneline', { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim()
}

const VIOLATING_NO_TYPE = 'bad message'
const VIOLATING_PROCESS_VOCAB = 'fix: second gate cycle cleanup'
const CLEAN_1 = 'feat: add new feature'
const CLEAN_2 = 'fix(auth): correct token expiry'
const CLEAN_3 = 'chore: update dependencies'

let savedSessionId: string | undefined
let savedProjectDir: string | undefined

beforeEach(() => {
  savedSessionId = process.env['CLAUDE_CODE_SESSION_ID']
  savedProjectDir = process.env['CLAUDE_PROJECT_DIR']
  delete process.env['CLAUDE_CODE_SESSION_ID']
  delete process.env['CLAUDE_PROJECT_DIR']
})

afterEach(() => {
  if (savedSessionId === undefined) delete process.env['CLAUDE_CODE_SESSION_ID']
  else process.env['CLAUDE_CODE_SESSION_ID'] = savedSessionId
  if (savedProjectDir === undefined) delete process.env['CLAUDE_PROJECT_DIR']
  else process.env['CLAUDE_PROJECT_DIR'] = savedProjectDir
  delete process.env['GROUNDWORK_COMMIT_LINT']
})

describe('gw commit-lint report', () => {
  it('1. finds violations in a violating range', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      const base = headSha(dir)
      addCommit(dir, VIOLATING_NO_TYPE)
      addCommit(dir, VIOLATING_PROCESS_VOCAB)
      addCommit(dir, CLEAN_1)

      const result = await run(['report', '--since', base], dir)

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('not ok')
      const data = result.data as { range: string; totalViolations: number; commits: Array<{ sha: string; shortSha: string; subject: string; violations: Array<{ line: number; reason: string }> }> }
      expect(data.commits.length).toBe(2)
      expect(data.totalViolations).toBeGreaterThan(0)
      const subjects = data.commits.map((c) => c.subject)
      expect(subjects).toContain(VIOLATING_NO_TYPE)
      expect(subjects).toContain(VIOLATING_PROCESS_VOCAB)
    } finally {
      cleanup()
    }
  })

  it('2. clean on a conforming range', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      const base = headSha(dir)
      addCommit(dir, CLEAN_1)
      addCommit(dir, CLEAN_2)
      addCommit(dir, CLEAN_3)

      const result = await run(['report', '--since', base], dir)

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('not ok')
      const data = result.data as { range: string; totalViolations: number; commits: unknown[] }
      expect(data.commits.length).toBe(0)
      expect(data.totalViolations).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('3. envelope shape matches GwEnvelope contract', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      const base = headSha(dir)
      addCommit(dir, CLEAN_1)

      const result = await run(['report', '--since', base], dir)

      expect(result).toHaveProperty('ok')
      expect(result).toHaveProperty('command')
      expect(result).toHaveProperty('exit')
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('not ok')
      const data = result.data as Record<string, unknown>
      expect(data).toHaveProperty('range')
      expect(data).toHaveProperty('totalViolations')
      expect(data).toHaveProperty('commits')
      expect(Array.isArray(data['commits'])).toBe(true)
      expect(result.exit).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('8. NO_RANGE error when no range provided and no ledger', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      const result = await run(['report'], dir)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected error envelope')
      expect(result.error.code).toBe('NO_RANGE')
    } finally {
      cleanup()
    }
  })
})

describe('gw commit-lint remediate-plan', () => {
  it('4. output is a valid rebase todo', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      const base = headSha(dir)
      addCommit(dir, CLEAN_1)
      addCommit(dir, VIOLATING_NO_TYPE)

      const result = await run(['remediate-plan', '--since', base], dir)

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('not ok')
      const data = result.data as { content: string }
      expect(typeof data.content).toBe('string')
      expect(data.content.length).toBeGreaterThan(0)

      const actionLines = data.content
        .split('\n')
        .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'))
      expect(actionLines.length).toBeGreaterThan(0)
      for (const line of actionLines) {
        expect(line).toMatch(/^(pick|reword|squash|drop)\s/)
      }
    } finally {
      cleanup()
    }
  })

  it('5. AC-7: NEVER writes to git refs — HEAD and reflog unchanged after remediate-plan', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      const base = headSha(dir)
      addCommit(dir, VIOLATING_NO_TYPE)
      addCommit(dir, VIOLATING_PROCESS_VOCAB)

      const headBefore = headSha(dir)
      const reflogBefore = reflog(dir)

      await run(['remediate-plan', '--since', base], dir)

      expect(headSha(dir)).toBe(headBefore)
      expect(reflog(dir)).toBe(reflogBefore)
    } finally {
      cleanup()
    }
  })
})

describe('gw commit-lint kill switch (GROUNDWORK_COMMIT_LINT=0)', () => {
  it('6. report — positive control fires, then kill switch silences', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      const base = headSha(dir)
      addCommit(dir, VIOLATING_NO_TYPE)
      addCommit(dir, VIOLATING_PROCESS_VOCAB)

      const active = await run(['report', '--since', base], dir)
      expect(active.ok).toBe(true)
      if (!active.ok) throw new Error('not ok')
      const activeData = active.data as { commits: unknown[] }
      expect(activeData.commits.length).toBeGreaterThan(0)

      process.env['GROUNDWORK_COMMIT_LINT'] = '0'
      const disabled = await run(['report', '--since', base], dir)
      expect(disabled.ok).toBe(true)
      if (!disabled.ok) throw new Error('not ok')
      const disabledData = disabled.data as { range: string; totalViolations: number; commits: unknown[] }
      expect(disabledData.totalViolations).toBe(0)
      expect(disabledData.range).toBe('disabled')
    } finally {
      cleanup()
    }
  })

  it('7. remediate-plan — positive control fires, then kill switch silences', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      const base = headSha(dir)
      addCommit(dir, VIOLATING_NO_TYPE)

      const active = await run(['remediate-plan', '--since', base], dir)
      expect(active.ok).toBe(true)
      if (!active.ok) throw new Error('not ok')
      const activeData = active.data as { content: string }
      expect(activeData.content.length).toBeGreaterThan(0)

      process.env['GROUNDWORK_COMMIT_LINT'] = '0'
      const disabled = await run(['remediate-plan', '--since', base], dir)
      expect(disabled.ok).toBe(true)
      if (!disabled.ok) throw new Error('not ok')
      const disabledData = disabled.data as { content: string }
      expect(disabledData.content).toBe('')
    } finally {
      cleanup()
    }
  })
})
