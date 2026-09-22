#!/usr/bin/env node
/**
 * Parity-corpus capture script for hooks/prose-negation-guard.mjs (PreToolUse hook).
 *
 * Runs each scenario against the real hook executable via `node hooks/prose-negation-guard.mjs`
 * (bare path — never a shim), records stdout/stderr/exit_code verbatim, and writes one JSON
 * fixture file per scenario to this directory.
 *
 * Usage:
 *   node test/fixtures/parity-corpus/prose-negation-guard/capture.mjs          # generate
 *   node test/fixtures/parity-corpus/prose-negation-guard/capture.mjs --verify # compare
 *
 * NEVER touches .groundwork/ in the repo root — prose-negation-guard has no disk dependencies.
 * Scrubs CLAUDE_PROJECT_DIR / CLAUDE_PLUGIN_ROOT; uses a fixed CLAUDE_CODE_SESSION_ID.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'prose-negation-guard.mjs')
const VERIFY_MODE = process.argv.includes('--verify')

const PROSE_FILE_PATH = join(REPO_ROOT, 'agents-src', 'junior-orchestrator.md')
const CODE_FILE_PATH = join(REPO_ROOT, 'src', 'lib', 'foo.ts')

// ---------------------------------------------------------------------------
{
  const hookContent = readFileSync(HOOK_PATH, 'utf8')
  if (hookContent.includes('src/gw/cli/main.ts')) {
    console.error(
      'REFUSED: hooks/prose-negation-guard.mjs is a gw shim — re-running capture would ' +
        'overwrite fixtures with shim output, making parity tautological. The corpus is frozen.',
    )
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------

function buildEnv(extraEnv = {}) {
  const env = { ...process.env }
  delete env.CLAUDE_PROJECT_DIR
  delete env.CLAUDE_PLUGIN_ROOT
  env.CLAUDE_CODE_SESSION_ID = 'test-prose-negation-guard-fixed'
  return { ...env, ...extraEnv }
}

function runHook(stdinPayload, extraEnv = {}) {
  const r = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf8',
    env: buildEnv(extraEnv),
    timeout: 10000,
  })
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exit_code: r.status ?? 1 }
}

function runHookRaw(rawInput, extraEnv = {}) {
  const r = spawnSync('node', [HOOK_PATH], {
    input: rawInput,
    encoding: 'utf8',
    env: buildEnv(extraEnv),
    timeout: 10000,
  })
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exit_code: r.status ?? 1 }
}

function writeFixture(scenarioName, fixture) {
  const outPath = join(__dirname, `${scenarioName}.json`)
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n')
}

function deriveDecision(result) {
  if (!result.stdout.trim()) return 'PASSTHROUGH'
  try {
    const parsed = JSON.parse(result.stdout.trim())
    if (parsed?.hookSpecificOutput?.permissionDecisionReason) return 'ADVISE'
  } catch { /* non-JSON stdout */ }
  return 'PASSTHROUGH'
}

function editPayload(oldString, newString, filePath = PROSE_FILE_PATH) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: filePath, old_string: oldString, new_string: newString },
  }
}

function fixture(scenarioName, description, env, payload, result) {
  return {
    hook: 'prose-negation-guard.mjs',
    hook_path: 'hooks/prose-negation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: scenarioName,
    description,
    env,
    disk_state_setup: [],
    stdin_payload: payload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: deriveDecision(result),
  }
}

// ---------------------------------------------------------------------------

const SCENARIOS = []

// ---------------------------------------------------------------------------
SCENARIOS.push(function negation_not_removed() {
  const p = editPayload(
    '**You MUST NOT delegate your task wholesale to a single child agent.**',
    '**You MUST delegate your task wholesale to a single child agent.**',
  )
  return fixture(
    'negation_not_removed',
    "'NOT' stripped from MUST NOT in agents-src prose. Guard fires: advisory allow + permissionDecisionReason naming 'not'. TOKEN-ECONOMY-R-004.",
    {}, p, runHook(p),
  )
})

// ---------------------------------------------------------------------------
SCENARIOS.push(function negation_never_removed() {
  const p = editPayload(
    'This hook will never block the write.',
    'This hook will block the write.',
  )
  return fixture(
    'negation_never_removed',
    "'never' stripped from prose sentence. Guard fires: advisory allow + permissionDecisionReason naming 'never'.",
    {}, p, runHook(p),
  )
})

// ---------------------------------------------------------------------------
SCENARIOS.push(function negation_only_removed() {
  const p = editPayload(
    'Claude may only delegate to leaf workers.',
    'Claude may delegate to leaf workers.',
  )
  return fixture(
    'negation_only_removed',
    "'only' stripped from prose sentence. Guard fires: advisory allow + permissionDecisionReason naming 'only'.",
    {}, p, runHook(p),
  )
})

// ---------------------------------------------------------------------------
SCENARIOS.push(function negation_no_removed() {
  const p = editPayload(
    'There is no fallback for this path.',
    'There is a fallback for this path.',
  )
  return fixture(
    'negation_no_removed',
    "'no' stripped from prose sentence. Guard fires: advisory allow + permissionDecisionReason naming 'no'.",
    {}, p, runHook(p),
  )
})

// ---------------------------------------------------------------------------
SCENARIOS.push(function negation_sentence_aligned() {
  const p = editPayload(
    'You MUST NOT implement. You must not skip the gate.',
    'You MUST implement. You must not skip the gate.',
  )
  return fixture(
    'negation_sentence_aligned',
    "Two-sentence edit: sentence 1 loses 'NOT', sentence 2 preserves 'not'. Sentence-level detection fires for sentence 1. Guard fires: advisory allow.",
    {}, p, runHook(p),
  )
})

