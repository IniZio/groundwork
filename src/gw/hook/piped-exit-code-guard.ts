import type { HookFn, HookResult } from './types.js'

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

const DENY_REASON =
  'This command reads $? after piping through a filter (head/tail/grep/sort/uniq/wc/cut/awk/sed). ' +
  '$? captures the last pipeline element — the filter — not the upstream command. ' +
  'Filter commands almost always exit 0, so the check is a silent no-op. ' +
  'Remedies: ' +
  "(1) use ${PIPESTATUS[0]} to read the first command's exit status; " +
  '(2) drop the pipe and capture a count: n=$(cmd | wc -l); echo $n.'

/**
 * Matches: pipe into a filter command, then a command separator (;, newline,
 * or &&), then a $? reference that belongs to the same logical statement.
 */
const PIPED_EXIT_RE =
  /\|[^|;\n&]*\b(?:head|tail|grep|sort|uniq|wc|cut|awk|sed)\b[^|;\n&]*(?:;|\n|&&)[ \t]*(?:echo|printf|test|\[\[?|if|rc=|status=)?[^;\n&|]*\$\?/

export const run: HookFn = async (input, _env): Promise<HookResult> => {
  try {
    const inp = (input ?? {}) as Record<string, unknown>

    if (inp.tool_name !== 'Bash') return passthrough()

    const toolInput = (inp.tool_input ?? {}) as Record<string, unknown>
    const cmd = toolInput.command
    if (typeof cmd !== 'string' || !cmd.trim()) return passthrough()

    // Strip single-quoted strings — $? inside single quotes does not expand
    // in bash and is therefore not a status read.
    const stripped = cmd.replace(/'[^']*'/g, "''")

    if (PIPED_EXIT_RE.test(stripped)) return deny(DENY_REASON)
  } catch {
    // Fail-open on any parse error
  }

  return passthrough()
}
