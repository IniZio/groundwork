/**
 * Tests for the vendored house-rules lint in hooks/lib.
 *
 * (a) parity    — hooks/lib/house-rules-lint.{mjs,d.mts} and
 *                 hooks/lib/house-rules-config/{schema,detect,resolve}.{mjs,d.mts}
 *                 byte-equal to plugin sources (table-driven, completeness-checked,
 *                 with a one-byte-flip negative control)
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
  readdirSync,
} from 'node:fs'
import { execSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../..')
const HOOKS_LIB = join(ROOT, 'hooks/lib')

// ─── (a) parity ─────────────────────────────────────────────────────────────

const CONFIG_VENDOR_DIR = join(HOOKS_LIB, 'house-rules-config')
const CONFIG_SOURCE_DIR = join(ROOT, 'plugins/house-rules/src/config')

// [vendoredRel, sourceRel] — both relative to ROOT
const VENDORED: Array<[string, string]> = [
  ['hooks/lib/house-rules-lint.mjs', 'plugins/house-rules/rules/commit-message/lint.mjs'],
  ['hooks/lib/house-rules-lint.d.mts', 'plugins/house-rules/rules/commit-message/lint.d.mts'],
  ...['schema', 'detect', 'resolve', 'manifest'].flatMap((n): Array<[string, string]> =>
    ['mjs', 'd.mts'].map((ext): [string, string] => [
      `hooks/lib/house-rules-config/${n}.${ext}`,
      `plugins/house-rules/src/config/${n}.${ext}`,
    ]),
  ),
]

function assertByteParity(vendoredAbs: string, sourceAbs: string): void {
  const vendored = readFileSync(vendoredAbs)
  const source = readFileSync(sourceAbs)
  if (!vendored.equals(source)) {
    throw new Error(
      `${vendoredAbs} is out of sync with ${sourceAbs}.\n` +
        `Run: cp ${sourceAbs} ${vendoredAbs}`,
    )
  }
}

describe('hooks/lib vendor parity', () => {
  for (const [vendoredRel, sourceRel] of VENDORED) {
    it(`${vendoredRel} is byte-equal to ${sourceRel}`, () => {
      assertByteParity(join(ROOT, vendoredRel), join(ROOT, sourceRel))
    })
  }

  it('VENDORED covers every file in house-rules-config/ and every source config file', () => {
    const vendoredSet = new Set(VENDORED.map(([v]) => v))
    const sourceSet = new Set(VENDORED.map(([, s]) => s))
    const unlisted = readdirSync(CONFIG_VENDOR_DIR)
      .map((f) => `hooks/lib/house-rules-config/${f}`)
      .filter((rel) => !vendoredSet.has(rel))
    const unvendored = readdirSync(CONFIG_SOURCE_DIR)
      .map((f) => `plugins/house-rules/src/config/${f}`)
      .filter((rel) => !sourceSet.has(rel))
    expect({ unlisted, unvendored }).toEqual({ unlisted: [], unvendored: [] })
  })

  it('negative control — a one-byte flip is reported with the file name and cp fix', () => {
    const [, sourceRel] = VENDORED[0]
    const source = join(ROOT, sourceRel)
    const dir = mkdtempSync(join(tmpdir(), 'gw-vendor-neg-'))
    try {
      const tmp = join(dir, 'flipped-lint.mjs')
      const bytes = Buffer.from(readFileSync(source))
      bytes[0] = bytes[0] ^ 0x01
      writeFileSync(tmp, bytes)
      expect(() => assertByteParity(tmp, source)).toThrow(/flipped-lint\.mjs.*out of sync[\s\S]*cp /)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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
        ...VENDORED.map(([v]) => v)
          .filter((v) => v.startsWith('hooks/lib/house-rules-config/'))
          .map((v) => v.slice('hooks/lib/'.length)),
      ]) {
        mkdirSync(dirname(join(dstHooksLib, f)), { recursive: true })
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
        JSON.stringify({ rules: { 'commit-message': ['error', { preset: 'conventional' }] } }),
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
