import type { HookFn, HookResult } from './types.js'
import { lintMessage } from '../../../hooks/lib/commit-convention.mjs'

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
    if (/\s-F[\s=]|\s--file[\s=]/.test(command) || / -F$/.test(command)) return passthrough()

    const message = extractInlineMessage(command)
    if (message === null) return passthrough()

    const result = lintMessage(message)
    if (result.violations.length === 0) return passthrough()

    const lines = [...result.violations]
      .sort((a, b) => a.line - b.line)
      .map((v) => `  line ${v.line}: ${v.reason}`)
    return deny(`Commit message lint violations:\n${lines.join('\n')}`)
  } catch {
    return passthrough()
  }
}
