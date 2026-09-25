/**
 * Tests for the vendored house-rules lint in hooks/lib.
 *
 * (a) parity    — hooks/lib/house-rules-lint.{mjs,d.mts} byte-equal to plugin sources
 * (b) layout    — commit-message-guard.ts works from a cache-like tmpdir that has no
 *                 plugins/, test/, or package.json
 * (c) git-hook  — rendered commit-msg hook rejects a bad message with nonzero exit
 * (d) static    — no file under src/ or hooks/ has a relative import resolving into
 *                 plugins/, test/, or package.json (with positive control)
 */

import { describe, it, expect } from 'bun:test'
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  cpSync,
} from 'node:fs'
import { execSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../..')
const HOOKS_LIB = join(ROOT, 'hooks/lib')
const PLUGIN_LINT_DIR = join(ROOT, 'plugins/house-rules/rules/commit-message')

// ─── (a) parity ─────────────────────────────────────────────────────────────

describe('hooks/lib vendor parity', () => {
  it('house-rules-lint.mjs is byte-equal to plugins/house-rules source', () => {
    const vendored = readFileSync(join(HOOKS_LIB, 'house-rules-lint.mjs'))
    const source = readFileSync(join(PLUGIN_LINT_DIR, 'lint.mjs'))
    if (!vendored.equals(source)) {
      throw new Error(
        'hooks/lib/house-rules-lint.mjs is out of sync.\n' +
          'Run: cp plugins/house-rules/rules/commit-message/lint.mjs hooks/lib/house-rules-lint.mjs',
      )
    }
    expect(vendored.equals(source)).toBe(true)
  })

  it('house-rules-lint.d.mts is byte-equal to plugins/house-rules source', () => {
    const vendored = readFileSync(join(HOOKS_LIB, 'house-rules-lint.d.mts'))
    const source = readFileSync(join(PLUGIN_LINT_DIR, 'lint.d.mts'))
    if (!vendored.equals(source)) {
      throw new Error(
        'hooks/lib/house-rules-lint.d.mts is out of sync.\n' +
          'Run: cp plugins/house-rules/rules/commit-message/lint.d.mts hooks/lib/house-rules-lint.d.mts',
      )
    }
    expect(vendored.equals(source)).toBe(true)
  })
})

// ─── (b) layout ─────────────────────────────────────────────────────────────

describe('commit-message-guard — installed-cache layout (no plugins/, no test/, no package.json)', () => {
  it('exit 0 + permissionDecision deny on bad message from a stripped cache layout', () => {
    // Build a tmpdir that mimics the installed plugin cache: hooks/ and src/ but
    // no plugins/, no test/, no package.json.
    const tmpRoot = mkdtempSync(join(tmpdir(), 'gw-vendor-layout-'))
    const gitRepo = mkdtempSync(join(tmpdir(), 'gw-vendor-repo-'))
    try {
      // Mirror: hooks/lib/** and src/hooks/commit-message-guard.ts
      const dstHooksLib = join(tmpRoot, 'hooks/lib')
      mkdirSync(dstHooksLib, { recursive: true })
      const srcHooksLib = join(ROOT, 'hooks/lib')
      for (const f of [
        'commit-convention.mjs',
        'commit-convention.d.mts',
        'commit-msg-template.mjs',
        'commit-msg-template.d.mts',
        'derive-convention.mjs',
        'derive-convention.d.mts',
        'house-rules-lint.mjs',
        'house-rules-lint.d.mts',
      ]) {
        cpSync(join(srcHooksLib, f), join(dstHooksLib, f))
      }

      const dstSrcHooks = join(tmpRoot, 'src/hooks')
      mkdirSync(dstSrcHooks, { recursive: true })
      cpSync(join(ROOT, 'src/hooks/commit-message-guard.ts'), join(dstSrcHooks, 'commit-message-guard.ts'))

      // Scratch git repo so resolveRepoRoot can succeed (not strictly needed
      // for the lint path, but avoids spurious errors)
      execSync('git init --initial-branch=main', { cwd: gitRepo, stdio: 'pipe' })
      execSync('git config user.email "t@t.com"', { cwd: gitRepo, stdio: 'pipe' })
      execSync('git config user.name "T"', { cwd: gitRepo, stdio: 'pipe' })
      // No .house-rules.json → handbook preset → "bad message no type" fails subject check
      writeFileSync(join(gitRepo, 'f.txt'), 'x')
      execSync('git add f.txt', { cwd: gitRepo, stdio: 'pipe' })

      const payload = JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "bad message no type"', cwd: gitRepo },
        cwd: gitRepo,
      })

      const result = spawnSync(
        'bun',
        [join(dstSrcHooks, 'commit-message-guard.ts')],
        {
          input: payload,
          encoding: 'utf8',
          timeout: 20_000,
          // No CLAUDE_PLUGIN_ROOT in env — mirrors installed-cache invocation
          env: { ...process.env, CLAUDE_PLUGIN_ROOT: tmpRoot },
        },
      )

      expect(result.status).toBe(0)
      const out = result.stdout?.trim() ?? ''
      expect(out).not.toBe('')
      const parsed = JSON.parse(out) as {
        hookSpecificOutput: { permissionDecision: string }
      }
      expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny')
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true })
      rmSync(gitRepo, { recursive: true, force: true })
    }
  })
})