// ---------------------------------------------------------------------------
SCENARIOS.push(function negation_preserved_no_fire() {
  const p = editPayload('The hook proceeds.', 'The hook fires.')
  return fixture(
    'negation_preserved_no_fire',
    'old_string contains no negation word. Guard has nothing to protect: silent passthrough.',
    {}, p, runHook(p),
  )
})

// ---------------------------------------------------------------------------
SCENARIOS.push(function negation_word_intact() {
  const p = editPayload(
    '**You MUST NOT delegate your task wholesale to a single child agent.**',
    '**You MUST NOT forward the whole task 1:1 to a single child agent.**',
  )
  return fixture(
    'negation_word_intact',
    "'NOT' present in both old and new sentence. Guard finds negation preserved: silent passthrough.",
    {}, p, runHook(p),
  )
})

// ---------------------------------------------------------------------------
SCENARIOS.push(function non_prose_tool_bash() {
  const p = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo hello' } }
  return fixture(
    'non_prose_tool_bash',
    'Bash tool is not in the GUARDED set {Edit, Write, MultiEdit}. Hook short-circuits: silent passthrough.',
    {}, p, runHook(p),
  )
})

// ---------------------------------------------------------------------------
SCENARIOS.push(function non_prose_file_ts() {
  const p = editPayload(
    '// does not apply when cache is cold',
    '// applies when cache is cold',
    CODE_FILE_PATH,
  )
  return fixture(
    'non_prose_file_ts',
    ".ts extension excluded from prose surfaces by isProse(). Guard skips: silent passthrough even though 'not' is removed.",
    {}, p, runHook(p),
  )
})

// ---------------------------------------------------------------------------
SCENARIOS.push(function escape_hatch_env_var() {
  const p = editPayload(
    '**You MUST NOT delegate your task wholesale to a single child agent.**',
    '**You MUST delegate your task wholesale to a single child agent.**',
  )
  const env = { GROUNDWORK_PROSE_NEGATION_GUARD: '0' }
  return fixture(
    'escape_hatch_env_var',
    "GROUNDWORK_PROSE_NEGATION_GUARD=0 disables the guard entirely. Silent passthrough even though 'not' is removed.",
    env, p, runHook(p, env),
  )
})

// ---------------------------------------------------------------------------
SCENARIOS.push(function disable_marker_in_content() {
  const p = editPayload(
    '**You MUST NOT delegate your task wholesale to a single child agent.**',
    '**You MUST delegate your task wholesale. // prose-negation-guard:disable',
  )
  return fixture(
    'disable_marker_in_content',
    "new_string contains '// prose-negation-guard:disable'. Escape hatch marker: silent passthrough even though 'not' is removed.",
    {}, p, runHook(p),
  )
})

// ---------------------------------------------------------------------------
SCENARIOS.push(function malformed_stdin() {
  const raw = 'NOT_JSON'
  const result = runHookRaw(raw)
  return fixture(
    'malformed_stdin',
    'Stdin is not valid JSON. Hook catches the parse error and fails open: silent passthrough, exit 0.',
    {}, raw, result,
  )
})

// ---------------------------------------------------------------------------
SCENARIOS.push(function empty_stdin() {
  const result = runHookRaw('')
  return fixture(
    'empty_stdin',
    "Empty stdin. raw.trim() is falsy so input stays {}; tool_name '' is not in GUARDED: silent passthrough, exit 0.",
    {}, '', result,
  )
})

// ---------------------------------------------------------------------------

async function main() {
  if (VERIFY_MODE) {
    console.log('Verifying prose-negation-guard fixtures...')
    let passed = 0
    let failed = 0
    for (const scenario of SCENARIOS) {
      const name = scenario.name
      const fixturePath = join(__dirname, `${name}.json`)
      if (!existsSync(fixturePath)) {
        console.error(`  MISSING: ${fixturePath}`)
        failed++
        continue
      }
      const stored = JSON.parse(readFileSync(fixturePath, 'utf8'))
      const fresh = scenario()
      const issues = []
      if (fresh.exit_code !== stored.exit_code)
        issues.push(`exit_code: stored=${stored.exit_code} live=${fresh.exit_code}`)
      if (fresh.stdout !== stored.stdout)
        issues.push(`stdout: stored=${JSON.stringify(stored.stdout)} live=${JSON.stringify(fresh.stdout)}`)
      if (fresh.stderr !== stored.stderr)
        issues.push(`stderr: stored=${JSON.stringify(stored.stderr)} live=${JSON.stringify(fresh.stderr)}`)
      if (fresh.decision !== stored.decision)
        issues.push(`decision: stored=${stored.decision} live=${fresh.decision}`)
      if (issues.length > 0) {
        console.error(`  MISMATCH ${name}:\n    ${issues.join('\n    ')}`)
        failed++
      } else {
        console.log(`  ok ${name} (${stored.decision})`)
        passed++
      }
    }
    console.log(`\nVerification: ${passed} passed, ${failed} failed.`)
    if (failed > 0) process.exit(1)
  } else {
    console.log('Capturing prose-negation-guard scenarios...')
    for (const scenario of SCENARIOS) {
      const name = scenario.name
      try {
        process.stdout.write(`  ${name}... `)
        const f = scenario()
        writeFixture(name, f)
        console.log(`exit=${f.exit_code} (${f.decision})`)
      } catch (err) {
        console.error(`FAILED: ${err.message}`)
        console.error(err.stack)
      }
    }
    console.log('Done.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
