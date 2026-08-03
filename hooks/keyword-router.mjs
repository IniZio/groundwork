#!/usr/bin/env node
/**
 * Groundwork UserPromptSubmit hook — deterministic routing hint injection.
 *
 * Reads the user's prompt from stdin (Claude Code hook JSON payload), detects
 * routing signals, and injects a [GROUNDWORK ROUTING] system-reminder so the
 * orchestrator doesn't have to rely on attention span to pick the right specialist.
 *
 * This converts "LLM trust" routing into deterministic enforcement.
 */

/**
 * Patterns that identify non-user-authored turns injected by the Claude Code
 * harness (system notifications, task notifications, local-command output,
 * context compaction summaries). These turns share the UserPromptSubmit event
 * and role:"user" but are NOT written by the human — routing signals must be
 * suppressed so harness chatter doesn't trigger specialist hints.
 */
const NON_USER_TURN = /^\s*(\[SYSTEM NOTIFICATION|<task-notification>|<local-command-stdout>|<context_window_compaction>)/

const ROUTES = [
  {
    agents: ['groundwork:general-purpose'],
    patterns: [
      /\b(bug|broken|doesn'?t work|not working|error|exception|stack trace|crash|fail(?:ed|s|ing|ure)?|regression)\b/i,
      /\b(debug|diagnose|root.?cause|investigate why|figure out why)\b/i,
    ],
    hint: 'Bug or regression detected. Load the `diagnose` skill FIRST — it owns the 6-phase diagnosis loop and will guide root-cause analysis before any fix, then delegate the diagnosis-and-fix to `groundwork:general-purpose`.',
  },
  {
    agents: ['groundwork:planner'],
    patterns: [
      /\b(architect|how should we (build|structure|design|approach)|approach for|strategy for)\b/i,
      /\b(plan (this|the|a|out|it)|create (a |the )?plan|design this first|plan (the|this) (feature|system|implementation|migration|refactor))\b/i,
      /\b(build .{0,40} from scratch|implement .{0,40} feature|create .{0,40} system|major feature|big feature|complex feature)\b/i,
      /\b(multi.?day|multi.?week|large.?scale|end.?to.?end system)\b/i,
    ],
    hint: 'Route to `groundwork:planner` first. Planner MUST write a durable plan file (e.g. `.groundwork/plans/<slug>.md`) and report it as `plan_ref` to the orchestrator BEFORE any fan-out — never fan out from a memory-only plan. Then `vertical-slice` + `groundwork:general-purpose`.',
  },
  {
    agents: ['groundwork:advisor'],
    patterns: [
      /\b(code review|quality check|SOLID|DRY|clean code|best practices?)\b/i,
      /\breview (my|the|this)( \w+)? (code|implementation|PR|pull request|approach|design)\b/i,
      /\bis (this|the|it|my) .{0,20}(right|correct|good)\b/i,
      /\b(validate (my|the|this) plan|check (my|the|this) (code|implementation|approach))\b/i,
    ],
    hint: 'Route to `groundwork:advisor` for review and quality checks.',
  },
  {
    agents: ['groundwork:test-engineer'],
    patterns: [
      /\b(write tests|test coverage|flaky test|TDD|unit test|integration test|test strategy|e2e test|testing plan)\b/i,
    ],
    hint: 'Route to `groundwork:test-engineer` for test strategy and implementation.',
  },
  {
    agents: ['groundwork:git-master'],
    patterns: [
      /\b(commit|rebase|pull request|PR\s*#|merge|git history|squash|cherry.?pick|git log|branch strategy)\b/i,
    ],
    hint: 'Route to `groundwork:git-master` for git operations.',
  },
  {
    agents: ['groundwork:designer'],
    patterns: [
      /\b(UI|UX|styling|CSS|layout|responsive|visual design|animation|dark mode|theme|component design|design system)\b/i,
      /\b(design (the|a|this) (UI|UX|interface|layout|screen|page|component|modal|button|form))\b/i,
    ],
    hint: 'Route to `groundwork:designer` for UI/UX work.',
  },
  {
    agents: ['groundwork:advisor'],
    patterns: [
      /\b(architecture trade.?off|which (approach|option|technology)|should we use|hard decision|validate (the )?plan|strategic)\b/i,
      /\b(advisor gate|completion gate|declare done|mark as complete|all done|task complete|ready for review)\b/i,
    ],
    hint: 'Route to `groundwork:advisor` for strategic decisions and architecture trade-offs.',
  },
  {
    agents: ['groundwork:advisor'],
    patterns: [
      /\b(is it done|are we done|check if complete|is this complete|prove it works|show evidence|completion check|are all tests passing|does it pass)\b/i,
      /\b(verify (this|it|the implementation|the fix|the feature) works|verify this is (correct|done|complete|working)\b)/i,
      /\b(ready to ship|ship it|can we merge)\b/i,
    ],
    hint: 'Route to `groundwork:advisor` — completion verification requested. The advisor ensures no task is marked done without fresh, verifiable proof (rejects "should", "probably", "seems to").',
  },
]

function detectRoutes(prompt) {
  const matched = []
  for (const route of ROUTES) {
    if (route.patterns.some((re) => re.test(prompt))) {
      matched.push(route)
    }
  }
  // A prompt matching >3 distinct route groups is almost certainly conversational.
  // Suppress all hints rather than flooding the context with contradictory routing.
  if (matched.length > 3) return []
  // Cap at 2 strongest matches (first-matched = highest-priority routes).
  return matched.slice(0, 2)
}

async function main() {
  let body = ''
  for await (const chunk of process.stdin) {
    body += chunk
  }

  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    // Not JSON — pass through silently
    console.log(JSON.stringify({ continue: true }))
    return
  }

  // Claude Code UserPromptSubmit hook schema: { prompt: string, role: string, ... }
  const prompt = payload?.prompt ?? ''
  if (!prompt) {
    console.log(JSON.stringify({ continue: true }))
    return
  }

  // Skip routing for non-user-authored turns (system notifications, task
  // notifications, local-command stdout, context compaction summaries).
  // All share role:"user" — discrimination must be content-based.
  if (NON_USER_TURN.test(prompt)) {
    console.log(JSON.stringify({ continue: true }))
    return
  }

  const matched = detectRoutes(prompt)
  if (matched.length === 0) {
    console.log(JSON.stringify({ continue: true }))
    return
  }

  const hints = matched.map((r) => `- ${r.hint}`).join('\n')
  const agentNames = [...new Set(matched.flatMap((r) => r.agents))].join(', ')

  const context = `[GROUNDWORK ROUTING SIGNAL]
Detected routing signals in this prompt → ${agentNames}

${hints}

Apply this routing immediately. Do not implement directly.`

  console.log(
    JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context,
      },
    }),
  )
}

main().catch((err) => {
  process.stderr.write(`keyword-router error: ${err.message}\n`)
  console.log(JSON.stringify({ continue: true }))
})