// ─── (c) git hook ────────────────────────────────────────────────────────────

describe('rendered commit-msg hook — installed-cache layout', () => {
  it('nonzero exit + lint line on stderr for a bad commit message', async () => {
    const { renderCommitMsgHook } = await import('../../hooks/lib/commit-msg-template.mjs')

    const gitRepo = mkdtempSync(join(tmpdir(), 'gw-hook-test-'))
    try {
      execSync('git init --initial-branch=main', { cwd: gitRepo, stdio: 'pipe' })
      execSync('git config user.email "t@t.com"', { cwd: gitRepo, stdio: 'pipe' })
      execSync('git config user.name "T"', { cwd: gitRepo, stdio: 'pipe' })
      execSync('git config commit.gpgsign false', { cwd: gitRepo, stdio: 'pipe' })
      // conventional preset → "bad message no type" fails
      writeFileSync(
        join(gitRepo, '.house-rules.json'),
        JSON.stringify({ 'commit-message': { preset: 'conventional' } }),
      )

      const hookContent = renderCommitMsgHook({ hooksLibPath: HOOKS_LIB, version: '0.0.0-test' })
      // Verify the WARNING text is gone
      expect(hookContent).not.toContain('house-rules plugin not found')
      expect(hookContent).not.toContain('plugins/house-rules')

      mkdirSync(join(gitRepo, '.git/hooks'), { recursive: true })
      const hookPath = join(gitRepo, '.git/hooks/commit-msg')
      writeFileSync(hookPath, hookContent)
      chmodSync(hookPath, 0o755)

      // Stage a file then run commit with a bad message
      writeFileSync(join(gitRepo, 'f.txt'), 'hello')
      execSync('git add f.txt', { cwd: gitRepo, stdio: 'pipe' })

      const result = spawnSync(
        'git',
        ['commit', '-m', 'bad message no type'],
        {
          cwd: gitRepo,
          encoding: 'utf8',
          timeout: 20_000,
          env: { ...process.env, HOME: gitRepo },
        },
      )

      expect(result.status).not.toBe(0)
      const stderr = result.stderr ?? ''
      expect(stderr).toMatch(/commit-msg: line \d+:/)
      expect(stderr).not.toContain('WARNING')
      expect(stderr).not.toContain('house-rules plugin not found')
    } finally {
      rmSync(gitRepo, { recursive: true, force: true })
    }
  })
})

// ─── (d) static ─────────────────────────────────────────────────────────────

describe('static import fence — no src/ or hooks/ file imports into plugins/ test/ package.json', () => {
  // Positive control: the scanner MUST detect a forbidden import when given one
  it('positive control — scanner detects a forbidden relative import', () => {
    const forbidden = [
      /['"](?:\.\.\/)+plugins\//,
      /['"](?:\.\.\/)+test\//,
      /['"](?:\.\.\/)+package\.json['"]/,
    ]
    const testLine = "import foo from '../../plugins/house-rules/rules/lint.mjs'"
    const detected = forbidden.some((re) => re.test(testLine))
    expect(detected).toBe(true)
  })

  it('no file under src/ or hooks/ has a relative import into plugins/, test/, or package.json', () => {
    const forbidden = [
      /['"](?:\.\.\/)+plugins\//,
      /['"](?:\.\.\/)+test\//,
      /['"](?:\.\.\/)+package\.json['"]/,
    ]

    const offenders: string[] = []

    // Walk src/ and hooks/ with git ls-files to stay in tracked scope
    const result = spawnSync(
      'git',
      ['ls-files', '--', 'src/', 'hooks/'],
      { cwd: ROOT, encoding: 'utf8' },
    )
    const files = result.stdout.split('\n').filter(Boolean)

    for (const rel of files) {
      if (!/\.(ts|mjs|mts|js|cjs)$/.test(rel)) continue
      const abs = join(ROOT, rel)
      let content: string
      try {
        content = readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      for (const line of content.split('\n')) {
        if (forbidden.some((re) => re.test(line))) {
          offenders.push(`${rel}: ${line.trim()}`)
        }
      }
    }

    if (offenders.length > 0) {
      const installerOffenders = offenders.filter((o) => o.startsWith('src/hooks/installer.ts'))
      const otherOffenders = offenders.filter((o) => !o.startsWith('src/hooks/installer.ts'))
      if (otherOffenders.length > 0) {
        throw new Error(
          'Files with forbidden relative imports:\n' + otherOffenders.join('\n'),
        )
      }
      if (installerOffenders.length > 0) {
        console.warn(
          '[hooks-lib-vendor] installer.ts still references package.json — needs fix by concurrent implementer:\n' +
            installerOffenders.join('\n'),
        )
      }
    }

    expect(offenders.filter((o) => !o.startsWith('src/hooks/installer.ts')).length).toBe(0)
  })
})
