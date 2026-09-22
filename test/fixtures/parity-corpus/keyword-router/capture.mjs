#!/usr/bin/env node
/**
 * Parity-corpus capture script for hooks/keyword-router.mjs (UserPromptSubmit hook).
 *
 * Runs each scenario against the real hook via `node hooks/keyword-router.mjs` (bare path,
 * never as an executable shim), records stdout/stderr/exit_code, and writes one JSON fixture
 * file per scenario to this directory.
 *
 * Usage: node test/fixtures/parity-corpus/keyword-router/capture.mjs
 *   Re-run to refresh fixtures after hook changes.
 *
 * Add --verify to replay all fixtures and assert recorded output still matches.
 * NEVER touches .groundwork/ in the repo root.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'keyword-router.mjs')
const FIXED_SESSION_ID = 'parity-capture-keyword-router-fixture'

// Guard: refuse if the hook is already a gw shim (would make parity tautological)
{
  const hookContent = readFileSync(HOOK_PATH, 'utf8')
  if (hookContent.includes('src/gw/cli/main.ts') || hookContent.includes('bin/gw-hook')) {
    console.error(
      'REFUSED: hooks/keyword-router.mjs appears to be a gw shim — re-running capture would ' +
        'overwrite fixtures with shim output, making parity tautological. The corpus is frozen.',
    )
    process.exit(1)
  }
}

/**
 * Spawn keyword-router.mjs via `node <path>` — NEVER as a bare executable (shim guard).
 * Scrubs CLAUDE_PROJECT_DIR and CLAUDE_PLUGIN_ROOT; pins CLAUDE_CODE_SESSION_ID.
 *
 * @param {string|null} stdinRaw  Raw string to feed to stdin (null-safe).
 */
function runHookRaw(stdinRaw) {
  const env = { ...process.env, CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID }
  delete env.CLAUDE_PROJECT_DIR
  delete env.CLAUDE_PLUGIN_ROOT

  const result = spawnSync('node', [HOOK_PATH], {
    input: stdinRaw ?? '',
    encoding: 'utf8',
    env,
    timeout: 10000,
  })

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit_code: result.status ?? 1,
  }
}

function runHook(stdinPayload) {
  return runHookRaw(JSON.stringify(stdinPayload))
}

function writeFixture(scenarioName, fixture) {
  const outPath = join(__dirname, `${scenarioName}.json`)
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n')
  console.log(`  wrote ${outPath}`)
}

function classifyDecision(stdout) {
  try {
    const parsed = JSON.parse(stdout.trim())
    if (parsed?.hookSpecificOutput?.additionalContext?.includes('[GROUNDWORK ROUTING SIGNAL]')) {
      return 'SIGNAL'
    }
  } catch {
    /* non-JSON — treat as NO-SIGNAL */
  }
  return 'NO-SIGNAL'
}

const SCRUBBED_ENV = {
  CLAUDE_CODE_SESSION_ID: '<fixed>',
  CLAUDE_PROJECT_DIR: '<scrubbed>',
  CLAUDE_PLUGIN_ROOT: '<scrubbed>',
}

function makeFixture(scenarioName, description, stdinPayload, result, extra = {}) {
  return {
    hook: 'keyword-router.mjs',
    hook_path: 'hooks/keyword-router.mjs',
    event_type: 'UserPromptSubmit',
    scenario_name: scenarioName,
    description,
    env: SCRUBBED_ENV,
    disk_state_setup: [],
    stdin_payload: stdinPayload,
    ...extra,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: classifyDecision(result.stdout),
  }
}

const SCENARIOS = []

// ---------------------------------------------------------------------------
// Bug / regression signals → groundwork:general-purpose
// ---------------------------------------------------------------------------

