#!/usr/bin/env node
/**
 * Parity-corpus capture script for hooks/doc-read-guard.mjs (PreToolUse hook).
 *
 * Runs each scenario against the real hook executable via `node hooks/doc-read-guard.mjs`
 * (BARE PATH — never via gw-hook shim), records stdout/stderr/exit_code verbatim, and
 * writes one JSON fixture file per scenario to this directory.
 *
 * Usage:
 *   node test/fixtures/parity-corpus/doc-read-guard/capture.mjs           — regenerate
 *   node test/fixtures/parity-corpus/doc-read-guard/capture.mjs --verify  — check identical
 *
 * Path placeholders: absolute temp-dir paths are replaced with <isolated_temp_dir>
 * in both stdin_payload and stdout before writing, so fixtures are deterministic
 * across runs.  The parity test runner MUST also interpolate <isolated_temp_dir>
 * in stdin_payload.tool_input.file_path (and equivalent Bash command fields) when
 * replaying doc-read-guard scenarios — this is not currently done by runner.ts
 * (doc-read-guard was captured before its TS port; update runner when porting).
 *
 * NEVER touches .groundwork/ in the repo root — each scenario uses an isolated temp dir.
 *
 * Shim guard: refuses to run if the hook has been converted to a gw shim.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'doc-read-guard.mjs')

// ── Shim guard ────────────────────────────────────────────────────────────────
{
  const hookContent = readFileSync(HOOK_PATH, 'utf8')
  if (hookContent.includes('src/gw/cli/main.ts')) {
    console.error(
      'REFUSED: hooks/doc-read-guard.mjs is a gw shim — re-running capture would overwrite ' +
        'fixtures with shim output, making parity tautological. The corpus is frozen (D-116).',
    )
    process.exit(1)
  }
}

const VERIFY = process.argv.includes('--verify')

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Spawn `node hooks/doc-read-guard.mjs` with stdinPayload piped to stdin.
 * Scrubs CLAUDE_PROJECT_DIR and CLAUDE_PLUGIN_ROOT from the subprocess env.
 * Sets CWD to projectDir so classifyDoc resolves paths correctly.
 */
function runHook(projectDir, stdinPayload, extraEnv = {}) {
  // eslint-disable-next-line no-unused-vars
  const { CLAUDE_PROJECT_DIR: _a, CLAUDE_PLUGIN_ROOT: _b, ...cleanEnv } = process.env
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf8',
    cwd: projectDir,
    env: {
      ...cleanEnv,
      CLAUDE_CODE_SESSION_ID: 'parity-corpus-capture',
      CLAUDE_PROJECT_DIR: projectDir,
      ...extraEnv,
    },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit_code: result.status ?? 0,
  }
}

/**
 * Run the hook with raw stdin (string, not auto-serialised) for fail-open tests.
 */
