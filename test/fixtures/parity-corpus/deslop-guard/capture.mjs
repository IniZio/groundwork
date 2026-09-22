#!/usr/bin/env node
/**
 * Parity-corpus capture script for hooks/deslop-guard.mjs (PreToolUse hook).
 *
 * Usage:
 *   node test/fixtures/parity-corpus/deslop-guard/capture.mjs           # generate
 *   node test/fixtures/parity-corpus/deslop-guard/capture.mjs --verify  # re-run and compare
 *
 * Spawns `node hooks/deslop-guard.mjs` by bare path (not via a gw shim).
 * Scrubs CLAUDE_PROJECT_DIR / CLAUDE_PLUGIN_ROOT; fixed CLAUDE_CODE_SESSION_ID.
 * Hook is stateless — disk_state_setup is always [].
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'deslop-guard.mjs')
const OUT_DIR = __dirname
const HOOK_NAME = 'deslop-guard.mjs'
const HOOK_REL = 'hooks/deslop-guard.mjs'
const FIXED_SESSION_ID = 'test-deslop-guard-corpus'

{
  let hookContent
  try {
    hookContent = readFileSync(HOOK_PATH, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('REFUSED: hooks/deslop-guard.mjs has been deleted (converted to gw-hook); corpus is frozen (D-10).')
      process.exit(1)
    }
    throw err
  }
  if (hookContent.includes('src/gw/cli/main.ts')) {
    console.error('REFUSED: hooks/deslop-guard.mjs is a gw shim — re-running capture would overwrite fixtures with shim output, making parity tautological. The corpus is frozen (D-10).')
    process.exit(1)
  }
}

function runHook(rawStdin, extraEnv = {}) {
  const base = { ...process.env }
  delete base.CLAUDE_PROJECT_DIR
  delete base.CLAUDE_PLUGIN_ROOT
  const r = spawnSync('node', [HOOK_PATH], {
    input: rawStdin,
    encoding: 'utf8',
    env: { ...base, CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID, ...extraEnv },
    timeout: 10000,
  })
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exit_code: r.status ?? 0 }
}

function classifyDecision(stdout) {
  if (!stdout || !stdout.trim()) return 'PASS'
  try {
    const d = JSON.parse(stdout.trim())?.hookSpecificOutput?.permissionDecision
    if (d === 'allow') return 'WARN'
  } catch { /* passthrough */ }
  return 'PASS'
}

function writeFixture(name, fixture) {
  writeFileSync(join(OUT_DIR, `${name}.json`), JSON.stringify(fixture, null, 2) + '\n')
}

const BASE_ENV = {
  CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID,
  CLAUDE_PROJECT_DIR: '<scrubbed>',
  CLAUDE_PLUGIN_ROOT: '<scrubbed>',
}

function w(content) {
  return {
    hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: '/p/src/x.ts', content },
  }
}

