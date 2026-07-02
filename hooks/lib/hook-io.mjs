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
