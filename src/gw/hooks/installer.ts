import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const _dir = dirname(fileURLToPath(import.meta.url))
function _findGroundworkRoot(): { version: string; hooksLibPath: string } {
  const candidates = [
    resolve(_dir, '..', '..', '..'),
    resolve(_dir, '..'),
  ]
  for (const root of candidates) {
    try {
      const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version
      return { version, hooksLibPath: join(root, 'hooks', 'lib') }
    } catch { /* try next */ }
  }
  return { version: '0.0.0', hooksLibPath: join(_dir, '..', '..', '..', 'hooks', 'lib') }
}
const { version: CURRENT_VERSION, hooksLibPath: HOOKS_LIB_PATH } = _findGroundworkRoot()

const { renderCommitMsgHook, isGroundworkHook } = (await import(
  '../../../hooks/lib/commit-msg-template.mjs'
)) as unknown as {
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
  // resolve() handles both relative (.git) and absolute paths returned by --git-common-dir in worktrees
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
