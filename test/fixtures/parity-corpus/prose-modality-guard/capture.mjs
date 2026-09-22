#!/usr/bin/env node
/**
 * Parity-corpus capture script for hooks/prose-modality-guard.mjs (PreToolUse hook).
 *
 * Usage:
 *   node test/fixtures/parity-corpus/prose-modality-guard/capture.mjs
 *   node test/fixtures/parity-corpus/prose-modality-guard/capture.mjs --dry-run
 *   node test/fixtures/parity-corpus/prose-modality-guard/capture.mjs --verify
 *
 * NEVER touches .groundwork/ in the repo root — disk-state scenarios use isolated temp dirs.
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'prose-modality-guard.mjs')

{
  const hookContent = readFileSync(HOOK_PATH, 'utf8')
  if (hookContent.includes('src/gw/cli/main.ts')) {
    console.error(
      'REFUSED: hooks/prose-modality-guard.mjs is a gw shim — re-running capture would overwrite fixtures with shim output, making parity tautological. The corpus is frozen (D-10).',
    )
    process.exit(1)
  }
}

const dryRun = process.argv.includes('--dry-run')
const verifyMode = process.argv.includes('--verify')

const REAL_LINE_WITH_MAY =
  '- `general-purpose` → may delegate to `advisor` (architecture) or `explore` (codebase investigation) only; MUST NOT spawn `general-purpose` or `junior-orchestrator`'
const REAL_LINE_MAY_TO_WILL = REAL_LINE_WITH_MAY.replace('may delegate', 'will delegate')

/**
 * Spawn the hook via `node hooks/prose-modality-guard.mjs` (bare path, not a shim).
 * Scrubs CLAUDE_PROJECT_DIR and CLAUDE_PLUGIN_ROOT; pins CLAUDE_CODE_SESSION_ID.
 */
function runHook(stdinPayload, extraEnv = {}) {
  const env = { ...process.env }
  delete env.CLAUDE_PROJECT_DIR
  delete env.CLAUDE_PLUGIN_ROOT
  env.CLAUDE_CODE_SESSION_ID = 'parity-corpus-fixed-session-id'
  Object.assign(env, extraEnv)
  const result = spawnSync('node', [HOOK_PATH], {
    input: typeof stdinPayload === 'string' ? stdinPayload : JSON.stringify(stdinPayload),
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

/** Write a fixture JSON file to this directory. */
function writeFixture(scenarioName, fixture) {
  const outPath = join(__dirname, `${scenarioName}.json`)
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n')
  console.log(`  wrote ${outPath}`)
}

/** Create an isolated temp dir for a scenario. */
function makeTempDir(label) {
  return mkdtempSync(join(tmpdir(), `groundwork-pm-${label}-`))
}

/** Determine advisory decision from hook output. */
function inferDecision(result) {
  try {
    const parsed = JSON.parse(result.stdout)
    if (
      typeof parsed?.hookSpecificOutput?.permissionDecisionReason === 'string' &&
      parsed.hookSpecificOutput.permissionDecisionReason.includes('prose-modality-guard')
    ) {
      return 'WARN'
    }
  } catch {}
  return 'PASS'
}

/** Build an Edit payload targeting a prose file path. */
function editPayload(
  oldString,
  newString,
  filePath = '/home/newman/.local/share/groundwork/agents-src/orchestrator.md',
) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: filePath, old_string: oldString, new_string: newString },
  }
}

const SCENARIOS = []