function runHookRaw(projectDir, rawStdin, extraEnv = {}) {
  // eslint-disable-next-line no-unused-vars
  const { CLAUDE_PROJECT_DIR: _a, CLAUDE_PLUGIN_ROOT: _b, ...cleanEnv } = process.env
  const result = spawnSync('node', [HOOK_PATH], {
    input: rawStdin,
    encoding: 'utf8',
    cwd: projectDir,
    env: {
      ...cleanEnv,
      CLAUDE_CODE_SESSION_ID: 'parity-corpus-capture',
      CLAUDE_PROJECT_DIR: projectDir,
      ...extraEnv,
    },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit_code: result.status ?? 0,
  }
}

/** Replace all occurrences of realDir with the placeholder in a string. */
function substituteDir(str, realDir) {
  return str.split(realDir).join('<isolated_temp_dir>')
}

/** Deep-substitute realDir in a payload object by round-tripping through JSON. */
function substitutePayload(payload, realDir) {
  return JSON.parse(substituteDir(JSON.stringify(payload), realDir))
}

/** Classify the corpus decision from the hook's stdout (mirrors runner.ts). */
function classifyDecision(stdout) {
  const trimmed = stdout.trim()
  if (!trimmed) return 'PASS'
  try {
    const parsed = JSON.parse(trimmed)
    const hs = parsed?.hookSpecificOutput
    if (hs?.permissionDecision === 'deny') return 'DENY'
  } catch {
    /* non-JSON passthrough */
  }
  return 'PASS'
}

/** Write a fixture JSON file to this directory. */
function writeFixture(scenarioName, fixture) {
  const outPath = join(__dirname, `${scenarioName}.json`)
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n')
  console.log(`  wrote ${outPath}`)
}

/** Create an isolated temp dir for a scenario. */
function makeTempDir(label) {
  return mkdtempSync(join(tmpdir(), `groundwork-drg-${label}-`))
}

// ── Content helpers ───────────────────────────────────────────────────────────

/** Over plan budget: 11000 bytes ≈ 3143 tokens (budget = 3000). */
const bigPlanContent = () => 'x'.repeat(11000)
/** Within plan budget: short Markdown. */
const smallContent = () => '# Doc\n\n## Section\n\nShort.\n'
/** At plan budget boundary: exactly 10500 bytes = 3000 tokens (> not >=, so PASS). */
const atBudgetContent = () => 'x'.repeat(10500)
/** Over RFC-index budget: 42100 bytes ≈ 12029 tokens (budget = 12000). */
const bigRfcContent = () => 'x'.repeat(42100)

// ── Scenarios ─────────────────────────────────────────────────────────────────

const SCENARIOS = []

// ─── 1: read_over_budget_deny — AC 2 ─────────────────────────────────────────
SCENARIOS.push(function read_over_budget_deny() {
  const tmpDir = makeTempDir('01')
  const planDir = join(tmpDir, '.groundwork', 'plans')
  mkdirSync(planDir, { recursive: true })
  const filePath = join(planDir, 'big-plan.md')
  writeFileSync(filePath, bigPlanContent())
  try {
    const stdin = {
      tool_name: 'Read',
      tool_input: { file_path: filePath },
      session_id: 'parity-corpus-drg-001',
    }
    const result = runHook(tmpDir, stdin)
    const stdinClean = substitutePayload(stdin, tmpDir)
    const stdoutClean = substituteDir(result.stdout, tmpDir)
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'read_over_budget_deny',
      description:
        "Read of a plan-class file (~3143 tokens) exceeding the 3000-token budget with no TOC issued. Hook denies with 'doc toc <path>' guidance (AC 2).",
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: '.groundwork/plans/big-plan.md',
          content_summary: 'plan-class file, 11000 bytes (~3143 tokens), over 3000-token budget',
          content: bigPlanContent(),
        },
      ],
      stdin_payload: stdinClean,
      stdout: stdoutClean,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 2: read_within_budget_pass ───────────────────────────────────────────────
SCENARIOS.push(function read_within_budget_pass() {
  const tmpDir = makeTempDir('02')
  const planDir = join(tmpDir, '.groundwork', 'plans')
  mkdirSync(planDir, { recursive: true })
  const filePath = join(planDir, 'small-plan.md')
  writeFileSync(filePath, smallContent())
  try {
    const stdin = {
      tool_name: 'Read',
      tool_input: { file_path: filePath },
      session_id: 'parity-corpus-drg-002',
    }
    const result = runHook(tmpDir, stdin)
    const stdinClean = substitutePayload(stdin, tmpDir)
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'read_within_budget_pass',
      description:
        'Read of a plan-class file within the 3000-token budget. Hook passes through silently.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: '.groundwork/plans/small-plan.md',
          content_summary: 'plan-class file, short Markdown, well within 3000-token budget',
          content: smallContent(),
        },
      ],
      stdin_payload: stdinClean,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 3: read_at_budget_pass — boundary: > not >= ─────────────────────────────
SCENARIOS.push(function read_at_budget_pass() {
  const tmpDir = makeTempDir('03')
  const planDir = join(tmpDir, '.groundwork', 'plans')
  mkdirSync(planDir, { recursive: true })
  const filePath = join(planDir, 'at-budget.md')
  writeFileSync(filePath, atBudgetContent())
  try {
    const stdin = {
      tool_name: 'Read',
      tool_input: { file_path: filePath },
      session_id: 'parity-corpus-drg-003',
    }
    const result = runHook(tmpDir, stdin)
    const stdinClean = substitutePayload(stdin, tmpDir)
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'read_at_budget_pass',
      description:
        'Read of a plan-class file at exactly the 3000-token budget boundary (10500 bytes). Guard uses > not >= so exactly-at-budget is permitted.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: '.groundwork/plans/at-budget.md',
          content_summary:
            'plan-class file, 10500 bytes = exactly 3000 tokens (ceil(10500/3.5)=3000)',
          content: atBudgetContent(),
        },
      ],
      stdin_payload: stdinClean,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 4: read_unclassified_large_pass ─────────────────────────────────────────
SCENARIOS.push(function read_unclassified_large_pass() {
  const tmpDir = makeTempDir('04')
  const filePath = join(tmpDir, 'unclassified-big.md')
  writeFileSync(filePath, bigPlanContent())
  try {
    const stdin = {
      tool_name: 'Read',
      tool_input: { file_path: filePath },
      session_id: 'parity-corpus-drg-004',
    }
    const result = runHook(tmpDir, stdin)
    const stdinClean = substitutePayload(stdin, tmpDir)
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'read_unclassified_large_pass',
      description:
        'Read of a large (~3143 tokens) unclassified file (not under any doc-class path). classifyDoc returns null — hook passes through immediately without reading the file.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: 'unclassified-big.md',
          content_summary: 'unclassified file at repo root, 11000 bytes',
          content: bigPlanContent(),
        },
      ],
      stdin_payload: stdinClean,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 5: bash_cat_over_budget_deny — AC 3 ─────────────────────────────────────
SCENARIOS.push(function bash_cat_over_budget_deny() {
  const tmpDir = makeTempDir('05')
  const planDir = join(tmpDir, '.groundwork', 'plans')
  mkdirSync(planDir, { recursive: true })
  const filePath = join(planDir, 'big-plan-cat.md')
  writeFileSync(filePath, bigPlanContent())
  try {
    const stdin = {
      tool_name: 'Bash',
      tool_input: { command: `cat ${filePath}` },
      session_id: 'parity-corpus-drg-005',
    }
    const result = runHook(tmpDir, stdin)
    const stdinClean = substitutePayload(stdin, tmpDir)
    const stdoutClean = substituteDir(result.stdout, tmpDir)
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'bash_cat_over_budget_deny',
      description:
        "Bash cat of a plan-class file (~3143 tokens) over the 3000-token budget. Hook denies with 'doc show <path>' guidance (AC 3).",
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: '.groundwork/plans/big-plan-cat.md',
          content_summary: 'plan-class file, 11000 bytes (~3143 tokens), over 3000-token budget',
          content: bigPlanContent(),
        },
      ],
      stdin_payload: stdinClean,
      stdout: stdoutClean,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 6: bash_head_over_budget_deny — AC 3 ────────────────────────────────────
SCENARIOS.push(function bash_head_over_budget_deny() {
  const tmpDir = makeTempDir('06')
  const planDir = join(tmpDir, '.groundwork', 'plans')
  mkdirSync(planDir, { recursive: true })
  const filePath = join(planDir, 'big-plan-head.md')
  writeFileSync(filePath, bigPlanContent())
  try {
    const stdin = {
      tool_name: 'Bash',
      tool_input: { command: `head -n 50 ${filePath}` },
      session_id: 'parity-corpus-drg-006',
    }
    const result = runHook(tmpDir, stdin)
    const stdinClean = substitutePayload(stdin, tmpDir)
    const stdoutClean = substituteDir(result.stdout, tmpDir)
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'bash_head_over_budget_deny',
      description:
        "Bash head -n 50 of a plan-class file (~3143 tokens) over the 3000-token budget. Hook denies with 'doc show <path>' guidance (AC 3).",
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: '.groundwork/plans/big-plan-head.md',
          content_summary: 'plan-class file, 11000 bytes (~3143 tokens), over 3000-token budget',
          content: bigPlanContent(),
        },
      ],
      stdin_payload: stdinClean,
      stdout: stdoutClean,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 7: bash_cat_within_budget_pass ──────────────────────────────────────────
SCENARIOS.push(function bash_cat_within_budget_pass() {
  const tmpDir = makeTempDir('07')
  const planDir = join(tmpDir, '.groundwork', 'plans')
  mkdirSync(planDir, { recursive: true })
  const filePath = join(planDir, 'small-plan-cat.md')
  writeFileSync(filePath, smallContent())
  try {
    const stdin = {
      tool_name: 'Bash',
      tool_input: { command: `cat ${filePath}` },
      session_id: 'parity-corpus-drg-007',
    }
    const result = runHook(tmpDir, stdin)
    const stdinClean = substitutePayload(stdin, tmpDir)
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'bash_cat_within_budget_pass',
      description:
        'Bash cat of a plan-class file within the 3000-token budget. Hook passes through silently.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: '.groundwork/plans/small-plan-cat.md',
          content_summary: 'plan-class file, short Markdown, within 3000-token budget',
          content: smallContent(),
        },
      ],
      stdin_payload: stdinClean,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 8: bash_cat_unclassified_large_pass ─────────────────────────────────────
SCENARIOS.push(function bash_cat_unclassified_large_pass() {
  const tmpDir = makeTempDir('08')
  const filePath = join(tmpDir, 'unclassified-big.md')
  writeFileSync(filePath, bigPlanContent())
  try {
    const stdin = {
      tool_name: 'Bash',
      tool_input: { command: `cat ${filePath}` },
      session_id: 'parity-corpus-drg-008',
    }
    const result = runHook(tmpDir, stdin)
    const stdinClean = substitutePayload(stdin, tmpDir)
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'bash_cat_unclassified_large_pass',
      description:
        'Bash cat of a large unclassified file (not under any doc-class path). classifyDoc returns null for the path — hook continues without denying.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: 'unclassified-big.md',
          content_summary: 'unclassified file at repo root, 11000 bytes',
          content: bigPlanContent(),
        },
      ],
      stdin_payload: stdinClean,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 9: bash_doc_toc_pass — records TOC, permits ─────────────────────────────
SCENARIOS.push(function bash_doc_toc_pass() {
  const tmpDir = makeTempDir('09')
  const planDir = join(tmpDir, '.groundwork', 'plans')
  mkdirSync(planDir, { recursive: true })
  const filePath = join(planDir, 'big-plan-toc.md')
  writeFileSync(filePath, bigPlanContent())
  try {
    const stdin = {
      tool_name: 'Bash',
      tool_input: { command: `doc toc ${filePath}` },
      session_id: 'parity-corpus-drg-009',
    }
    const result = runHook(tmpDir, stdin)
    const stdinClean = substitutePayload(stdin, tmpDir)
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'bash_doc_toc_pass',
      description:
        "Bash 'doc toc <path>' command for an over-budget plan-class file. The hook records the TOC path to the session state and passes through without denying the toc invocation itself.",
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: '.groundwork/plans/big-plan-toc.md',
          content_summary: 'plan-class file, 11000 bytes, over budget — but command is doc toc (not cat/head)',
          content: bigPlanContent(),
        },
      ],
      stdin_payload: stdinClean,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 10: edit_tool_pass — AC 4 ───────────────────────────────────────────────
SCENARIOS.push(function edit_tool_pass() {
  const tmpDir = makeTempDir('10')
  const planDir = join(tmpDir, '.groundwork', 'plans')
  mkdirSync(planDir, { recursive: true })
  const filePath = join(planDir, 'big-plan-edit.md')
  writeFileSync(filePath, bigPlanContent())
  try {
    const stdin = {
      tool_name: 'Edit',
      tool_input: { file_path: filePath, old_string: 'x', new_string: 'y' },
      session_id: 'parity-corpus-drg-010',
    }
    const result = runHook(tmpDir, stdin)
    const stdinClean = substitutePayload(stdin, tmpDir)
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'edit_tool_pass',
      description:
        'Edit tool on an over-budget plan-class file. Hook never denies writes — Edit passes through unconditionally (AC 4 defensive guard).',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: '.groundwork/plans/big-plan-edit.md',
          content_summary: 'plan-class file, 11000 bytes — but Edit tool is never denied (AC 4)',
          content: bigPlanContent(),
        },
      ],
      stdin_payload: stdinClean,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 11: grep_tool_pass — AC 7 ───────────────────────────────────────────────
SCENARIOS.push(function grep_tool_pass() {
  const tmpDir = makeTempDir('11')
  const planDir = join(tmpDir, '.groundwork', 'plans')
  mkdirSync(planDir, { recursive: true })
  const filePath = join(planDir, 'big-plan-grep.md')
  writeFileSync(filePath, bigPlanContent())
  try {
    const stdin = {
      tool_name: 'Grep',
      tool_input: { pattern: 'foo', path: filePath },
      session_id: 'parity-corpus-drg-011',
    }
    const result = runHook(tmpDir, stdin)
    const stdinClean = substitutePayload(stdin, tmpDir)
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'grep_tool_pass',
      description:
        'Grep tool on an over-budget plan-class file. Hook is registered for Grep per AC 7 but takes no action — passes through silently.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: '.groundwork/plans/big-plan-grep.md',
          content_summary: 'plan-class file, 11000 bytes — Grep always passes through (AC 7)',
          content: bigPlanContent(),
        },
      ],
      stdin_payload: stdinClean,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 12: notes_read_pass — AC 5 (unclassified notes/ path) ───────────────────
SCENARIOS.push(function notes_read_pass() {
  const tmpDir = makeTempDir('12')
  const notesDir = join(tmpDir, 'notes')
  mkdirSync(notesDir, { recursive: true })
  const filePath = join(notesDir, 'scratch.md')
  writeFileSync(filePath, smallContent())
  try {
    const stdin = {
      tool_name: 'Read',
      tool_input: { file_path: filePath },
      session_id: 'parity-corpus-drg-012',
    }
    const result = runHook(tmpDir, stdin)
    const stdinClean = substitutePayload(stdin, tmpDir)
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'notes_read_pass',
      description:
        "Read of a notes/ scratch file within budget. The path is unclassified (classifyDoc → null) so the hook passes through immediately — AC 5 isNotesScratch guard is not even reached.",
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: 'notes/scratch.md',
          content_summary: 'notes/ scratch file, short Markdown, unclassified',
          content: smallContent(),
        },
      ],
      stdin_payload: stdinClean,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 13: notes_bash_cat_pass — AC 5 (unclassified notes/ via cat) ─────────────
SCENARIOS.push(function notes_bash_cat_pass() {
  const tmpDir = makeTempDir('13')
  const notesDir = join(tmpDir, 'notes')
  mkdirSync(notesDir, { recursive: true })
  const filePath = join(notesDir, 'scratch.md')
  writeFileSync(filePath, smallContent())
  try {
    const stdin = {
      tool_name: 'Bash',
      tool_input: { command: `cat ${filePath}` },
      session_id: 'parity-corpus-drg-013',
    }
    const result = runHook(tmpDir, stdin)
    const stdinClean = substitutePayload(stdin, tmpDir)
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'notes_bash_cat_pass',
      description:
        'Bash cat of a notes/ scratch file within budget. Path is unclassified — hook continues without denying (AC 5).',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: 'notes/scratch.md',
          content_summary: 'notes/ scratch file, short Markdown, unclassified',
          content: smallContent(),
        },
      ],
      stdin_payload: stdinClean,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 14: malformed_stdin_pass — AC 6 fail-open ───────────────────────────────
SCENARIOS.push(function malformed_stdin_pass() {
  const tmpDir = makeTempDir('14')
  try {
    const result = runHookRaw(tmpDir, 'not-json{{{{')
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'malformed_stdin_pass',
      description:
        'Malformed JSON on stdin. JSON.parse throws — AC 6 fail-open: hook emits nothing and exits 0.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [],
      stdin_payload: 'not-json{{{{',
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 15: empty_stdin_pass — AC 6 fail-open ───────────────────────────────────
SCENARIOS.push(function empty_stdin_pass() {
  const tmpDir = makeTempDir('15')
  try {
    const result = runHookRaw(tmpDir, '')
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'empty_stdin_pass',
      description:
        'Empty stdin. raw.trim() is empty — input stays {} — hook dispatches to neither handleRead nor handleBash and exits passthrough (AC 6 fail-open).',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [],
      stdin_payload: '',
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 16: nonexistent_file_pass — AC 6 fail-open ──────────────────────────────
SCENARIOS.push(function nonexistent_file_pass() {
  const tmpDir = makeTempDir('16')
  const planDir = join(tmpDir, '.groundwork', 'plans')
  mkdirSync(planDir, { recursive: true })
  const filePath = join(planDir, 'does-not-exist.md')
  try {
    const stdin = {
      tool_name: 'Read',
      tool_input: { file_path: filePath },
      session_id: 'parity-corpus-drg-016',
    }
    const result = runHook(tmpDir, stdin)
    const stdinClean = substitutePayload(stdin, tmpDir)
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'nonexistent_file_pass',
      description:
        "Read of a plan-class path that does not exist on disk. readFileSync throws ENOENT — AC 6 fail-open: hook emits nothing and exits 0.",
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [],
      stdin_payload: stdinClean,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 17: embedded_agent_pass — AC 6 embedded-agent early-exit ────────────────
SCENARIOS.push(function embedded_agent_pass() {
  const tmpDir = makeTempDir('17')
  const planDir = join(tmpDir, '.groundwork', 'plans')
  mkdirSync(planDir, { recursive: true })
  const filePath = join(planDir, 'big-plan-sdk.md')
  writeFileSync(filePath, bigPlanContent())
  try {
    const stdinObj = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: filePath },
      session_id: 'parity-corpus-drg-017',
    }
    const result = runHook(tmpDir, stdinObj, { CLAUDE_CODE_ENTRYPOINT: 'sdk-js' })
    const stdinClean = substitutePayload(stdinObj, tmpDir)
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'embedded_agent_pass',
      description:
        'SDK-embedded agent session (CLAUDE_CODE_ENTRYPOINT=sdk-js) reading an over-budget plan file. isEmbeddedAgent() is true — hook calls passthrough() immediately before any guard logic (AC 6).',
      env: {
        CLAUDE_PROJECT_DIR: '<isolated_temp_dir>',
        CLAUDE_CODE_ENTRYPOINT: 'sdk-js',
      },
      disk_state_setup: [
        {
          path: '.groundwork/plans/big-plan-sdk.md',
          content_summary:
            'plan-class file, 11000 bytes — would be denied if not embedded agent',
          content: bigPlanContent(),
        },
      ],
      stdin_payload: stdinClean,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 18: rfc_index_over_budget_deny — rfc-index class ────────────────────────
SCENARIOS.push(function rfc_index_over_budget_deny() {
  const tmpDir = makeTempDir('18')
  const rfcDir = join(tmpDir, '.groundwork', 'rfcs', '9999-parity-test')
  mkdirSync(rfcDir, { recursive: true })
  const filePath = join(rfcDir, 'rfc.md')
  writeFileSync(filePath, bigRfcContent())
  try {
    const stdin = {
      tool_name: 'Read',
      tool_input: { file_path: filePath },
      session_id: 'parity-corpus-drg-018',
    }
    const result = runHook(tmpDir, stdin)
    const stdinClean = substitutePayload(stdin, tmpDir)
    const stdoutClean = substituteDir(result.stdout, tmpDir)
    return {
      hook: 'doc-read-guard.mjs',
      hook_path: 'hooks/doc-read-guard.mjs',
      event_type: 'PreToolUse',
      scenario_name: 'rfc_index_over_budget_deny',
      description:
        "Read of an rfc.md (rfc-index class, budget 12000 tokens) exceeding the budget at ~12029 tokens (42100 bytes). Hook denies with 'doc toc <path>' guidance.",
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: '.groundwork/rfcs/9999-parity-test/rfc.md',
          content_summary:
            'rfc-index-class file, 42100 bytes (~12029 tokens), over 12000-token budget',
          content: bigRfcContent(),
        },
      ],
      stdin_payload: stdinClean,
      stdout: stdoutClean,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ── Main ──────────────────────────────────────────────────────────────────────

async function captureMode() {
  console.log('Running doc-read-guard capture scenarios...')
  for (const scenario of SCENARIOS) {
    const name = scenario.name
    try {
      process.stdout.write(`  ${name}... `)
      const fixture = await scenario()
      const decision = classifyDecision(fixture.stdout)
      fixture.decision = decision
      writeFixture(name, fixture)
      console.log(`exit=${fixture.exit_code} (${decision})`)
    } catch (err) {
      console.error(`FAILED: ${err.message}`)
      console.error(err.stack)
    }
  }
  console.log('Done.')
}

async function verifyMode() {
  console.log('Verifying doc-read-guard parity corpus (--verify)...')
  let failures = 0
  for (const scenario of SCENARIOS) {
    const name = scenario.name
    process.stdout.write(`  ${name}... `)
    const fixturePath = join(__dirname, `${name}.json`)
    if (!existsSync(fixturePath)) {
      console.log('MISSING (run without --verify first)')
      failures++
      continue
    }
    try {
      const liveFixture = await scenario()
      const decision = classifyDecision(liveFixture.stdout)
      liveFixture.decision = decision
      const liveJson = JSON.stringify(liveFixture, null, 2) + '\n'
      const stored = readFileSync(fixturePath, 'utf8')
      if (liveJson === stored) {
        console.log('identical')
      } else {
        console.log('MISMATCH')
        failures++
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`)
      failures++
    }
  }
  if (failures === 0) {
    console.log(`All ${SCENARIOS.length} fixtures identical.`)
  } else {
    console.error(`${failures} fixture(s) mismatched.`)
    process.exit(1)
  }
}

if (VERIFY) {
  verifyMode().catch((err) => {
    console.error(err)
    process.exit(1)
  })
} else {
  captureMode().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
