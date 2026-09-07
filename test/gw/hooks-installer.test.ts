import { execSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { installHook, uninstallHook, getHookStatus } from '#src/gw/hooks/installer.js'

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'hooks-test-'))
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })
  execSync('git config commit.gpgsign false', { cwd: dir, stdio: 'pipe' })
  execSync('git commit --allow-empty -m "chore: initial"', { cwd: dir, stdio: 'pipe' })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('gw hooks installer', () => {
  it('1. install into clean repo — hook present, exec bit set, git commit works', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      const result = await installHook({ cwd: dir })
      expect(result.status).toBe('installed')

      const hookPath = path.join(dir, '.git', 'hooks', 'commit-msg')
      expect(existsSync(hookPath)).toBe(true)
      expect(statSync(hookPath).mode & 0o111).toBeGreaterThan(0)

      const bad = spawnSync('git', ['commit', '--allow-empty', '-m', 'bad message'], {
        cwd: dir,
        encoding: 'utf8',
      })
      expect(bad.status).not.toBe(0)

      const good = spawnSync('git', ['commit', '--allow-empty', '-m', 'feat: add feature'], {
        cwd: dir,
        encoding: 'utf8',
      })
      expect(good.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('2. idempotent install — second install returns already-current, file byte-identical', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      const first = await installHook({ cwd: dir })
      expect(first.status).toBe('installed')

      const hookPath = path.join(dir, '.git', 'hooks', 'commit-msg')
      const before = readFileSync(hookPath, 'utf8')

      const second = await installHook({ cwd: dir })
      expect(second.status).toBe('already-current')

      const after = readFileSync(hookPath, 'utf8')
      expect(after).toBe(before)
    } finally {
      cleanup()
    }
  })

  it('3. foreign hook left byte-identical (bite proof on load-bearing assertion)', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      const hooksDir = path.join(dir, '.git', 'hooks')
      const hookPath = path.join(hooksDir, 'commit-msg')
      mkdirSync(hooksDir, { recursive: true })
      const FOREIGN = '#!/bin/sh\necho "foreign hook"\nexit 0\n'
      writeFileSync(hookPath, FOREIGN)

      // BITE PROOF: naive overwrite DOES change the file — proves assertion is sensitive
      const naiveContent = '#!/bin/sh\necho "clobbered"\n'
      writeFileSync(hookPath, naiveContent)
      expect(readFileSync(hookPath, 'utf8')).not.toBe(FOREIGN) // naive DID clobber
      writeFileSync(hookPath, FOREIGN) // restore

      // Real installHook must NOT change the file
      const result = await installHook({ cwd: dir })

      expect(result.status).toBe('skipped-foreign')
      expect(readFileSync(hookPath, 'utf8')).toBe(FOREIGN) // load-bearing: byte-identical preserved
      if (result.status === 'skipped-foreign') {
        expect(result.hookPath).toBe(hookPath)
      }
    } finally {
      cleanup()
    }
  })

  it('4. upgrade from older version — result upgraded, file updated, version fields correct', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      const hooksDir = path.join(dir, '.git', 'hooks')
      const hookPath = path.join(hooksDir, 'commit-msg')
      mkdirSync(hooksDir, { recursive: true })
      const oldHook = '#!/bin/bash\n# GROUNDWORK-COMMIT-MSG v0.0.1\n# Managed by groundwork\nexit 0\n'
      writeFileSync(hookPath, oldHook, { mode: 0o755 })

      const result = await installHook({ cwd: dir })
      expect(result.status).toBe('upgraded')

      if (result.status === 'upgraded') {
        expect(result.fromVersion).toBe('0.0.1')
        expect(result.toVersion).toMatch(/^\d+\.\d+\.\d+/)
      }

      expect(readFileSync(hookPath, 'utf8')).not.toBe(oldHook)
    } finally {
      cleanup()
    }
  })

  it('5a. uninstall after install — removed, file gone', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      await installHook({ cwd: dir })
      const hookPath = path.join(dir, '.git', 'hooks', 'commit-msg')
      expect(existsSync(hookPath)).toBe(true)

      const result = await uninstallHook({ cwd: dir })
      expect(result.status).toBe('removed')
      expect(existsSync(hookPath)).toBe(false)
    } finally {
      cleanup()
    }
  })

  it('5b. uninstall of foreign hook — skipped-foreign, file byte-identical', async () => {
    const { dir, cleanup } = makeRepo()
    try {
      const hooksDir = path.join(dir, '.git', 'hooks')
      const hookPath = path.join(hooksDir, 'commit-msg')
      mkdirSync(hooksDir, { recursive: true })
      const FOREIGN = '#!/bin/sh\necho "foreign hook"\nexit 0\n'
      writeFileSync(hookPath, FOREIGN)

      const result = await uninstallHook({ cwd: dir })
      expect(result.status).toBe('skipped-foreign')
      expect(readFileSync(hookPath, 'utf8')).toBe(FOREIGN)
    } finally {
      cleanup()
    }
  })

  it('6. getHookStatus reports none / ours / foreign', async () => {
    const { dir: dirA, cleanup: cleanA } = makeRepo()
    try {
      const none = await getHookStatus({ cwd: dirA })
      expect(none.status).toBe('none')
    } finally {
      cleanA()
    }

    const { dir: dirB, cleanup: cleanB } = makeRepo()
    try {
      await installHook({ cwd: dirB })
      const ours = await getHookStatus({ cwd: dirB })
      expect(ours.status).toBe('ours')
      if (ours.status === 'ours') {
        expect(ours.version).toMatch(/^\d+\.\d+\.\d+/)
      }
    } finally {
      cleanB()
    }

    const { dir: dirC, cleanup: cleanC } = makeRepo()
    try {
      const hooksDir = path.join(dirC, '.git', 'hooks')
      mkdirSync(hooksDir, { recursive: true })
      writeFileSync(path.join(hooksDir, 'commit-msg'), '#!/bin/sh\nexit 0\n')
      const foreign = await getHookStatus({ cwd: dirC })
      expect(foreign.status).toBe('foreign')
    } finally {
      cleanC()
    }
  })

  it('7. not-a-git-repo — install and getHookStatus return not-a-git-repo', async () => {
    const plainDir = mkdtempSync(path.join(tmpdir(), 'hooks-nogit-'))
    try {
      const installResult = await installHook({ cwd: plainDir })
      expect(installResult.status).toBe('not-a-git-repo')

      const statusResult = await getHookStatus({ cwd: plainDir })
      expect(statusResult.status).toBe('not-a-git-repo')
    } finally {
      rmSync(plainDir, { recursive: true, force: true })
    }
  })
})
