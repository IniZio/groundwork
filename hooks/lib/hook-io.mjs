/**
 * Groundwork hook I/O — shared PreToolUse-protocol helpers used by every
 * Claude-Code-style hook (read stdin, allow the call to proceed).
 *
 * These were copied verbatim into each hook file; this module is the single
 * source of truth. Mechanical extraction only — behavior is byte-identical.
 */

/** Read raw stdin to a string. Returns '' on any read failure. */
export async function readStdin() {
  try {
    let data = ''
    for await (const chunk of process.stdin) data += chunk
    return data
  } catch {
    return ''
  }
}

/** Let the call proceed unchanged. Emitting nothing + exit 0 = normal flow. */
export function passthrough() {
  process.exit(0)
}

/**
 * Returns true when the current session was launched by an SDK-embedded agent
 * (e.g. pencil, or any tool that spawns Claude Code programmatically via the
 * Python or JS SDK).  These sessions set CLAUDE_CODE_ENTRYPOINT to "sdk-py" or
 * "sdk-js"; interactive CLI sessions use "cli" or leave it unset.
 *
 * NOTE: do NOT use process.stdin.isTTY here — Claude Code always pipes JSON to
 * hooks via stdin, so isTTY is always false even for real interactive sessions.
 */
export function isEmbeddedAgent() {
  const ep = process.env.CLAUDE_CODE_ENTRYPOINT
  return ep === 'sdk-py' || ep === 'sdk-js'
}
