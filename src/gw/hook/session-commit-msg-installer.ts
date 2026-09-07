// SessionStart hook: auto-installs the groundwork commit-msg hook into the host project.
import type { HookFn, HookResult } from './types.js'
import { spawnSync } from 'node:child_process'
import { installHook } from '../hooks/installer.js'

function silent(): HookResult {
  return { stdout: '', stderr: '', exit: 0 }
}

function announce(msg: string): HookResult {
  return {
    stdout:
      JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: msg,
        },
      }) + '\n',
    stderr: '',
    exit: 0,
  }
}

export const run: HookFn = async (_input, env) => {
  try {
    if (env['GROUNDWORK_COMMIT_MSG_HOOK'] === '0') return silent()

    const cwd = env['CLAUDE_PROJECT_DIR'] ?? process.cwd()

    const hooksPathResult = spawnSync('git', ['config', 'core.hooksPath'], {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
    })
    if (hooksPathResult.status === 0 && hooksPathResult.stdout.trim() !== '') {
      return silent()
    }

    const result = await installHook({ cwd })

    if (result.status === 'installed') {
      return announce(`[groundwork] commit-msg hook installed in ${result.repoRoot}`)
    }
    if (result.status === 'upgraded') {
      return announce(
        `[groundwork] commit-msg hook upgraded v${result.fromVersion} → v${result.toVersion} in ${result.repoRoot}`,
      )
    }

    return silent()
  } catch {
    return silent()
  }
}
