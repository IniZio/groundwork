#!/usr/bin/env node
/**
 * Parity-corpus capture script for hooks/prose-abbreviation-guard.mjs (PreToolUse hook).
 *
 * Runs each scenario against the real hook executable, records stdout/stderr/exit_code,
 * and writes one JSON fixture file per scenario to this directory.
 *
 * Usage:
 *   node test/fixtures/parity-corpus/prose-abbreviation-guard/capture.mjs
 *   node test/fixtures/parity-corpus/prose-abbreviation-guard/capture.mjs --verify
 *
 * NEVER touches .groundwork/ in the repo root.
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'prose-abbreviation-guard.mjs')

{
  const hookContent = readFileSync(HOOK_PATH, 'utf8')
  if (hookContent.includes('src/gw/cli/main.ts')) {
    console.error(
      'REFUSED: hooks/prose-abbreviation-guard.mjs is a gw shim — re-running capture would overwrite fixtures with shim output, making parity tautological. The corpus is frozen.',
    )
    process.exit(1)
  }
}

const PROSE_PATH = join(REPO_ROOT, 'agents-src', 'junior-orchestrator.md')
const CODE_PATH = join(REPO_ROOT, 'src', 'lib', 'foo.ts')
const FIXED_SESSION_ID = 'test-parity-pag-session-001'

function runHook(stdinPayload, extraEnv = {}) {
  const result = spawnSync(HOOK_PATH, [], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID,
      CLAUDE_PROJECT_DIR: undefined,
      CLAUDE_PLUGIN_ROOT: undefined,
      ...extraEnv,
    },
    timeout: 10000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit_code: result.status ?? 1,
  }
}

function inferDecision(result) {
  if (result.stdout.trim()) {
    try {
      const parsed = JSON.parse(result.stdout)
      if (parsed?.hookSpecificOutput?.permissionDecisionReason) return 'WARN'
    } catch { /* non-JSON stdout */ }
  }
  return 'ALLOW'
}

function editPayload(filePath, oldString, newString) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: filePath, old_string: oldString, new_string: newString },
  }
}

function writeFixture(scenarioName, fixture) {
  const outPath = join(__dirname, `${scenarioName}.json`)
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n')
  console.log(`  wrote ${outPath}`)
}

function makeTempDir(label) {
  return mkdtempSync(join(tmpdir(), `groundwork-pag-${label}-`))
}

const SCENARIOS = []

// ---------------------------------------------------------------------------