const SCENARIOS = [
  {
    name: 'clean_write',
    description: 'Write with clean comment-free code. No slop — passthrough (PASS, exit 0, empty stdout).',
    stdin: w('export function add(a: number, b: number): number {\n  return a + b;\n}\n'),
    env: {},
  },
  {
    name: 'non_guarded_bash',
    description: 'Bash is not in GUARDED set (Edit/Write/MultiEdit). Passthrough immediately (PASS).',
    stdin: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo hi' } },
    env: {},
  },
  {
    name: 'non_guarded_read',
    description: 'Read is not in GUARDED set. Passthrough immediately (PASS).',
    stdin: { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/p/src/x.ts' } },
    env: {},
  },
  {
    name: 'malformed_stdin',
    description: 'stdin is not valid JSON. Hook fails open: passthrough (PASS, empty stdout, exit 0).',
    rawStdin: '{ not json at all',
    env: {},
  },
  {
    name: 'empty_stdin',
    description: 'stdin is an empty string. Hook reads empty, fails open: passthrough (PASS).',
    rawStdin: '',
    env: {},
  },
  {
    name: 'deslop_disable_marker',
    description: '// deslop:disable anywhere in content suppresses all detection (PASS).',
    stdin: w('// deslop:disable\n// Let\'s now process the data\n// Step 1: parse\n// 🚀 ship it\nexport function process() { return 1; }\n'),
    env: {},
  },
  {
    name: 'env_kill_switch',
    description: 'GROUNDWORK_DESLOP_GUARD=0 disables detection. Content has slop but no warning (PASS).',
    stdin: w('// Let\'s go\n// 🚀\nexport const x = 1;\n'),
    env: { GROUNDWORK_DESLOP_GUARD: '0' },
  },
  {
    name: 'license_header_allowed',
    description: '// Copyright MIT… in first 5 lines is allow-listed via LICENSE_LINE check (PASS).',
    stdin: w('// Copyright 2024 Newman. Licensed under the MIT License.\nexport const x = 1;\n'),
    env: {},
  },
  {
    name: 'annotation_ts_ignore',
    description: '// @ts-ignore matches ALLOW_LINE (/^\\s*\\/\\/\\s*@/). No warning emitted (PASS).',
    stdin: w('// @ts-ignore\n// @eslint-disable-next-line no-console\nconsole.log(1);\n'),
    env: {},
  },
  {
    name: 'jsdoc_param_annotation',
    description: '/** @param … */ annotation lines match ALLOW_BLOCK_BODY; not scanned for slop (PASS).',
    stdin: w('/**\n * @param a first operand\n * @param b second operand\n */\nexport function add(a: number, b: number) { return a + b; }\n'),
    env: {},
  },
  {
    name: 'ai_fingerprint_opener',
    description: '// Let\'s now process the data — SLOP "AI-fingerprint opener". Advisory warning emitted (WARN).',
    stdin: w('// Let\'s now process the data\nexport function process(d: number[]) {\n  return d;\n}\n'),
    env: {},
  },
  {
    name: 'step_marker',
    description: '// Step 1: parse input — SLOP "narrator/step marker". Advisory warning emitted (WARN).',
    stdin: w('// Step 1: parse input\n// Step 2: transform\nexport function run() { return 1; }\n'),
    env: {},
  },
  {
    name: 'ai_emoji_comment',
    description: '// 🚀 ship it — SLOP "AI emoji in a comment". Advisory warning emitted (WARN).',
    stdin: w('// 🚀 ship it\nexport const x = 1;\n'),
    env: {},
  },
  {
    name: 'restating_comment',
    description: '// foo immediately above function foo — single-identifier restating comment (WARN).',
    stdin: w('// foo\nexport function foo() { return 1; }\n'),
    env: {},
  },
  {
    name: 'commented_code_block',
    description: '3+ consecutive // lines that look like code — commented-out code block (WARN).',
    stdin: w('// const old = 1;\n// const older = 2;\n// const oldest = 3;\nexport const x = 1;\n'),
    env: {},
  },
  {
    name: 'edit_tool_slop',
    description: 'Edit tool new_string surface — AI-fingerprint opener in new_string. Advisory warning (WARN).',
    stdin: {
      hook_event_name: 'PreToolUse', tool_name: 'Edit',
      tool_input: {
        file_path: '/p/src/x.ts', old_string: 'x',
        new_string: '// Let\'s process the data\nexport function process() { return 1; }\n',
      },
    },
    env: {},
  },
  {
    name: 'multi_word_restating',
    description: '// fetch the user above function fetchUser — all content words in identifier tokens (WARN).',
    stdin: w('// fetch the user\nfunction fetchUser() { return null; }\n'),
    env: {},
  },
  {
    name: 'prose_paraphrase_comment',
    description: '// return the result above return result; — prose-paraphrase narrates code below (WARN).',
    stdin: w('// return the result\nreturn result;\n'),
    env: {},
  },
  {
    name: 'block_comment_body_slop',
    description: '/* * Now we initialize the system. */ — AI-fingerprint opener in block comment body (WARN).',
    stdin: w('/*\n * Now we initialize the system.\n */\nexport const x = 1;\n'),
    env: {},
  },
  {
    name: 'multi_edit_tool_slop',
    description: 'MultiEdit tool — edits[].new_string concatenated; slop in one edit fires advisory (WARN).',
    stdin: {
      hook_event_name: 'PreToolUse', tool_name: 'MultiEdit',
      tool_input: {
        file_path: '/p/src/x.ts',
        edits: [
          { old_string: 'a', new_string: '// Step 1: first edit\nexport const a = 1;\n' },
          { old_string: 'b', new_string: 'export const b = 2;\n' },
        ],
      },
    },
    env: {},
  },
]

function runScenario(scenario) {
  const raw = 'rawStdin' in scenario ? scenario.rawStdin : JSON.stringify(scenario.stdin)
  return runHook(raw, scenario.env)
}

function buildEnv(scenario) {
  const env = { ...BASE_ENV }
  for (const [k, v] of Object.entries(scenario.env ?? {})) env[k] = v
  return env
}

function captureAll() {
  console.log('Running deslop-guard parity-corpus capture...')
  console.log('─'.repeat(72))
  console.log(`${'SCENARIO'.padEnd(40)} ${'DECISION'.padEnd(8)} EXIT`)
  console.log('─'.repeat(72))
  for (const sc of SCENARIOS) {
    const result = runScenario(sc)
    const decision = classifyDecision(result.stdout)
    const stdinPayload = 'rawStdin' in sc ? sc.rawStdin : sc.stdin
    const fixture = {
      hook: HOOK_NAME, hook_path: HOOK_REL, event_type: 'PreToolUse',
      scenario_name: sc.name, description: sc.description,
      env: buildEnv(sc), disk_state_setup: [],
      stdin_payload: stdinPayload,
      stdout: result.stdout, stderr: result.stderr, exit_code: result.exit_code,
      decision,
    }
    writeFixture(sc.name, fixture)
    console.log(`${sc.name.padEnd(40)} ${decision.padEnd(8)} ${result.exit_code}`)
  }
  console.log('─'.repeat(72))
  console.log(`${SCENARIOS.length} fixtures written to ${OUT_DIR}`)
}

function verifyAll() {
  console.log('Verifying deslop-guard parity-corpus fixtures...')
  console.log('─'.repeat(72))
  console.log(`${'SCENARIO'.padEnd(40)} ${'STATUS'.padEnd(12)} DETAILS`)
  console.log('─'.repeat(72))
  let identical = 0, different = 0, missing = 0
  for (const sc of SCENARIOS) {
    const fixturePath = join(OUT_DIR, `${sc.name}.json`)
    if (!existsSync(fixturePath)) {
      console.log(`${sc.name.padEnd(40)} ${'MISSING'.padEnd(12)}`)
      missing++
      continue
    }
    const saved = JSON.parse(readFileSync(fixturePath, 'utf8'))
    const result = runScenario(sc)
    const decision = classifyDecision(result.stdout)
    const diffs = []
    if (result.stdout !== saved.stdout) diffs.push(`stdout changed`)
    if (result.stderr !== saved.stderr) diffs.push(`stderr changed`)
    if (result.exit_code !== saved.exit_code) diffs.push(`exit_code: saved=${saved.exit_code} got=${result.exit_code}`)
    if (decision !== saved.decision) diffs.push(`decision: saved=${saved.decision} got=${decision}`)
    if (diffs.length === 0) {
      console.log(`${sc.name.padEnd(40)} ${'IDENTICAL'.padEnd(12)}`)
      identical++
    } else {
      console.log(`${sc.name.padEnd(40)} ${'DIFFERENT'.padEnd(12)} ${diffs.join('; ')}`)
      different++
    }
  }
  console.log('─'.repeat(72))
  console.log(`${SCENARIOS.length} scenarios: ${identical} identical, ${different} different, ${missing} missing`)
  if (different > 0 || missing > 0) process.exit(1)
}

if (process.argv.includes('--verify')) {
  verifyAll()
} else {
  captureAll()
}
