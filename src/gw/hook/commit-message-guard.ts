import type { HookFn, HookResult } from './types.js'
import {
  lintMessage,
  resolveRepoRoot,
  hasOwnCommitTemplate,
} from '../../../hooks/lib/commit-convention.mjs'
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function passthrough(): HookResult {
  return { stdout: '', stderr: '', exit: 0 }
}

function deny(reason: string): HookResult {
  return {
    stdout:
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      }) + '\n',
    stderr: '',
    exit: 0,
  }
}

/**
 * True when the commit targets a repository that is not groundwork itself and
 * that ships its own .gitmessage. Fail-closed: any unresolved root keeps
 * groundwork's convention in force.
 */
function usesHostConvention(cwd: string): boolean {
  const groundworkRoot = resolveRepoRoot(dirname(fileURLToPath(import.meta.url)))
  if (groundworkRoot === null) return false
  const repoRoot = resolveRepoRoot(cwd)
  if (repoRoot === null || repoRoot === groundworkRoot) return false
  return hasOwnCommitTemplate(repoRoot)
}

function lintAndDecide(message: string, cwd: string): HookResult {
  const result = lintMessage(message, { hostConvention: usesHostConvention(cwd) })
  if (result.violations.length === 0) return passthrough()
  const lines = [...result.violations]
    .sort((a, b) => a.line - b.line)
    .map((v) => `  line ${v.line}: ${v.reason}`)
  return deny(`Commit message lint violations:\n${lines.join('\n')}`)
}

function extractInlineMessage(cmd: string): string | null {
  if (/\s-F[\s=]|\s--file[\s=]/.test(cmd) || / -F$/.test(cmd)) return null

  const messages: string[] = []
  let m: RegExpExecArray | null

  const mQuoted = /(?:^|\s)-m\s+(['"])([\s\S]*?)\1/g
  while ((m = mQuoted.exec(cmd)) !== null) messages.push(m[2])

  const msgLong = /--message=(['"])([\s\S]*?)\1|--message=([^\s'"]+)/g
  while ((m = msgLong.exec(cmd)) !== null) messages.push(m[2] ?? m[3] ?? '')

  const msgSpace = /--message\s+(['"])([\s\S]*?)\1/g
  while ((m = msgSpace.exec(cmd)) !== null) messages.push(m[2])

  if (messages.length === 0) return null
  return messages.join('\n\n')
}

function extractFilePath(cmd: string): string | null {
  let m: RegExpExecArray | null

  m = /--file=(['"])(.*?)\1/.exec(cmd)
  if (m) return m[2] === '-' ? null : m[2]

  m = /--file=([^\s'"]+)/.exec(cmd)
  if (m) return m[1] === '-' ? null : m[1]

  m = /--file\s+(['"])(.*?)\1/.exec(cmd)
  if (m) return m[2] === '-' ? null : m[2]

  m = /--file\s+([^\s'"]+)/.exec(cmd)
  if (m) return m[1] === '-' ? null : m[1]

  m = /(?:^|\s)-F=(['"])(.*?)\1/.exec(cmd)
  if (m) return m[2] === '-' ? null : m[2]

  m = /(?:^|\s)-F=([^\s'"]+)/.exec(cmd)
  if (m) return m[1] === '-' ? null : m[1]

  m = /(?:^|\s)-F\s+(['"])(.*?)\1/.exec(cmd)
  if (m) return m[2] === '-' ? null : m[2]

  m = /(?:^|\s)-F\s+([^\s'"]+)/.exec(cmd)
  if (m) return m[1] === '-' ? null : m[1]

  return null
}

export const run: HookFn = async (rawInput, env) => {
  try {
    if (env.GROUNDWORK_COMMIT_LINT === '0') return passthrough()

    if (typeof rawInput !== 'object' || rawInput === null) return passthrough()

    const input = rawInput as Record<string, unknown>
    if (input['tool_name'] !== 'Bash') return passthrough()

    const toolInput = input['tool_input']
    if (typeof toolInput !== 'object' || toolInput === null) return passthrough()

    const command = (toolInput as Record<string, unknown>)['command']
    if (typeof command !== 'string') return passthrough()

    if (!/\bgit\s+commit\b/.test(command)) return passthrough()

    const cmdCwd =
      typeof (toolInput as Record<string, unknown>)['cwd'] === 'string'
        ? ((toolInput as Record<string, unknown>)['cwd'] as string)
        : process.cwd()

    const inlineMsg = extractInlineMessage(command)
    if (inlineMsg !== null) return lintAndDecide(inlineMsg, cmdCwd)

    const rawPath = extractFilePath(command)
    if (rawPath !== null) {
      const filePath = resolve(cmdCwd, rawPath)
      let fileMsg: string
      try {
        const st = statSync(filePath)
        if (!st.isFile()) return passthrough()
        fileMsg = readFileSync(filePath, 'utf-8')
      } catch {
        return passthrough()
      }
      return lintAndDecide(fileMsg, cmdCwd)
    }

    return passthrough()
  } catch {
    return passthrough()
  }
}
