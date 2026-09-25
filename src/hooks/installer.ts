/**
 * Portable commit-msg hook installer.
 * Writes a groundwork-managed hook to .git/hooks/commit-msg.
 * Never touches committed files (.gitignore, committed hook configs).
 * Idempotent: same version → already-current, no write.
 * Foreign hooks are left untouched.
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const _dir = dirname(fileURLToPath(import.meta.url))

/**
 * Exported for testing: resolve plugin root from a given base dir.
 * In production, baseDir === _dir (the module's own directory).
 * Pass a temp dir's src/hooks path in tests to exercise the layout without
 * touching the real package.json.
 */
export function _findGroundworkRoot(baseDir?: string): { version: string; hooksLibPath: string } {
  const dir = baseDir ?? _dir
  // Module lives at <root>/src/hooks/installer.ts; root is two levels up.
  const repoRoot = resolve(dir, '..', '..')
  const hooksLibPath = join(repoRoot, 'hooks', 'lib')
  try {
    const pluginJson = JSON.parse(
      readFileSync(join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8'),
    ) as { version: string }
    if (typeof pluginJson.version !== 'string' || !pluginJson.version) {
      throw new Error('version field missing or empty')
    }
    return { version: pluginJson.version, hooksLibPath }
  } catch (err) {
    process.stderr.write(
      `[groundwork installer] ERROR: cannot read .claude-plugin/plugin.json` +
        ` (${(err as Error).message}) — version unknown; hook will not be marked current\n`,
    )
    // Sentinel: never equals a real semver, so idempotency check always misses → hook rewritten.
    return { version: '0.0.0-UNREADABLE', hooksLibPath }
  }
}

const _root = _findGroundworkRoot()
export const CURRENT_VERSION = _root.version
const HOOKS_LIB_PATH = _root.hooksLibPath

const { renderCommitMsgHook, isGroundworkHook } = (await import(
  `file://${join(HOOKS_LIB_PATH, 'commit-msg-template.mjs')}`
)) as {
  renderCommitMsgHook: (opts: { hooksLibPath: string; version: string }) => string
  isGroundworkHook: (content: string) => boolean
}

export type InstallResult =
  | { status: 'installed'; repoRoot: string }
  | { status: 'already-current'; repoRoot: string; version: string }
  | { status: 'upgraded'; repoRoot: string; fromVersion: string; toVersion: string }
  | { status: 'skipped-foreign'; repoRoot: string; hookPath: string }
  | { status: 'not-a-git-repo'; cwd: string }
  | { status: 'error'; message: string }

export type UninstallResult =
  | { status: 'removed'; repoRoot: string }
  | { status: 'not-installed'; repoRoot: string }
  | { status: 'skipped-foreign'; repoRoot: string; hookPath: string }
  | { status: 'not-a-git-repo'; cwd: string }
  | { status: 'error'; message: string }

export type HookStatus =
  | { status: 'none'; repoRoot: string }
  | { status: 'ours'; repoRoot: string; version: string }
  | { status: 'foreign'; repoRoot: string; hookPath: string }
  | { status: 'not-a-git-repo'; cwd: string }
  | { status: 'error'; message: string }

function extractVersion(content: string): string | null {
  const prefix = '# GROUNDWORK-COMMIT-MSG v'
  for (const line of content.split('\n')) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim()
  }
  return null
}

function resolveLayout(cwd: string): { repoRoot: string; hookPath: string; hooksDir: string } | null {
  const toplevel = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' })
  if (toplevel.status !== 0) return null
  const repoRoot = toplevel.stdout.trim()
  const commonDirResult = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: repoRoot, encoding: 'utf8' })
  const commonGitDir = commonDirResult.status === 0 ? commonDirResult.stdout.trim() : '.git'
  const hooksDir = join(resolve(repoRoot, commonGitDir), 'hooks')
  return { repoRoot, hookPath: join(hooksDir, 'commit-msg'), hooksDir }
}

export async function installHook(opts?: { cwd?: string }): Promise<InstallResult> {
  const cwd = opts?.cwd ?? process.cwd()
  try {
    const layout = resolveLayout(cwd)
    if (!layout) return { status: 'not-a-git-repo', cwd }
    const { repoRoot, hookPath, hooksDir } = layout
    mkdirSync(hooksDir, { recursive: true })
    const content = renderCommitMsgHook({ hooksLibPath: HOOKS_LIB_PATH, version: CURRENT_VERSION })
    if (existsSync(hookPath)) {
      const existing = readFileSync(hookPath, 'utf8')
      if (!isGroundworkHook(existing)) return { status: 'skipped-foreign', repoRoot, hookPath }
      const fromVersion = extractVersion(existing)
      if (fromVersion === CURRENT_VERSION) return { status: 'already-current', repoRoot, version: CURRENT_VERSION }
      writeFileSync(hookPath, content)
      chmodSync(hookPath, 0o755)
      return { status: 'upgraded', repoRoot, fromVersion: fromVersion ?? '', toVersion: CURRENT_VERSION }
    }
    writeFileSync(hookPath, content, { mode: 0o755 })
    chmodSync(hookPath, 0o755)
    return { status: 'installed', repoRoot }
  } catch (err) {
    return { status: 'error', message: (err as Error).message }
  }
}

export async function uninstallHook(opts?: { cwd?: string }): Promise<UninstallResult> {
  const cwd = opts?.cwd ?? process.cwd()
  try {
    const layout = resolveLayout(cwd)
    if (!layout) return { status: 'not-a-git-repo', cwd }
    const { repoRoot, hookPath } = layout
    if (!existsSync(hookPath)) return { status: 'not-installed', repoRoot }
    const content = readFileSync(hookPath, 'utf8')
    if (!isGroundworkHook(content)) return { status: 'skipped-foreign', repoRoot, hookPath }
    rmSync(hookPath)
    return { status: 'removed', repoRoot }
  } catch (err) {
    return { status: 'error', message: (err as Error).message }
  }
}

export async function getHookStatus(opts?: { cwd?: string }): Promise<HookStatus> {
  const cwd = opts?.cwd ?? process.cwd()
  try {
    const layout = resolveLayout(cwd)
    if (!layout) return { status: 'not-a-git-repo', cwd }
    const { repoRoot, hookPath } = layout
    if (!existsSync(hookPath)) return { status: 'none', repoRoot }
    const content = readFileSync(hookPath, 'utf8')
    if (isGroundworkHook(content)) return { status: 'ours', repoRoot, version: extractVersion(content) ?? '' }
    return { status: 'foreign', repoRoot, hookPath }
  } catch (err) {
    return { status: 'error', message: (err as Error).message }
  }
}
