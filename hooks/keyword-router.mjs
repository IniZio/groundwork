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

const ROUTES = [
  {
    agents: ['groundwork:debugger'],
    patterns: [
      /\b(bug|broken|doesn'?t work|not working|error|exception|stack trace|crash|fail|failure|regression|broke)\b/i,
      /\b(debug|diagnose|root.?cause|investigate why|figure out why)\b/i,
    ],
    hint: 'Route to `groundwork:debugger` first for root-cause analysis, then `groundwork:coder` to implement the fix.',
  },
  {
    agents: ['groundwork:planner'],
    patterns: [
      /\b(plan|architect|design|system design|how should we|approach for|strategy for)\b/i,
      /\b(build .{0,40} from scratch|implement .{0,40} feature|create .{0,40} system|major feature|big feature|complex feature)\b/i,
      /\b(multi.?day|multi.?week|large.?scale|end.?to.?end system)\b/i,
    ],
    hint: 'Route to `groundwork:planner` first to create a plan in .groundwork/plans/, then fan-out `groundwork:coder` tasks.',
  },
  {
    agents: ['groundwork:critic'],
    patterns: [
      /\b(review|code review|quality|SOLID|DRY|clean code|best practices?)\b/i,
      /\bis (this|the|it|my) .{0,20}(right|correct|good)\b/i,
      /\b(validate (my|the|this) plan|check (my|the|this) (code|implementation|approach))\b/i,
    ],
    hint: 'Route to `groundwork:critic` for review. Follow with `groundwork:advisor` APPROVE gate.',
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
      /\b(commit|rebase|pull request|\bPR\b|merge|git history|squash|cherry.?pick|git log|branch strategy)\b/i,
    ],
    hint: 'Route to `groundwork:git-master` for git operations.',
  },
  {
    agents: ['groundwork:designer'],
    patterns: [
      /\b(UI|UX|styling|CSS|layout|design|responsive|visual|animation|dark mode|theme|component design)\b/i,
    ],
    hint: 'Route to `groundwork:designer` for UI/UX work.',
  },
  {
    agents: ['groundwork:advisor'],
    patterns: [
      /\b(architecture trade.?off|which (approach|option|technology)|should we use|hard decision|validate (the )?plan|strategic)\b/i,
    ],
    hint: 'Route to `groundwork:advisor` for strategic decisions and architecture trade-offs.',
  },
]

function detectRoutes(prompt) {
  const matched = []
  for (const route of ROUTES) {
    if (route.patterns.some((re) => re.test(prompt))) {
      matched.push(route)
    }
  }
  return matched
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