// ---------------------------------------------------------------------------
SCENARIOS.push(async function edit_real_line_may_to_will() {
  const payload = editPayload(REAL_LINE_WITH_MAY, REAL_LINE_MAY_TO_WILL)
  const result = runHook(payload)
  return {
    hook: 'prose-modality-guard.mjs',
    hook_path: 'hooks/prose-modality-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'edit_real_line_may_to_will',
    description:
      'Real orchestrator.md line: "may delegate" → "will delegate". Hedge "may" removed, assertion "will" added. Advisory fires.',
    env: { CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id' },
    disk_state_setup: [],
    stdin_payload: payload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  }
})

// ---------------------------------------------------------------------------
SCENARIOS.push(async function edit_could_to_does_md() {
  const payload = editPayload(
    'This operation could fail under load with insufficient retries.',
    'This operation does fail under load with insufficient retries.',
  )
  const result = runHook(payload)
  return {
    hook: 'prose-modality-guard.mjs',
    hook_path: 'hooks/prose-modality-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'edit_could_to_does_md',
    description:
      'Edit .md: "could fail under load" → "does fail under load". Hedge "could" removed, assertion "does" added. Advisory fires.',
    env: { CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id' },
    disk_state_setup: [],
    stdin_payload: payload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  }
})

// ---------------------------------------------------------------------------
SCENARIOS.push(async function edit_might_to_always_md() {
  const payload = editPayload(
    'The hook might trigger on every restart cycle.',
    'The hook always triggers on every restart cycle.',
  )
  const result = runHook(payload)
  return {
    hook: 'prose-modality-guard.mjs',
    hook_path: 'hooks/prose-modality-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'edit_might_to_always_md',
    description:
      'Edit .md: "might trigger" → "always triggers". Hedge "might" removed, assertion "always" added. Advisory fires.',
    env: { CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id' },
    disk_state_setup: [],
    stdin_payload: payload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  }
})

// ---------------------------------------------------------------------------
SCENARIOS.push(async function edit_is_likely_to_will_md() {
  const payload = editPayload(
    'This path is likely to cause failures in high-concurrency scenarios.',
    'This path will cause failures in high-concurrency scenarios.',
  )
  const result = runHook(payload)
  return {
    hook: 'prose-modality-guard.mjs',
    hook_path: 'hooks/prose-modality-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'edit_is_likely_to_will_md',
    description:
      'Edit .md: "is likely to cause" → "will cause". Multi-word hedge "is likely to" removed, assertion "will" added. Advisory fires.',
    env: { CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id' },
    disk_state_setup: [],
    stdin_payload: payload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  }
})

// ---------------------------------------------------------------------------
SCENARIOS.push(async function edit_appears_to_does_agents_src() {
  const payload = editPayload(
    'The implementation appears to work correctly in all tested environments.',
    'The implementation does work correctly in all tested environments.',
    '/home/newman/.local/share/groundwork/agents-src/general-purpose.md',
  )
  const result = runHook(payload)
  return {
    hook: 'prose-modality-guard.mjs',
    hook_path: 'hooks/prose-modality-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'edit_appears_to_does_agents_src',
    description:
      'Edit agents-src/ .md: "appears to work" → "does work". Multi-word hedge "appears to" removed, assertion "does" added. Advisory fires.',
    env: { CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id' },
    disk_state_setup: [],
    stdin_payload: payload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  }
})

// ---------------------------------------------------------------------------
SCENARIOS.push(async function edit_sometimes_always_skills() {
  const payload = editPayload(
    'The validator sometimes fails silently when input is malformed.',
    'The validator always fails silently when input is malformed.',
    '/home/newman/.local/share/groundwork/skills/groundwork/advisor/SKILL.md',
  )
  const result = runHook(payload)
  return {
    hook: 'prose-modality-guard.mjs',
    hook_path: 'hooks/prose-modality-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'edit_sometimes_always_skills',
    description:
      'Edit skills/ .md: "sometimes fails" → "always fails". Hedge "sometimes" removed, assertion "always" added. Advisory fires.',
    env: { CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id' },
    disk_state_setup: [],
    stdin_payload: payload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  }
})

// ---------------------------------------------------------------------------
SCENARIOS.push(async function write_existing_file_upgrade() {
  const tmpDir = makeTempDir('write-upgrade')
  const filePath = join(tmpDir, 'doc.md')
  const existingContent = 'This operation may succeed on retry when the service recovers.\n'
  const newContent = 'This operation will succeed on retry when the service recovers.\n'
  try {
    writeFileSync(filePath, existingContent, 'utf8')
    const payload = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: filePath, content: newContent },
    }
    const result = runHook(payload)
    return {
      hook: 'prose-modality-guard.mjs',
      hook_path: 'hooks/prose-modality-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'write_existing_file_upgrade',
      description:
        'Write tool on existing .md file. Existing content has "may succeed", new content has "will succeed". Hook reads file from disk, detects upgrade, advisory fires.',
      env: { CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id' },
      disk_state_setup: [
        {
          path: '<isolated_temp_dir>/doc.md',
          content_summary: 'Existing .md with hedge "may succeed" — hook reads via fs.readFileSync(file_path)',
          content: existingContent,
        },
      ],
      stdin_payload: {
        ...payload,
        tool_input: { ...payload.tool_input, file_path: '<isolated_temp_dir>/doc.md' },
      },
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
SCENARIOS.push(async function multiedit_hedge_upgrade() {
  const payload = {
    hook_event_name: 'PreToolUse',
    tool_name: 'MultiEdit',
    tool_input: {
      file_path: '/home/newman/.local/share/groundwork/agents-src/junior-orchestrator.md',
      edits: [
        {
          old_string: 'This agent could delegate tasks to downstream workers efficiently.',
          new_string: 'This agent does delegate tasks to downstream workers efficiently.',
        },
      ],
    },
  }
  const result = runHook(payload)
  return {
    hook: 'prose-modality-guard.mjs',
    hook_path: 'hooks/prose-modality-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'multiedit_hedge_upgrade',
    description:
      'MultiEdit on agents-src .md: "could delegate" → "does delegate". Hedge "could" removed, assertion "does" added across edits array. Advisory fires.',
    env: { CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id' },
    disk_state_setup: [],
    stdin_payload: payload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  }
})

// ---------------------------------------------------------------------------
SCENARIOS.push(async function passthrough_env_disabled() {
  const payload = editPayload(REAL_LINE_WITH_MAY, REAL_LINE_MAY_TO_WILL)
  const result = runHook(payload, { GROUNDWORK_PROSE_MODALITY_GUARD: '0' })
  return {
    hook: 'prose-modality-guard.mjs',
    hook_path: 'hooks/prose-modality-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'passthrough_env_disabled',
    description:
      'GROUNDWORK_PROSE_MODALITY_GUARD=0 disables guard entirely. Hedge upgrade present but hook exits without advisory.',
    env: {
      CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id',
      GROUNDWORK_PROSE_MODALITY_GUARD: '0',
    },
    disk_state_setup: [],
    stdin_payload: payload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  }
})

// ---------------------------------------------------------------------------
SCENARIOS.push(async function passthrough_non_prose_ts() {
  const payload = {
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: {
      file_path: '/home/newman/.local/share/groundwork/src/lib/foo.ts',
      old_string: '// This may delegate to the parent handler.',
      new_string: '// This will delegate to the parent handler.',
    },
  }
  const result = runHook(payload)
  return {
    hook: 'prose-modality-guard.mjs',
    hook_path: 'hooks/prose-modality-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'passthrough_non_prose_ts',
    description:
      'Edit .ts file — isProse() returns false (code extension excluded). Hook passthrough even with "may" removed and "will" added.',
    env: { CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id' },
    disk_state_setup: [],
    stdin_payload: payload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  }
})

// ---------------------------------------------------------------------------
SCENARIOS.push(async function passthrough_hedge_to_hedge() {
  const payload = editPayload(
    'The agent may delegate to a specialist when uncertain.',
    'The agent might delegate to a specialist when uncertain.',
  )
  const result = runHook(payload)
  return {
    hook: 'prose-modality-guard.mjs',
    hook_path: 'hooks/prose-modality-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'passthrough_hedge_to_hedge',
    description:
      'Edit .md: "may delegate" → "might delegate". Hedge replaced with another hedge; no strong assertion (will/does/always/is) added. No advisory.',
    env: { CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id' },
    disk_state_setup: [],
    stdin_payload: payload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  }
})

// ---------------------------------------------------------------------------
SCENARIOS.push(async function passthrough_strong_in_both() {
  const payload = editPayload(
    'This will always run the initialisation phase first.',
    'This will always run the setup phase first.',
  )
  const result = runHook(payload)
  return {
    hook: 'prose-modality-guard.mjs',
    hook_path: 'hooks/prose-modality-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'passthrough_strong_in_both',
    description:
      'Edit .md: "will always run" present in both old and new. No MODAL_HEDGE removed — no upgrade. No advisory.',
    env: { CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id' },
    disk_state_setup: [],
    stdin_payload: payload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  }
})

// ---------------------------------------------------------------------------
SCENARIOS.push(async function passthrough_hedge_removed_no_assertion() {
  const payload = editPayload(
    'This feature may fail gracefully when network errors occur.',
    'This feature handles gracefully when network errors occur.',
  )
  const result = runHook(payload)
  return {
    hook: 'prose-modality-guard.mjs',
    hook_path: 'hooks/prose-modality-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'passthrough_hedge_removed_no_assertion',
    description:
      'Edit .md: "may fail" → "handles". Hedge "may" removed but no strong assertion (will/does/always/is) added. No advisory.',
    env: { CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id' },
    disk_state_setup: [],
    stdin_payload: payload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  }
})

// ---------------------------------------------------------------------------
SCENARIOS.push(async function passthrough_disable_comment() {
  const payload = editPayload(
    REAL_LINE_WITH_MAY,
    REAL_LINE_MAY_TO_WILL + '\n// prose-modality-guard:disable',
  )
  const result = runHook(payload)
  return {
    hook: 'prose-modality-guard.mjs',
    hook_path: 'hooks/prose-modality-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'passthrough_disable_comment',
    description:
      'new_string contains "// prose-modality-guard:disable". Escape hatch suppresses all analysis; no advisory even though hedge upgrade is present.',
    env: { CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id' },
    disk_state_setup: [],
    stdin_payload: payload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  }
})

// ---------------------------------------------------------------------------
SCENARIOS.push(async function passthrough_non_guarded_tool() {
  const payload = {
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: {
      file_path: '/home/newman/.local/share/groundwork/agents-src/orchestrator.md',
    },
  }
  const result = runHook(payload)
  return {
    hook: 'prose-modality-guard.mjs',
    hook_path: 'hooks/prose-modality-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'passthrough_non_guarded_tool',
    description:
      'tool_name="Read" is not in GUARDED set {Edit, Write, MultiEdit}. Hook exits without any analysis.',
    env: { CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id' },
    disk_state_setup: [],
    stdin_payload: payload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  }
})

// ---------------------------------------------------------------------------
SCENARIOS.push(async function passthrough_malformed_stdin() {
  const rawInput = '{this is not valid json'
  const result = runHook(rawInput)
  return {
    hook: 'prose-modality-guard.mjs',
    hook_path: 'hooks/prose-modality-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: 'passthrough_malformed_stdin',
    description:
      'Malformed JSON on stdin. JSON.parse throws; catch block calls passthrough(). FAIL-OPEN: exit 0, empty stdout.',
    env: { CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id' },
    disk_state_setup: [],
    stdin_payload: rawInput,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  }
})

// ---------------------------------------------------------------------------
SCENARIOS.push(async function passthrough_write_new_file() {
  const tmpDir = makeTempDir('write-new')
  const filePath = join(tmpDir, 'new-doc.md')
  try {
    const payload = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: {
        file_path: filePath,
        content: 'This operation will always succeed on the first attempt.\n',
      },
    }
    const result = runHook(payload)
    return {
      hook: 'prose-modality-guard.mjs',
      hook_path: 'hooks/prose-modality-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'passthrough_write_new_file',
      description:
        'Write tool on a non-existent .md file. fs.readFileSync throws; hook catches and calls passthrough() — new file, no prior content to protect.',
      env: { CLAUDE_CODE_SESSION_ID: 'parity-corpus-fixed-session-id' },
      disk_state_setup: [],
      stdin_payload: {
        ...payload,
        tool_input: { ...payload.tool_input, file_path: '<isolated_temp_dir>/new-doc.md' },
      },
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
async function main() {
  if (verifyMode) {
    console.log('Verifying prose-modality-guard parity fixtures...')
    let allPassed = true
    for (const scenario of SCENARIOS) {
      const name = scenario.name
      process.stdout.write(`  verify ${name}... `)
      let fixture
      try {
        fixture = await scenario()
      } catch (err) {
        console.log(`ERROR: ${err.message}`)
        allPassed = false
        continue
      }
      const fixturePath = join(__dirname, `${name}.json`)
      let existing
      try {
        existing = JSON.parse(readFileSync(fixturePath, 'utf8'))
      } catch {
        console.log('MISSING — run without --verify first')
        allPassed = false
        continue
      }
      const ok =
        fixture.stdout === existing.stdout &&
        fixture.stderr === existing.stderr &&
        fixture.exit_code === existing.exit_code
      if (ok) {
        console.log('OK')
      } else {
        console.log('MISMATCH')
        if (fixture.stdout !== existing.stdout)
          console.error(`    stdout: expected ${JSON.stringify(existing.stdout)}, got ${JSON.stringify(fixture.stdout)}`)
        if (fixture.stderr !== existing.stderr)
          console.error(`    stderr: expected ${JSON.stringify(existing.stderr)}, got ${JSON.stringify(fixture.stderr)}`)
        if (fixture.exit_code !== existing.exit_code)
          console.error(`    exit_code: expected ${existing.exit_code}, got ${fixture.exit_code}`)
        allPassed = false
      }
    }
    if (allPassed) {
      console.log('All fixtures verified OK.')
    } else {
      console.error('VERIFICATION FAILED — some fixtures do not match.')
      process.exit(1)
    }
    return
  }

  console.log('Running prose-modality-guard capture scenarios...')
  for (const scenario of SCENARIOS) {
    const name = scenario.name
    try {
      process.stdout.write(`  ${name}... `)
      const fixture = await scenario()
      const decision = inferDecision(fixture)
      fixture.decision = decision
      if (!dryRun) writeFixture(name, fixture)
      console.log(`exit=${fixture.exit_code} (${decision})`)
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
