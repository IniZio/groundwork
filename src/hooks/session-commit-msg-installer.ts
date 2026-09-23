/**
 * SessionStart hook: auto-installs the groundwork commit-msg hook into the
 * host project's .git/hooks/commit-msg.
 * Silent on success, no-op, or any error condition.
 * Announce on install or upgrade only.
 * Kill-switch: GROUNDWORK_COMMIT_MSG_HOOK=0
 * Skip for embedded agents (CLAUDE_CODE_ENTRYPOINT=sdk-py|sdk-js).
 * Skip when core.hooksPath is set (the host already has a hooks mechanism).
 */

import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { installHook } from './installer.js'

function silent(): void {
  process.exit(0)
}

function announce(msg: string): void {
  process.stdout.write(
    JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: msg,
      },
    }) + '\n',
  )
  process.exit(0)
}

async function main() {
  const env = process.env as Record<string, string | undefined>

  // Skip embedded agents
  if (env['CLAUDE_CODE_ENTRYPOINT'] === 'sdk-py' || env['CLAUDE_CODE_ENTRYPOINT'] === 'sdk-js') {
    silent()
  }

  // Kill-switch
  if (env['GROUNDWORK_COMMIT_MSG_HOOK'] === '0') {
    silent()
  }

  const cwd = env['CLAUDE_PROJECT_DIR'] ?? process.cwd()

  const hooksPathResult = spawnSync('git', ['config', 'core.hooksPath'], {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
  })
  if (hooksPathResult.status === 0 && hooksPathResult.stdout.trim() !== '') {
    const hooksPath = hooksPathResult.stdout.trim()
    let dirExists = false
    try { dirExists = statSync(hooksPath).isDirectory() } catch { /* absent */ }
    if (!dirExists) {
      announce(
        `[groundwork] WARNING: core.hooksPath="${hooksPath}" does not exist — no git hooks run here. ` +
        `Fix: git config --unset core.hooksPath`,
      )
    }
    silent()
  }

  try {
    const result = await installHook({ cwd })
    if (result.status === 'installed') {
      announce(`[groundwork] commit-msg hook installed in ${result.repoRoot}`)
    }
    if (result.status === 'upgraded') {
      announce(
        `[groundwork] commit-msg hook upgraded v${result.fromVersion} → v${result.toVersion} in ${result.repoRoot}`,
      )
    }
  } catch {
    /* fail-open: never block a session */
  }

  silent()
}

main().catch(() => silent())
