#!/usr/bin/env node
/**
 * Parity-corpus capture script for hooks/doc-size-guard.mjs (PostToolUse hook).
 *
 * Usage:
 *   node test/fixtures/parity-corpus/doc-size-guard/capture.mjs           # generate
 *   node test/fixtures/parity-corpus/doc-size-guard/capture.mjs --verify  # re-run and compare
 *
 * NEVER touches .groundwork/ in the repo root — each scenario uses an isolated temp dir.
 *
 * Decision vocabulary:
 *   PASS — exit 0, empty stdout (passthrough / fail-open)
 *   WARN — exit 0, stdout contains "doc-size-guard: violation"
 *
 * Normalization: the real tmpDir path is replaced with '<isolated_temp_dir>' in
 * stdin_payload and stdout before writing, so fixtures are reproducible across runs.
 * The parity test runner must interpolate '<isolated_temp_dir>' in stdin_payload when
 * invoking the GW TS implementation (doc-size-guard uses process.cwd() as rootDir).
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'doc-size-guard.mjs')
const OUT_DIR = __dirname
const PLACEHOLDER = '<isolated_temp_dir>'
const FIXED_SESSION_ID = 'parity-corpus-doc-size-guard'

// ---------------------------------------------------------------------------
{
  const src = readFileSync(HOOK_PATH, 'utf8')
  if (src.includes('src/gw/cli/main.ts')) {
    console.error(
      'REFUSED: hooks/doc-size-guard.mjs is a gw shim — re-running capture would overwrite\n' +
      'fixtures with shim output, making parity tautological. The corpus is frozen.',
    )
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------

function makeTempDir(label) {
  return mkdtempSync(join(tmpdir(), `dsg-${label}-`))
}

function buildEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  delete env.CLAUDE_PROJECT_DIR
  delete env.CLAUDE_PLUGIN_ROOT
  env.CLAUDE_CODE_SESSION_ID = FIXED_SESSION_ID
  return env
}

/**
 * Spawn hooks/doc-size-guard.mjs via `node <path>` (never a shim) with
 * cwd=tmpDir and JSON-encoded stdinPayload piped to stdin.
 */
function runHook(tmpDir, stdinPayload, extraEnv = {}) {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf8',
    cwd: tmpDir,
    env: buildEnv(extraEnv),
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit_code: result.status ?? (result.error ? 1 : 0),
  }
}

