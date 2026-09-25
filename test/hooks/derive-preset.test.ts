import { describe, it, expect } from 'bun:test'
import { execSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { installHook } from '../../src/hooks/installer.js'
import { check } from '../../src/hooks/commit-message-guard.js'

function bash(command: string, cwd?: string) {
  const toolInput: Record<string, string> = { command }
  if (cwd !== undefined) toolInput['cwd'] = cwd
  return { tool_name: 'Bash', tool_input: toolInput }
}

function decision(result: { stdout: string }): string {
  const s = result.stdout.trim()
  if (!s) return 'allow'
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string } })
      .hookSpecificOutput.permissionDecision
  } catch {
    return `parse-error(${s.slice(0, 40)})`
  }
}

function makeRepo(kind: 'conv' | 'hb' | 'empty' | 'mixed'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gw-derive-test-'))
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "t@t.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "T"', { cwd: dir, stdio: 'pipe' })
  execSync('git config commit.gpgsign false', { cwd: dir, stdio: 'pipe' })

  if (kind !== 'empty') {
    for (let i = 1; i <= 10; i++) {
      let msg: string
      if (kind === 'conv') msg = `feat(core): add item ${i}`
      else if (kind === 'hb') msg = `Add item ${i}`
      else msg = i % 2 === 0 ? `feat(core): add item ${i}` : `Add item ${i}` // mixed
      execSync(`git commit --allow-empty --no-verify -m "${msg}"`, { cwd: dir, stdio: 'pipe' })
    }
  }

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const HOOKS_LIB = join(resolve(import.meta.dir, '../..'), 'hooks', 'lib')

// ── guard tests ─────────────────────────────────────────────────────────────

describe('derive-preset: guard with -C to real repos', () => {
  it('conv repo (10 conv commits): conventional derived — rejects handbook-style', () => {
    const { dir, cleanup } = makeRepo('conv')
    try {
      const r = check(bash(`git -C ${dir} commit -m "Add new thing"`))
      expect(decision(r)).toBe('deny')
    } finally {
      cleanup()
    }
  })

  it('conv repo: accepts conventional-style message', () => {
    const { dir, cleanup } = makeRepo('conv')
    try {
      const r = check(bash(`git -C ${dir} commit -m "feat: add new thing"`))
      expect(decision(r)).toBe('allow')
    } finally {
      cleanup()
    }
  })

  it('hb repo (10 handbook commits): handbook derived — accepts handbook-style', () => {
    const { dir, cleanup } = makeRepo('hb')
    try {
      const r = check(bash(`git -C ${dir} commit -m "Add new thing"`))
      expect(decision(r)).toBe('allow')
    } finally {
      cleanup()
    }
  })

  it('hb repo: rejects conventional-style message', () => {
    const { dir, cleanup } = makeRepo('hb')
    try {
      const r = check(bash(`git -C ${dir} commit -m "feat: add new thing"`))
      expect(decision(r)).toBe('deny')
    } finally {
      cleanup()
    }
  })

  it('empty repo (0 commits): handbook fallback — accepts handbook', () => {
    const { dir, cleanup } = makeRepo('empty')
    try {
      const r = check(bash(`git -C ${dir} commit -m "Add new thing"`))
      expect(decision(r)).toBe('allow')
    } finally {
      cleanup()
    }
  })

  it('empty repo: rejects conventional (handbook fallback)', () => {
    const { dir, cleanup } = makeRepo('empty')
    try {
      const r = check(bash(`git -C ${dir} commit -m "feat: add new thing"`))
      expect(decision(r)).toBe('deny')
    } finally {
      cleanup()
    }
  })

  it('mixed repo (5 conv + 5 hb): below threshold → handbook', () => {
    const { dir, cleanup } = makeRepo('mixed')
    try {
      // handbook allowed in mixed
      const r = check(bash(`git -C ${dir} commit -m "Add new thing"`))
      expect(decision(r)).toBe('allow')
    } finally {
      cleanup()
    }
  })
})

// ── hook tests ───────────────────────────────────────────────────────────────

describe('derive-preset: installed commit-msg hook in real repos', () => {
  it('conv repo: hook rejects handbook-style message', async () => {
    const { dir, cleanup } = makeRepo('conv')
    try {
      await installHook({ cwd: dir })
      const r = spawnSync('git', ['commit', '--allow-empty', '-m', 'Add a thing'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, GROUNDWORK_HOOKS_LIB: HOOKS_LIB },
      })
      expect(r.status).not.toBe(0)
    } finally {
      cleanup()
    }
  })

  it('conv repo: hook accepts conventional-style message', async () => {
    const { dir, cleanup } = makeRepo('conv')
    try {
      await installHook({ cwd: dir })
      const r = spawnSync('git', ['commit', '--allow-empty', '-m', 'feat: add a thing'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, GROUNDWORK_HOOKS_LIB: HOOKS_LIB },
      })
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('hb repo: hook accepts handbook-style message', async () => {
    const { dir, cleanup } = makeRepo('hb')
    try {
      await installHook({ cwd: dir })
      const r = spawnSync('git', ['commit', '--allow-empty', '-m', 'Add a thing'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, GROUNDWORK_HOOKS_LIB: HOOKS_LIB },
      })
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('hb repo: hook rejects conventional-style message', async () => {
    const { dir, cleanup } = makeRepo('hb')
    try {
      await installHook({ cwd: dir })
      const r = spawnSync('git', ['commit', '--allow-empty', '-m', 'feat: add a thing'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, GROUNDWORK_HOOKS_LIB: HOOKS_LIB },
      })
      expect(r.status).not.toBe(0)
    } finally {
      cleanup()
    }
  })
})