SCENARIOS.push(function bug_broken_keyword() {
  const payload = { prompt: 'this is broken and crashes on startup', role: 'user' }
  return makeFixture(
    'bug_broken_keyword',
    '"broken" keyword in genuine bug report → routes to groundwork:general-purpose (bug path)',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function bug_debug_keyword() {
  const payload = { prompt: 'debug why the cache is not invalidating', role: 'user' }
  return makeFixture(
    'bug_debug_keyword',
    '"debug" keyword in genuine prompt → routes to groundwork:general-purpose',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function bug_diagnose_hint() {
  const payload = { prompt: 'fix the login bug', role: 'user' }
  return makeFixture(
    'bug_diagnose_hint',
    '"fix the login bug" → routes to groundwork:general-purpose; hint text mentions diagnose skill FIRST',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function bug_exception_signal() {
  const payload = { prompt: 'the build fails with a stack trace in the parser module', role: 'user' }
  return makeFixture(
    'bug_exception_signal',
    '"fails" + "stack trace" → routes to groundwork:general-purpose (regression/bug path)',
    payload,
    runHook(payload),
  )
})

// ---------------------------------------------------------------------------
// Feature / planner signals → groundwork:planner
// ---------------------------------------------------------------------------

SCENARIOS.push(function feature_plan_this() {
  const payload = { prompt: 'plan this new notification system', role: 'user' }
  return makeFixture(
    'feature_plan_this',
    '"plan this" imperative → routes to groundwork:planner',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function feature_build_from_scratch() {
  const payload = { prompt: 'build a authentication system from scratch', role: 'user' }
  return makeFixture(
    'feature_build_from_scratch',
    '"build X from scratch" → routes to groundwork:planner',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function feature_implement_phrase() {
  const payload = { prompt: 'implement the workflow automation feature', role: 'user' }
  return makeFixture(
    'feature_implement_phrase',
    '"implement X feature" → routes to groundwork:planner',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function feature_architect_keyword() {
  const payload = { prompt: 'architect the new microservices approach', role: 'user' }
  return makeFixture(
    'feature_architect_keyword',
    '"architect" keyword → routes to groundwork:planner',
    payload,
    runHook(payload),
  )
})

// ---------------------------------------------------------------------------
// Review / advisor signals → groundwork:advisor
// ---------------------------------------------------------------------------

SCENARIOS.push(function advisor_review_code() {
  const payload = { prompt: 'review my auth implementation', role: 'user' }
  return makeFixture(
    'advisor_review_code',
    '"review my auth implementation" → routes to groundwork:advisor',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function advisor_validate_plan() {
  const payload = { prompt: 'validate the plan before we proceed', role: 'user' }
  return makeFixture(
    'advisor_validate_plan',
    '"validate the plan" → routes to groundwork:advisor',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function advisor_architecture_tradeoff() {
  const payload = { prompt: 'explain the architecture trade-off between REST and GraphQL', role: 'user' }
  return makeFixture(
    'advisor_architecture_tradeoff',
    '"architecture trade-off" → routes to groundwork:advisor',
    payload,
    runHook(payload),
  )
})

// ---------------------------------------------------------------------------
// Test signals → groundwork:test-engineer
// ---------------------------------------------------------------------------

SCENARIOS.push(function tests_write_tests() {
  const payload = { prompt: 'write tests for the auth module', role: 'user' }
  return makeFixture(
    'tests_write_tests',
    '"write tests" → routes to groundwork:test-engineer',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function tests_flaky_test() {
  const payload = { prompt: 'the flaky test in CI is causing issues', role: 'user' }
  return makeFixture(
    'tests_flaky_test',
    '"flaky test" phrase → routes to groundwork:test-engineer',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function tests_tdd_keyword() {
  const payload = { prompt: 'use TDD to implement this feature', role: 'user' }
  return makeFixture(
    'tests_tdd_keyword',
    '"TDD" keyword → routes to groundwork:test-engineer',
    payload,
    runHook(payload),
  )
})

// ---------------------------------------------------------------------------
// Git signals → groundwork:git-master
// ---------------------------------------------------------------------------

SCENARIOS.push(function git_commit_keyword() {
  const payload = { prompt: 'commit these changes', role: 'user' }
  return makeFixture(
    'git_commit_keyword',
    '"commit" keyword → routes to groundwork:git-master',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function git_pull_request_phrase() {
  const payload = { prompt: 'create a pull request for this branch', role: 'user' }
  return makeFixture(
    'git_pull_request_phrase',
    '"pull request" phrase → routes to groundwork:git-master',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function git_rebase_keyword() {
  const payload = { prompt: 'rebase onto main', role: 'user' }
  return makeFixture(
    'git_rebase_keyword',
    '"rebase" keyword → routes to groundwork:git-master',
    payload,
    runHook(payload),
  )
})

// ---------------------------------------------------------------------------
// Design / UI signals → groundwork:designer
// ---------------------------------------------------------------------------

SCENARIOS.push(function design_ui_keyword() {
  const payload = { prompt: 'improve the UI for the dashboard', role: 'user' }
  return makeFixture(
    'design_ui_keyword',
    '"UI" keyword → routes to groundwork:designer',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function design_layout_phrase() {
  const payload = { prompt: 'design the layout for the onboarding screen', role: 'user' }
  return makeFixture(
    'design_layout_phrase',
    '"design the layout" → routes to groundwork:designer',
    payload,
    runHook(payload),
  )
})

// ---------------------------------------------------------------------------
// No-signal scenarios
// ---------------------------------------------------------------------------

SCENARIOS.push(function no_signal_trivial() {
  const payload = { prompt: 'What is 2+2?', role: 'user' }
  return makeFixture(
    'no_signal_trivial',
    'Trivial question with no routing keywords → pass-through, no routing signal',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function no_signal_plan_noun() {
  // "plan" as a bare noun in a sentence — should NOT trigger planner routing
  const payload = { prompt: 'the plan landed well with the team', role: 'user' }
  return makeFixture(
    'no_signal_plan_noun',
    '"the plan landed" — "plan" used as noun mid-sentence → no routing (not an imperative/verb)',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function no_signal_it_plans_to() {
  const payload = { prompt: 'it plans to run the migration next week', role: 'user' }
  return makeFixture(
    'no_signal_it_plans_to',
    '"it plans to" — subordinate clause, not an imperative → no routing',
    payload,
    runHook(payload),
  )
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

SCENARIOS.push(function empty_prompt() {
  const payload = { prompt: '', role: 'user' }
  return makeFixture(
    'empty_prompt',
    'Empty prompt string → pass-through (continue:true, no hookSpecificOutput)',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function malformed_stdin() {
  const result = runHookRaw('not json at all')
  return {
    hook: 'keyword-router.mjs',
    hook_path: 'hooks/keyword-router.mjs',
    event_type: 'UserPromptSubmit',
    scenario_name: 'malformed_stdin',
    description:
      'Non-JSON stdin → hook catches JSON.parse error silently, passes through with continue:true',
    env: SCRUBBED_ENV,
    disk_state_setup: [],
    stdin_payload: null,
    stdin_raw: 'not json at all',
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: classifyDecision(result.stdout),
  }
})

// ---------------------------------------------------------------------------
// Non-user-authored turn discriminator (harness-injected turns)
// ---------------------------------------------------------------------------

SCENARIOS.push(function non_user_system_notification() {
  const payload = {
    prompt: '[SYSTEM NOTIFICATION] Session started. Context window: 200k tokens available.',
    role: 'user',
  }
  return makeFixture(
    'non_user_system_notification',
    'System notification (harness-injected) → discriminator suppresses routing regardless of content',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function non_user_task_notification_with_errors() {
  const payload = {
    prompt:
      '<task-notification>Task failed: broken build, regression detected. Error in module.</task-notification>',
    role: 'user',
  }
  return makeFixture(
    'non_user_task_notification_with_errors',
    'Task notification containing "failed", "broken", "error" → discriminator suppresses routing (not a user turn)',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function non_user_compaction_summary() {
  const payload = {
    prompt:
      '<context_window_compaction>Conversation compacted. Previous context summarized. The PR was reviewed, tests were written, fix shipped.</context_window_compaction>',
    role: 'user',
  }
  return makeFixture(
    'non_user_compaction_summary',
    'Context compaction summary containing "PR", "tests", "fix" → discriminator suppresses all routing hints',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function non_user_local_command_stdout() {
  const payload = {
    prompt:
      '<local-command-stdout>$ git status\nOn branch main\nnothing to commit, working tree clean\n</local-command-stdout>',
    role: 'user',
  }
  return makeFixture(
    'non_user_local_command_stdout',
    'Local-command stdout (harness-injected) → discriminator suppresses routing',
    payload,
    runHook(payload),
  )
})

// ---------------------------------------------------------------------------
// Multi-signal scenarios
// ---------------------------------------------------------------------------

SCENARIOS.push(function multi_signal_noise_suppressed() {
  // >3 routing groups → all suppressed
  const payload = {
    prompt: 'fix the broken design, write tests, review the code and commit the PR',
    role: 'user',
  }
  return makeFixture(
    'multi_signal_noise_suppressed',
    '>3 routing groups matched in one prompt (bug + design + tests + advisor + git) → all hints suppressed (noise prevention)',
    payload,
    runHook(payload),
  )
})

SCENARIOS.push(function multi_signal_bug_and_feature() {
  // ≤2 matched groups → both hints injected
  const payload = { prompt: 'debug this crash and plan the authentication architecture from scratch', role: 'user' }
  return makeFixture(
    'multi_signal_bug_and_feature',
    'Bug + feature signals both present (≤2 matched groups) → both agent hints injected',
    payload,
    runHook(payload),
  )
})

// ---------------------------------------------------------------------------
// False-positive guard scenarios
// ---------------------------------------------------------------------------

SCENARIOS.push(function false_positive_bare_pr() {
  // Bare "PR" without # — git-master narrowed pattern requires "PR #N" or "pull request"
  const payload = { prompt: 'I sent the PR for review', role: 'user' }
  return makeFixture(
    'false_positive_bare_pr',
    'Bare "PR" without # → git-master must NOT be triggered (pattern narrowed to "PR #N" or "pull request"); may still hit advisor via "review"',
    payload,
    runHook(payload),
  )
})

// ---------------------------------------------------------------------------
// --verify mode
// ---------------------------------------------------------------------------
function verifyMode() {
  const files = readdirSync(__dirname).filter(
    (f) => f.endsWith('.json') && f !== 'MANIFEST.json',
  )
  let pass = 0
  let fail = 0
  for (const file of files) {
    const fixture = JSON.parse(readFileSync(join(__dirname, file), 'utf8'))
    const stdinRaw =
      fixture.stdin_raw != null
        ? fixture.stdin_raw
        : JSON.stringify(fixture.stdin_payload)
    const result = runHookRaw(stdinRaw)
    const ok =
      result.stdout === fixture.stdout &&
      result.stderr === fixture.stderr &&
      result.exit_code === fixture.exit_code
    if (ok) {
      pass++
      console.log(`  PASS  ${basename(file)}`)
    } else {
      fail++
      console.log(`  FAIL  ${basename(file)}`)
      if (result.stdout !== fixture.stdout) {
        console.log(`    stdout expected: ${JSON.stringify(fixture.stdout.slice(0, 120))}`)
        console.log(`    stdout actual:   ${JSON.stringify(result.stdout.slice(0, 120))}`)
      }
      if (result.exit_code !== fixture.exit_code) {
        console.log(
          `    exit_code expected: ${fixture.exit_code}, actual: ${result.exit_code}`,
        )
      }
    }
  }
  console.log(`\n${pass} passed, ${fail} failed out of ${files.length} fixtures.`)
  if (fail > 0) process.exit(1)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (process.argv.includes('--verify')) {
    console.log('Verifying keyword-router parity fixtures...')
    verifyMode()
    return
  }

  console.log('Running keyword-router capture scenarios...')
  let count = 0
  for (const scenario of SCENARIOS) {
    const name = scenario.name
    try {
      process.stdout.write(`  ${name}... `)
      const fixture = scenario()
      writeFixture(name, fixture)
      count++
      console.log(`exit=${fixture.exit_code} (${fixture.decision})`)
    } catch (err) {
      console.error(`FAILED: ${err.message}`)
      console.error(err.stack)
    }
  }
  console.log(`Done. ${count}/${SCENARIOS.length} scenarios captured.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