function runHookRaw(tmpDir, rawInput, extraEnv = {}) {
  const result = spawnSync('node', [HOOK_PATH], {
    input: rawInput,
    encoding: 'utf8',
    cwd: tmpDir,
    env: buildEnv(extraEnv),
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit_code: result.status ?? (result.error ? 1 : 0),
  }
}

function norm(s, tmpDir) {
  return s.split(tmpDir).join(PLACEHOLDER)
}

function normPayload(payload, tmpDir) {
  return JSON.parse(JSON.stringify(payload).split(tmpDir).join(PLACEHOLDER))
}

function classifyDecision(stdout) {
  return stdout.includes('doc-size-guard: violation') ? 'WARN' : 'PASS'
}

function writeFixture(name, fixture) {
  writeFileSync(join(OUT_DIR, `${name}.json`), JSON.stringify(fixture, null, 2) + '\n', 'utf8')
}

// ---------------------------------------------------------------------------

/**
 * Build document content of `totalBytes` bytes.
 * hasSummary: non-empty block before first ## (satisfies summary-header check).
 * hasAnchor: at least one ## heading (satisfies section-anchor check).
 */
function makeContent(totalBytes, hasSummary, hasAnchor) {
  const header = hasSummary ? '# Big Document\n\nSome introductory text.\n\n' : ''
  const anchor = hasAnchor ? '## Section One\n\n' : ''
  const prefix = header + anchor
  return prefix + 'x'.repeat(Math.max(0, totalBytes - prefix.length))
}

/**
 * Budget boundary constants.
 * estimateTokens = Math.ceil(byteLength / 3.5).
 *   plan (3000 tok):  10500 bytes = at budget (passthrough), 10501 = 3001 tok (violation territory)
 *   narrative (2000): 7001 bytes = 2001 tok (violation territory)
 *   rfc-index (12000): 42001 bytes = 12001 tok (violation territory)
 */
const PLAN_UNDER_BYTES     = 10499
const PLAN_AT_BUDGET_BYTES = 10500
const PLAN_JUST_OVER_BYTES = 10501
const PLAN_BIG_BYTES       = 11000
const NAR_JUST_OVER_BYTES  = 7001
const RFC_JUST_OVER_BYTES  = 42001

// ---------------------------------------------------------------------------

const SCENARIOS = []

// ---------------------------------------------------------------------------

SCENARIOS.push(async function non_guarded_tool() {
  const tmpDir = makeTempDir('s01')
  try {
    mkdirSync(join(tmpDir, '.groundwork', 'plans'), { recursive: true })
    const fp = join(tmpDir, '.groundwork', 'plans', 'doc.md')
    const content = makeContent(PLAN_BIG_BYTES, false, false)
    writeFileSync(fp, content)
    const payload = { tool_name: 'Read', tool_input: { file_path: fp } }
    const result = runHook(tmpDir, payload)
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'non_guarded_tool',
      description: 'Read tool is not in the guarded set (write|edit|multiedit) — passthrough before any file check.',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [{ path: '.groundwork/plans/doc.md', content }],
      stdin_payload: normPayload(payload, tmpDir),
      stdout: norm(result.stdout, tmpDir),
      stderr: norm(result.stderr, tmpDir),
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

SCENARIOS.push(async function unclassified_file() {
  const tmpDir = makeTempDir('s02')
  try {
    mkdirSync(join(tmpDir, 'src'), { recursive: true })
    const fp = join(tmpDir, 'src', 'foo.ts')
    writeFileSync(fp, 'export const x = 1\n')
    const payload = { tool_name: 'Write', tool_input: { file_path: fp } }
    const result = runHook(tmpDir, payload)
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'unclassified_file',
      description: '.ts file does not match any doc class — classifyDoc returns null, passthrough.',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [{ path: 'src/foo.ts', content: 'export const x = 1\n' }],
      stdin_payload: normPayload(payload, tmpDir),
      stdout: norm(result.stdout, tmpDir),
      stderr: norm(result.stderr, tmpDir),
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

SCENARIOS.push(async function plan_under_budget() {
  const tmpDir = makeTempDir('s03')
  try {
    mkdirSync(join(tmpDir, '.groundwork', 'plans'), { recursive: true })
    const fp = join(tmpDir, '.groundwork', 'plans', 'doc.md')
    writeFileSync(fp, 'x'.repeat(PLAN_UNDER_BYTES))
    const payload = { tool_name: 'Write', tool_input: { file_path: fp } }
    const result = runHook(tmpDir, payload)
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'plan_under_budget',
      description: 'plan file 10499 bytes → ceil(10499/3.5)=3000 tokens ≤ 3000 budget — passthrough.',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [{ path: '.groundwork/plans/doc.md', content: 'x'.repeat(PLAN_UNDER_BYTES) }],
      stdin_payload: normPayload(payload, tmpDir),
      stdout: norm(result.stdout, tmpDir),
      stderr: norm(result.stderr, tmpDir),
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

SCENARIOS.push(async function plan_at_budget_boundary() {
  const tmpDir = makeTempDir('s04')
  try {
    mkdirSync(join(tmpDir, '.groundwork', 'plans'), { recursive: true })
    const fp = join(tmpDir, '.groundwork', 'plans', 'doc.md')
    writeFileSync(fp, 'x'.repeat(PLAN_AT_BUDGET_BYTES))
    const payload = { tool_name: 'Write', tool_input: { file_path: fp } }
    const result = runHook(tmpDir, payload)
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'plan_at_budget_boundary',
      description: 'plan file 10500 bytes = exactly 3000 tokens = budget — guard uses tokens > budget (not >=), passthrough. A >= mutant fires here.',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [{ path: '.groundwork/plans/doc.md', content: 'x'.repeat(PLAN_AT_BUDGET_BYTES) }],
      stdin_payload: normPayload(payload, tmpDir),
      stdout: norm(result.stdout, tmpDir),
      stderr: norm(result.stderr, tmpDir),
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

SCENARIOS.push(async function over_budget_both_elements() {
  const tmpDir = makeTempDir('s05')
  try {
    mkdirSync(join(tmpDir, '.groundwork', 'plans'), { recursive: true })
    const fp = join(tmpDir, '.groundwork', 'plans', 'doc.md')
    const content = makeContent(PLAN_BIG_BYTES, true, true)
    writeFileSync(fp, content)
    const payload = { tool_name: 'Write', tool_input: { file_path: fp } }
    const result = runHook(tmpDir, payload)
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'over_budget_both_elements',
      description: 'plan file over budget but structurally sound (has summary-header and section-anchor) — guard is silent.',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [{ path: '.groundwork/plans/doc.md', content }],
      stdin_payload: normPayload(payload, tmpDir),
      stdout: norm(result.stdout, tmpDir),
      stderr: norm(result.stderr, tmpDir),
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

SCENARIOS.push(async function missing_file_path_key() {
  const tmpDir = makeTempDir('s06')
  try {
    const payload = { tool_name: 'Write', tool_input: {} }
    const result = runHook(tmpDir, payload)
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'missing_file_path_key',
      description: 'tool_input has no file_path — typeof fp !== "string" check fires, passthrough.',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [],
      stdin_payload: payload,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

SCENARIOS.push(async function file_not_exist() {
  const tmpDir = makeTempDir('s07')
  try {
    mkdirSync(join(tmpDir, '.groundwork', 'plans'), { recursive: true })
    const fp = join(tmpDir, '.groundwork', 'plans', 'nonexistent.md')
    const payload = { tool_name: 'Write', tool_input: { file_path: fp } }
    const result = runHook(tmpDir, payload)
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'file_not_exist',
      description: 'file_path matches plan class pattern but file does not exist — readFileSync throws, fail-open exit 0.',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [],
      stdin_payload: normPayload(payload, tmpDir),
      stdout: norm(result.stdout, tmpDir),
      stderr: norm(result.stderr, tmpDir),
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

SCENARIOS.push(async function malformed_stdin() {
  const tmpDir = makeTempDir('s08')
  try {
    const result = runHookRaw(tmpDir, 'not-json{{{')
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'malformed_stdin',
      description: 'Stdin is not valid JSON — JSON.parse throws, catch calls passthrough(), exit 0.',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [],
      stdin_payload: null,
      stdin_raw: 'not-json{{{',
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

SCENARIOS.push(async function empty_stdin() {
  const tmpDir = makeTempDir('s09')
  try {
    const result = runHookRaw(tmpDir, '')
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'empty_stdin',
      description: 'Empty stdin — raw.trim() is falsy so JSON.parse is skipped, input stays {}, no file_path → passthrough.',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [],
      stdin_payload: null,
      stdin_raw: '',
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

SCENARIOS.push(async function embedded_agent() {
  const tmpDir = makeTempDir('s10')
  try {
    mkdirSync(join(tmpDir, '.groundwork', 'plans'), { recursive: true })
    const fp = join(tmpDir, '.groundwork', 'plans', 'doc.md')
    const content = makeContent(PLAN_BIG_BYTES, false, false)
    writeFileSync(fp, content)
    const payload = { tool_name: 'Write', tool_input: { file_path: fp } }
    const result = runHook(tmpDir, payload, { CLAUDE_CODE_ENTRYPOINT: 'sdk-py' })
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'embedded_agent',
      description: 'CLAUDE_CODE_ENTRYPOINT=sdk-py → isEmbeddedAgent() true, passthrough before any check (even with a violation-worthy file).',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER, CLAUDE_CODE_ENTRYPOINT: 'sdk-py' },
      disk_state_setup: [{ path: '.groundwork/plans/doc.md', content }],
      stdin_payload: normPayload(payload, tmpDir),
      stdout: norm(result.stdout, tmpDir),
      stderr: norm(result.stderr, tmpDir),
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------

SCENARIOS.push(async function plan_violation_missing_both() {
  const tmpDir = makeTempDir('s11')
  try {
    mkdirSync(join(tmpDir, '.groundwork', 'plans'), { recursive: true })
    const fp = join(tmpDir, '.groundwork', 'plans', 'doc.md')
    const content = makeContent(PLAN_BIG_BYTES, false, false)
    writeFileSync(fp, content)
    const payload = { tool_name: 'Write', tool_input: { file_path: fp } }
    const result = runHook(tmpDir, payload)
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'plan_violation_missing_both',
      description: 'plan file 11000 bytes, ~3143 tokens (over 3000 budget). Raw filler (no headings) satisfies summary-header check; no ## heading → missing: section-anchor only.',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [{ path: '.groundwork/plans/doc.md', content }],
      stdin_payload: normPayload(payload, tmpDir),
      stdout: norm(result.stdout, tmpDir),
      stderr: norm(result.stderr, tmpDir),
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

SCENARIOS.push(async function plan_violation_missing_summary() {
  const tmpDir = makeTempDir('s12')
  try {
    mkdirSync(join(tmpDir, '.groundwork', 'plans'), { recursive: true })
    const fp = join(tmpDir, '.groundwork', 'plans', 'doc.md')
    const content = makeContent(PLAN_BIG_BYTES, false, true)
    writeFileSync(fp, content)
    const payload = { tool_name: 'Write', tool_input: { file_path: fp } }
    const result = runHook(tmpDir, payload)
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'plan_violation_missing_summary',
      description: 'plan file over budget, has section-anchor (## heading starts file) but no summary-header (no content before ##) — violation lists summary-header only.',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [{ path: '.groundwork/plans/doc.md', content }],
      stdin_payload: normPayload(payload, tmpDir),
      stdout: norm(result.stdout, tmpDir),
      stderr: norm(result.stderr, tmpDir),
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

SCENARIOS.push(async function plan_violation_missing_anchor() {
  const tmpDir = makeTempDir('s13')
  try {
    mkdirSync(join(tmpDir, '.groundwork', 'plans'), { recursive: true })
    const fp = join(tmpDir, '.groundwork', 'plans', 'doc.md')
    const content = makeContent(PLAN_BIG_BYTES, true, false)
    writeFileSync(fp, content)
    const payload = { tool_name: 'Write', tool_input: { file_path: fp } }
    const result = runHook(tmpDir, payload)
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'plan_violation_missing_anchor',
      description: 'plan file over budget, has summary-header (# title + intro paragraph) but no ## heading — violation lists section-anchor only.',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [{ path: '.groundwork/plans/doc.md', content }],
      stdin_payload: normPayload(payload, tmpDir),
      stdout: norm(result.stdout, tmpDir),
      stderr: norm(result.stderr, tmpDir),
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

SCENARIOS.push(async function plan_violation_just_over_boundary() {
  const tmpDir = makeTempDir('s14')
  try {
    mkdirSync(join(tmpDir, '.groundwork', 'plans'), { recursive: true })
    const fp = join(tmpDir, '.groundwork', 'plans', 'doc.md')
    writeFileSync(fp, 'x'.repeat(PLAN_JUST_OVER_BYTES))
    const payload = { tool_name: 'Write', tool_input: { file_path: fp } }
    const result = runHook(tmpDir, payload)
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'plan_violation_just_over_boundary',
      description: 'plan file 10501 bytes → ceil(10501/3.5)=3001 tokens, 1 token over the 3000 budget — minimal over-budget violation. Pair with plan_at_budget_boundary (10500 bytes → PASS).',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [{ path: '.groundwork/plans/doc.md', content: 'x'.repeat(PLAN_JUST_OVER_BYTES) }],
      stdin_payload: normPayload(payload, tmpDir),
      stdout: norm(result.stdout, tmpDir),
      stderr: norm(result.stderr, tmpDir),
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

SCENARIOS.push(async function edit_tool_violation() {
  const tmpDir = makeTempDir('s15')
  try {
    mkdirSync(join(tmpDir, '.groundwork', 'plans'), { recursive: true })
    const fp = join(tmpDir, '.groundwork', 'plans', 'doc.md')
    const content = makeContent(PLAN_BIG_BYTES, false, false)
    writeFileSync(fp, content)
    const payload = { tool_name: 'Edit', tool_input: { file_path: fp } }
    const result = runHook(tmpDir, payload)
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'edit_tool_violation',
      description: 'Edit tool (in guarded set): plan file over budget, missing both structural elements — violation.',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [{ path: '.groundwork/plans/doc.md', content }],
      stdin_payload: normPayload(payload, tmpDir),
      stdout: norm(result.stdout, tmpDir),
      stderr: norm(result.stderr, tmpDir),
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

SCENARIOS.push(async function multiedit_tool_violation() {
  const tmpDir = makeTempDir('s16')
  try {
    mkdirSync(join(tmpDir, '.groundwork', 'plans'), { recursive: true })
    const fp = join(tmpDir, '.groundwork', 'plans', 'doc.md')
    const content = makeContent(PLAN_BIG_BYTES, false, false)
    writeFileSync(fp, content)
    const payload = { tool_name: 'MultiEdit', tool_input: { file_path: fp } }
    const result = runHook(tmpDir, payload)
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'multiedit_tool_violation',
      description: 'MultiEdit tool (in guarded set): plan file over budget, missing both structural elements — violation.',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [{ path: '.groundwork/plans/doc.md', content }],
      stdin_payload: normPayload(payload, tmpDir),
      stdout: norm(result.stdout, tmpDir),
      stderr: norm(result.stderr, tmpDir),
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

SCENARIOS.push(async function narrative_violation() {
  const tmpDir = makeTempDir('s17')
  try {
    mkdirSync(join(tmpDir, 'doc'), { recursive: true })
    const fp = join(tmpDir, 'doc', 'test-narrative.md')
    writeFileSync(fp, 'x'.repeat(NAR_JUST_OVER_BYTES))
    const payload = { tool_name: 'Write', tool_input: { file_path: fp } }
    const result = runHook(tmpDir, payload)
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'narrative_violation',
      description: 'narrative class (doc/*.md, budget 2000 tokens): 7001 bytes → 2001 tokens, missing both elements — violation names narrative class and 2000-token budget.',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [{ path: 'doc/test-narrative.md', content: 'x'.repeat(NAR_JUST_OVER_BYTES) }],
      stdin_payload: normPayload(payload, tmpDir),
      stdout: norm(result.stdout, tmpDir),
      stderr: norm(result.stderr, tmpDir),
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

SCENARIOS.push(async function rfc_index_violation() {
  const tmpDir = makeTempDir('s18')
  try {
    mkdirSync(join(tmpDir, '.groundwork', 'rfcs', '9999-parity-test'), { recursive: true })
    const fp = join(tmpDir, '.groundwork', 'rfcs', '9999-parity-test', 'rfc.md')
    writeFileSync(fp, 'x'.repeat(RFC_JUST_OVER_BYTES))
    const payload = { tool_name: 'Write', tool_input: { file_path: fp } }
    const result = runHook(tmpDir, payload)
    return {
      hook: 'doc-size-guard.mjs',
      hook_path: 'hooks/doc-size-guard.mjs',
      event_type: 'PostToolUse',
      scenario_name: 'rfc_index_violation',
      description: 'rfc-index class (.groundwork/rfcs/*/rfc.md, budget 12000 tokens): 42001 bytes → 12001 tokens, missing both elements — violation names rfc-index class and 12000-token budget.',
      env: { CLAUDE_PROJECT_DIR: PLACEHOLDER },
      disk_state_setup: [
        `node -e "var fs=require('fs'),p=require('path');fs.mkdirSync(p.join('<isolated_temp_dir>','.groundwork','rfcs','9999-parity-test'),{recursive:true});fs.writeFileSync(p.join('<isolated_temp_dir>','.groundwork','rfcs','9999-parity-test','rfc.md'),'x'.repeat(42001))"`,
      ],
      stdin_payload: normPayload(payload, tmpDir),
      stdout: norm(result.stdout, tmpDir),
      stderr: norm(result.stderr, tmpDir),
      exit_code: result.exit_code,
      decision: classifyDecision(result.stdout),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------

const VERIFY = process.argv.includes('--verify')

async function main() {
  console.log(`doc-size-guard parity corpus — ${VERIFY ? 'verify' : 'capture'} (${SCENARIOS.length} scenarios)`)
  let failures = 0

  for (const scenarioFn of SCENARIOS) {
    const name = scenarioFn.name
    process.stdout.write(`  ${name}... `)
    try {
      const fixture = await scenarioFn()
      if (VERIFY) {
        const storedPath = join(OUT_DIR, `${name}.json`)
        let stored
        try { stored = JSON.parse(readFileSync(storedPath, 'utf8')) }
        catch { console.log(`MISSING`); failures++; continue }

        const diffs = []
        if (fixture.stdout !== stored.stdout)
          diffs.push(`stdout:\n    stored: ${JSON.stringify(stored.stdout)}\n    actual: ${JSON.stringify(fixture.stdout)}`)
        if (fixture.stderr !== stored.stderr)
          diffs.push(`stderr: stored=${JSON.stringify(stored.stderr)} actual=${JSON.stringify(fixture.stderr)}`)
        if (fixture.exit_code !== stored.exit_code)
          diffs.push(`exit_code: stored=${stored.exit_code} actual=${fixture.exit_code}`)
        if (fixture.decision !== stored.decision)
          diffs.push(`decision: stored=${stored.decision} actual=${fixture.decision}`)

        if (diffs.length === 0) { console.log(`OK (${fixture.decision})`) }
        else { console.log(`FAIL`); diffs.forEach(d => console.error(`    ${d}`)); failures++ }
      } else {
        writeFixture(name, fixture)
        console.log(`exit=${fixture.exit_code} decision=${fixture.decision}`)
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`)
      failures++
    }
  }

  if (VERIFY) {
    if (failures === 0) console.log(`\nAll ${SCENARIOS.length} scenarios verified identical.`)
    else { console.error(`\n${failures}/${SCENARIOS.length} scenario(s) FAILED verification.`); process.exit(1) }
  } else {
    if (failures > 0) { console.error(`\n${failures} capture(s) failed.`); process.exit(1) }
    console.log(`\nDone. ${SCENARIOS.length} fixtures written to ${OUT_DIR}`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