SCENARIOS.push(async function a1_cfg_introduced() {
  const stdin = editPayload(PROSE_PATH, 'Set the configuration value.', 'Set the cfg value.')
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'a1_cfg_introduced',
    description:
      "Edit on a prose path introduces 'cfg' as a new standalone word (not in old_string). Advisory fires; permissionDecision='allow', reason contains 'cfg' and TOKEN-ECONOMY-R-006.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

SCENARIOS.push(async function a2_impl_introduced_no_advisory() {
  const stdin = editPayload(
    PROSE_PATH,
    'The implementation handles this case.',
    'The impl handles this case.',
  )
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'a2_impl_introduced_no_advisory',
    description:
      "'impl' is domain vocabulary (D-4), not a prohibited abbreviation. No advisory fires even though impl is new in new_string.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

SCENARIOS.push(async function a3_fn_introduced() {
  const stdin = editPayload(
    PROSE_PATH,
    'Pass a function to the caller.',
    'Pass a fn to the caller.',
  )
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'a3_fn_introduced',
    description:
      "Edit on a prose path introduces 'fn' as a new standalone word. Advisory fires; reason contains 'fn'.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

SCENARIOS.push(async function a4_req_introduced() {
  const stdin = editPayload(
    PROSE_PATH,
    'Every requirement must be traceable.',
    'Every req must be traceable.',
  )
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'a4_req_introduced',
    description:
      "Edit on a prose path introduces 'req' as a new standalone word. Advisory fires; reason contains 'req'.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

SCENARIOS.push(async function a5_permission_decision_is_allow() {
  const stdin = editPayload(PROSE_PATH, 'Set the configuration.', 'Set the cfg.')
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'a5_permission_decision_is_allow',
    description:
      "Guard fires but is advisory-only: permissionDecision='allow', exit 0. Write proceeds despite warning.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

// ---------------------------------------------------------------------------

SCENARIOS.push(async function b1_ac_expanded() {
  const stdin = editPayload(
    PROSE_PATH,
    'Each AC must be verifiable.',
    'Each acceptance criteria must be verifiable.',
  )
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'b1_ac_expanded',
    description:
      "Old content uses 'AC'; new content replaces it with 'acceptance criteria' and omits 'AC'. Advisory fires; reason contains 'AC' and TOKEN-ECONOMY-R-006.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

SCENARIOS.push(async function b2_tbd_expanded() {
  const stdin = editPayload(
    PROSE_PATH,
    'The scope is TBD.',
    'The scope is to be determined.',
  )
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'b2_tbd_expanded',
    description:
      "Old content uses 'TBD'; new content replaces it with 'to be determined'. Advisory fires; reason contains 'TBD'.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

SCENARIOS.push(async function b3_tbr_expanded() {
  const stdin = editPayload(
    PROSE_PATH,
    'This decision is TBR.',
    'This decision is to be reviewed.',
  )
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'b3_tbr_expanded',
    description:
      "Old content uses 'TBR'; new content replaces it with 'to be reviewed'. Advisory fires; reason contains 'TBR'.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

// ---------------------------------------------------------------------------

SCENARIOS.push(async function c1_cfg_preexisting() {
  const stdin = editPayload(
    PROSE_PATH,
    'Set the cfg value.',
    'Set the cfg=true value.',
  )
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'c1_cfg_preexisting',
    description:
      "'cfg' is in both old_string and new_string — not newly introduced. No advisory fires.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

// ---------------------------------------------------------------------------

SCENARIOS.push(async function d1_first_use_definition_pattern() {
  const stdin = editPayload(
    PROSE_PATH,
    'Each AC must be verifiable.',
    'Each acceptance criteria (AC) must be verifiable.',
  )
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'd1_first_use_definition_pattern',
    description:
      "New content introduces the full form 'acceptance criteria' but also retains the short form 'AC' (valid first-use parenthetical definition). No advisory fires.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

// ---------------------------------------------------------------------------

SCENARIOS.push(async function e_impl_1_pipe_notation() {
  const stdin = editPayload(
    PROSE_PATH,
    'Add slices with --kind plan.',
    'Add slices with --kind plan|diagnose|design|impl.',
  )
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'e_impl_1_pipe_notation',
    description:
      "'impl' appears in CLI-style pipe notation. It is domain vocabulary (D-4), not a prohibited abbreviation. No advisory fires.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

SCENARIOS.push(async function e_impl_2_wave_reference() {
  const stdin = editPayload(
    PROSE_PATH,
    'The wave completes.',
    'The impl wave completes.',
  )
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'e_impl_2_wave_reference',
    description:
      "Standalone 'impl' newly introduced as a modifier. impl is domain vocabulary (D-4); no advisory fires.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

SCENARIOS.push(async function e_impl_3_impl_expanded() {
  const stdin = editPayload(
    PROSE_PATH,
    'kind defaults to impl.',
    'kind defaults to implementation.',
  )
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'e_impl_3_impl_expanded',
    description:
      "Old content uses 'impl'; new content replaces it with 'implementation' and drops 'impl'. Advisory fires on the expansion direction; reason contains 'impl'.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

// ---------------------------------------------------------------------------

SCENARIOS.push(async function e1_implementation_not_standalone() {
  const stdin = editPayload(
    PROSE_PATH,
    'The system handles this.',
    'The implementation handles this.',
  )
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'e1_implementation_not_standalone',
    description:
      "'implementation' does not match \\bimpl\\b and old has no 'impl', so no expansion fires either. No advisory.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

SCENARIOS.push(async function e2_implements_not_standalone() {
  const stdin = editPayload(
    PROSE_PATH,
    'The class does this.',
    'The class implements the interface.',
  )
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'e2_implements_not_standalone',
    description:
      "'implements' does not match \\bimpl\\b. No advisory fires.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

// ---------------------------------------------------------------------------

SCENARIOS.push(async function f1_non_prose_ts_file() {
  const stdin = editPayload(CODE_PATH, 'const configuration = {}', 'const cfg = {}')
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'f1_non_prose_ts_file',
    description:
      "file_path ends in .ts (code surface). isProse returns false → passthrough. No advisory fires even though 'cfg' is introduced.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

// ---------------------------------------------------------------------------

SCENARIOS.push(async function g1_bash_tool_passthrough() {
  const stdin = {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo hello' },
  }
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'g1_bash_tool_passthrough',
    description:
      "tool_name='Bash' is not in the guarded set {Edit, Write, MultiEdit}. Hook passes through immediately with no output.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

// ---------------------------------------------------------------------------

SCENARIOS.push(async function h1_escape_hatch_env_var() {
  const stdin = editPayload(PROSE_PATH, 'Set the configuration.', 'Set the cfg.')
  const result = runHook(stdin, { GROUNDWORK_PROSE_ABBREVIATION_GUARD: '0' })
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'h1_escape_hatch_env_var',
    description:
      "GROUNDWORK_PROSE_ABBREVIATION_GUARD=0 set in env. Hook returns passthrough immediately before any analysis.",
    env: { GROUNDWORK_PROSE_ABBREVIATION_GUARD: '0' },
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

// ---------------------------------------------------------------------------

SCENARIOS.push(async function malformed_stdin() {
  const rawInput = 'not valid json { broken'
  const r = spawnSync(HOOK_PATH, [], {
    input: rawInput,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID,
      CLAUDE_PROJECT_DIR: undefined,
      CLAUDE_PLUGIN_ROOT: undefined,
    },
    timeout: 10000,
  })
  const result = { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exit_code: r.status ?? 1 }
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'malformed_stdin',
    description:
      'Malformed (non-JSON) stdin. FAIL-OPEN: hook catches the parse error, emits nothing, and exits 0.',
    env: {},
    disk_state_setup: [],
    stdin_payload: '<non-json: "not valid json { broken">',
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

SCENARIOS.push(async function empty_stdin() {
  const r = spawnSync(HOOK_PATH, [], {
    input: '',
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID,
      CLAUDE_PROJECT_DIR: undefined,
      CLAUDE_PLUGIN_ROOT: undefined,
    },
    timeout: 10000,
  })
  const result = { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exit_code: r.status ?? 1 }
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'empty_stdin',
    description:
      "Empty stdin. input={} after trim-guard, tool_name='' is not in GUARDED set. Passthrough, no advisory.",
    env: {},
    disk_state_setup: [],
    stdin_payload: '',
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

SCENARIOS.push(async function write_tool_cfg_new_file() {
  const tmpDir = makeTempDir('write-cfg')
  const filePath = join(tmpDir, 'test-doc.md')
  const stdin = {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: 'Set the cfg value for the system.' },
  }
  let result
  try {
    result = runHook(stdin)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'write_tool_cfg_new_file',
    description:
      "Write tool on a new .md file containing 'cfg'. oldContent='' (file absent on disk). Advisory fires on contraction direction.",
    env: {},
    disk_state_setup: [],
    stdin_payload: { ...stdin, tool_input: { file_path: '<isolated_temp_dir>/test-doc.md', content: stdin.tool_input.content } },
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

SCENARIOS.push(async function multiedit_fn_introduced() {
  const stdin = {
    hook_event_name: 'PreToolUse',
    tool_name: 'MultiEdit',
    tool_input: {
      file_path: PROSE_PATH,
      edits: [
        { old_string: 'Pass a callback to the handler.', new_string: 'Pass a fn to the handler.' },
      ],
    },
  }
  const result = runHook(stdin)
  return {
    hook: 'prose-abbreviation-guard.mjs',
    hook_path: 'hooks/prose-abbreviation-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'multiedit_fn_introduced',
    description:
      "MultiEdit on a prose path. One edit introduces 'fn' as a new standalone word. Advisory fires.",
    env: {},
    disk_state_setup: [],
    stdin_payload: stdin,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: inferDecision(result),
  }
})

// ---------------------------------------------------------------------------

const VERIFY_MODE = process.argv.includes('--verify')

async function main() {
  if (VERIFY_MODE) {
    console.log('Verifying prose-abbreviation-guard corpus (re-run and compare)...')
    let passed = 0
    let failed = 0
    for (const scenario of SCENARIOS) {
      const name = scenario.name
      const fixturePath = join(__dirname, `${name}.json`)
      if (!existsSync(fixturePath)) {
        console.error(`  MISSING fixture: ${fixturePath}`)
        failed++
        continue
      }
      process.stdout.write(`  ${name}... `)
      try {
        const fresh = await scenario()
        const stored = JSON.parse(readFileSync(fixturePath, 'utf8'))
        const fields = ['stdout', 'stderr', 'exit_code', 'decision']
        const mismatches = fields.filter((f) => JSON.stringify(fresh[f]) !== JSON.stringify(stored[f]))
        if (mismatches.length === 0) {
          console.log('OK')
          passed++
        } else {
          console.error(`MISMATCH on fields: ${mismatches.join(', ')}`)
          for (const f of mismatches) {
            console.error(`    stored  ${f}: ${JSON.stringify(stored[f])}`)
            console.error(`    current ${f}: ${JSON.stringify(fresh[f])}`)
          }
          failed++
        }
      } catch (err) {
        console.error(`ERROR: ${err.message}`)
        failed++
      }
    }
    console.log(`\n${passed} passed, ${failed} failed.`)
    if (failed > 0) process.exit(1)
    return
  }

  console.log('Running prose-abbreviation-guard capture scenarios...')
  for (const scenario of SCENARIOS) {
    const name = scenario.name
    try {
      process.stdout.write(`  ${name}... `)
      const fixture = await scenario()
      writeFixture(name, fixture)
      console.log(`exit=${fixture.exit_code} (${fixture.decision})`)
    } catch (err) {
      console.error(`FAILED: ${err.message}`)
      console.error(err.stack)
    }
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
