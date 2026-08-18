#!/usr/bin/env node
/**
 * Groundwork PreToolUse hook — piped-exit-code guard.
 *
 * Denies Bash commands that read $? after piping through a filter command
 * (head, tail, grep, sort, uniq, wc, cut, awk, sed).  In that pattern,
 * $? captures the LAST element of the pipeline — which is the filter, not
 * the upstream command.  Filter commands almost always exit 0, so the check
 * becomes a no-op.  This has silently swallowed a red `tsc --noEmit` and
 * a broken sentinel check in this codebase.
 *
 * DECISION: DENY (not warn).
 * Rationale: the idiom is always a correctness bug in the guarded form.
 * A warn would require the agent to self-correct; a deny forces it.  The
 * pattern is kept tight so the ALLOW list below stays airtight — false
 * positives on every Bash call would be far more disruptive than a missed
 * catch.
 *
 * Remedies (stated in the deny reason):
 *   (1) ${PIPESTATUS[0]} — reads the first command's exit status
 *   (2) n=$(cmd | wc -l); echo $n  — capture a count, not a status
 *
 * NO PIPEFAIL EXEMPTION: the guard cannot determine from a flat command
 * string whether `set -o pipefail` executes in the SAME shell scope as the
 * pipeline.  Four rounds of fixes each closed the probes under test while
 * leaving the equivalence class open: subshells `(set -o pipefail)`, command
 * substitutions `x=$(... set -o pipefail)`, here-doc bodies, and
 * escaped-quote attacks all satisfy a statement-boundary regex without
 * establishing pipefail in the outer scope.  The piped-$? shape is therefore
 * always denied, regardless of any preceding `set -o pipefail` call.
 * Use ${PIPESTATUS[0]} or capture a count instead.
 *
 * SINGLE-QUOTE STRIPPING: $? inside single-quoted strings does not expand in
 * bash.  We strip all 'literal' spans before matching so that
 *   cmd | head; echo '$?'
 * is correctly allowed.  $? inside double quotes DOES expand and is denied.
 *
 * FAIL-OPEN: any parse failure → passthrough (no false positives).
 */

import { readStdin, passthrough } from './lib/hook-io.mjs'

function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  )
  process.exit(0)
}

const DENY_REASON =
  'This command reads $? after piping through a filter (head/tail/grep/sort/uniq/wc/cut/awk/sed). ' +
  '$? captures the last pipeline element — the filter — not the upstream command. ' +
  'Filter commands almost always exit 0, so the check is a silent no-op. ' +
  'Remedies: ' +
  '(1) use ${PIPESTATUS[0]} to read the first command\'s exit status; ' +
  '(2) drop the pipe and capture a count: n=$(cmd | wc -l); echo $n.'

/**
 * Matches: pipe into a filter command, then a command separator (;, newline,
 * or &&), then a $? reference that belongs to the same logical statement.
 *
 *   \|                             — the pipe operator
 *   [^|;\n&]*                      — filter arguments (stops at any separator
 *                                    or second pipe, so the filter and the
 *                                    separator must be in the same statement)
 *   \b(filter)\b                   — one of the guarded filter commands
 *   [^|;\n&]*                      — remaining filter arguments (same tight
 *                                    bound — stops before any separator)
 *   (?:;|\n|&&)                    — command separator after which status
 *                                    would be read
 *   [ \t]*                         — optional whitespace
 *   (?:echo|printf|test|\[\[?      — optional reporting/test prefix that is
 *    |if|rc=|status=)?               known to precede $? (catches rc=$?,
 *                                    if [ $? -ne 0 ], etc.)
 *   [^;\n&|]*                      — any remaining tokens up to the next
 *                                    separator (the $? must be on this segment)
 *   \$\?                           — the exit-code variable
 *
 * NOTE: spans are bounded by [^|;\n&]* (not [^|]*), which prevents the regex
 * from crossing command separators and matching across logically independent
 * commands.  This eliminates the 68% false-positive class where a pipe and a
 * later $? belonged to different commands in a multi-statement string.
 */
const PIPED_EXIT_RE =
  /\|[^|;\n&]*\b(?:head|tail|grep|sort|uniq|wc|cut|awk|sed)\b[^|;\n&]*(?:;|\n|&&)[ \t]*(?:echo|printf|test|\[\[?|if|rc=|status=)?[^;\n&|]*\$\?/

;(async () => {
  try {
    const raw = await readStdin()
    if (!raw.trim()) return passthrough()

    const payload = JSON.parse(raw)
    if (payload.tool_name !== 'Bash') return passthrough()

    const cmd = payload?.tool_input?.command
    if (typeof cmd !== 'string' || !cmd.trim()) return passthrough()

    // Strip single-quoted strings — $? inside single quotes does not expand
    // in bash and is therefore not a status read.
    const stripped = cmd.replace(/'[^']*'/g, "''")

    if (PIPED_EXIT_RE.test(stripped)) return deny(DENY_REASON)
  } catch {
    // Fail-open on any parse error
  }

  return passthrough()
})()
