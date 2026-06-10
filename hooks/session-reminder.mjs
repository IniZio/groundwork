#!/usr/bin/env node
/**
 * Groundwork SessionStart hook — injects orchestrator routing rules as a system-reminder.
 *
 * Fires on startup, resume, and context compaction so behavioral compliance
 * survives long sessions. Called by session-start (the tracked hook entrypoint).
 */

/** Read all of stdin; resolve '' if stdin is empty, closed, or errors. Never throws. */
async function readStdin() {
  try {
    let data = ''
    for await (const chunk of process.stdin) data += chunk
    return data
  } catch {
    return ''
  }
}

const reminder = `# groundwork — Orchestrator Mode

You are the ORCHESTRATOR. Classify, delegate, review. NEVER implement directly.

## Routing (use \`groundwork:\` prefix on all subagent_type values)

| Signal | Agent |
|---|---|
| Bug / error / stack trace / "doesn't work" | \`groundwork:debugger\` → then \`coder\` to fix |
| Feature (≥1h, multi-file, unclear scope) | \`groundwork:planner\` → read plan → fan-out \`coder\` |
| Small clear change (<1h, localized) | \`groundwork:coder\` direct |
| "Plan this" / "design this" / architecture | \`groundwork:planner\` |
| "Review" / "check quality" / SOLID | \`groundwork:critic\` → \`groundwork:advisor\` gate |
| Security / auth / OWASP / injection | \`groundwork:security-reviewer\` |
| Tests / coverage / TDD / flaky | \`groundwork:test-engineer\` |
| Git / commit / rebase / PR | \`groundwork:git-master\` |
| UI / styling / layout / design | \`groundwork:designer\` |
| "Explore" / "how does" / "where is" | built-in Explore (no prefix) |
| Hard decision / architecture trade-off | \`groundwork:advisor\` |
| Completion check | \`groundwork:verifier\` → \`groundwork:critic\` → \`groundwork:advisor\` APPROVE |

## Fan-out rule
ALL parallel Task calls in ONE message. Never sequential across messages.

## Completion gate (mandatory)
verifier → critic → advisor APPROVE before declaring done.`

let input = {}
try {
  const raw = await readStdin()
  if (raw.trim()) input = JSON.parse(raw)
} catch {
  // Invalid JSON or stdin failure — proceed without session identity.
}

let additionalContext = reminder
const sessionId = typeof input?.session_id === 'string' ? input.session_id : ''
const transcriptPath = typeof input?.transcript_path === 'string' ? input.transcript_path : ''
if (sessionId || transcriptPath) {
  const lines = ['', '## Session identity']
  if (sessionId) lines.push(`- session_id: ${sessionId}`)
  if (transcriptPath) lines.push(`- transcript_path: ${transcriptPath}`)
  lines.push('', "When performing a session handoff (/groundwork:handoff), reference these values so the successor session can locate this session's transcript.")
  additionalContext += `\n${lines.join('\n')}`
}

console.log(JSON.stringify({
  continue: true,
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext,
  },
}))
