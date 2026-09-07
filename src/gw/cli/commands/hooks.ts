import { type GwEnvelope, errEnvelope, okEnvelope } from '../envelope.js'
import {
  type InstallResult,
  type UninstallResult,
  type HookStatus,
  installHook,
  uninstallHook,
  getHookStatus,
} from '../../hooks/installer.js'

export const HOOKS_SUBCOMMANDS = ['install', 'uninstall', 'status'] as const

async function runInstall(cwd: string): Promise<GwEnvelope> {
  const result: InstallResult = await installHook({ cwd })
  switch (result.status) {
    case 'installed':
      return okEnvelope('hooks install', {
        status: 'installed',
        repoRoot: result.repoRoot,
        message: `Installed commit-msg hook at ${result.repoRoot}/.git/hooks/commit-msg`,
      })
    case 'already-current':
      return okEnvelope('hooks install', {
        status: 'already-current',
        version: result.version,
        repoRoot: result.repoRoot,
        message: `Hook already up to date (v${result.version}) at ${result.repoRoot}`,
      })
    case 'upgraded':
      return okEnvelope('hooks install', {
        status: 'upgraded',
        fromVersion: result.fromVersion,
        toVersion: result.toVersion,
        repoRoot: result.repoRoot,
        message: `Upgraded hook from v${result.fromVersion} to v${result.toVersion} at ${result.repoRoot}`,
      })
    case 'skipped-foreign':
      return errEnvelope(
        'hooks install',
        'FOREIGN_HOOK',
        `A non-groundwork commit-msg hook already exists at ${result.hookPath} — refusing to overwrite. Remove it manually if you want to install groundwork's hook.`,
        1,
      )
    case 'not-a-git-repo':
      return errEnvelope('hooks install', 'NOT_GIT_REPO', `Not a git repository: ${result.cwd}`, 1)
    case 'error':
      return errEnvelope('hooks install', 'INSTALL_ERROR', result.message, 1)
  }
}

async function runUninstall(cwd: string): Promise<GwEnvelope> {
  const result: UninstallResult = await uninstallHook({ cwd })
  switch (result.status) {
    case 'removed':
      return okEnvelope('hooks uninstall', {
        status: 'removed',
        repoRoot: result.repoRoot,
        message: `Removed commit-msg hook from ${result.repoRoot}`,
      })
    case 'not-installed':
      return okEnvelope('hooks uninstall', {
        status: 'not-installed',
        repoRoot: result.repoRoot,
        message: `No groundwork hook installed at ${result.repoRoot}`,
      })
    case 'skipped-foreign':
      return errEnvelope(
        'hooks uninstall',
        'FOREIGN_HOOK',
        `Not our hook at ${result.hookPath} — refusing to remove. Remove it manually if needed.`,
        1,
      )
    case 'not-a-git-repo':
      return errEnvelope('hooks uninstall', 'NOT_GIT_REPO', `Not a git repository: ${result.cwd}`, 1)
    case 'error':
      return errEnvelope('hooks uninstall', 'UNINSTALL_ERROR', result.message, 1)
  }
}

async function runStatus(cwd: string): Promise<GwEnvelope> {
  const result: HookStatus = await getHookStatus({ cwd })
  switch (result.status) {
    case 'none':
      return okEnvelope('hooks status', {
        status: 'none',
        repoRoot: result.repoRoot,
        message: `No commit-msg hook installed at ${result.repoRoot}`,
      })
    case 'ours':
      return okEnvelope('hooks status', {
        status: 'ours',
        repoRoot: result.repoRoot,
        version: result.version,
        message: `groundwork hook v${result.version} installed at ${result.repoRoot}`,
      })
    case 'foreign':
      return okEnvelope('hooks status', {
        status: 'foreign',
        repoRoot: result.repoRoot,
        hookPath: result.hookPath,
        message: `Foreign (non-groundwork) commit-msg hook at ${result.hookPath}`,
      })
    case 'not-a-git-repo':
      return errEnvelope('hooks status', 'NOT_GIT_REPO', `Not a git repository: ${result.cwd}`, 1)
    case 'error':
      return errEnvelope('hooks status', 'STATUS_ERROR', result.message, 1)
  }
}

export async function run(args: string[], cwd: string): Promise<GwEnvelope> {
  const [subcmd, ...rest] = args
  void rest
  if (subcmd === 'install') return runInstall(cwd)
  if (subcmd === 'uninstall') return runUninstall(cwd)
  if (subcmd === 'status') return runStatus(cwd)
  return errEnvelope(
    'hooks',
    'UNKNOWN_SUBCOMMAND',
    `Unknown subcommand: "${subcmd}". Use: ${HOOKS_SUBCOMMANDS.join(', ')}`,
    2,
  )
}
