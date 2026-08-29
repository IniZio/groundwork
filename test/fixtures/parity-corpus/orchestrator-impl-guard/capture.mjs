#!/usr/bin/env node
/**
 * Parity-corpus capture script for hooks/orchestrator-impl-guard.mjs
 *
 * Usage: node test/fixtures/parity-corpus/orchestrator-impl-guard/capture.mjs
 *
 * NOTE: This hook WARNS (non-blocking additionalContext) rather than hard-denying.
 * Decision values: PASS (silent passthrough) | WARN (additionalContext in stdout)
 */

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const HOOK_PATH = path.join(REPO_ROOT, 'hooks', 'orchestrator-impl-guard.mjs')
const OUT_DIR = __dirname
const HOME = process.env.HOME || os.homedir()

const HOOK_NAME = 'orchestrator-impl-guard.mjs'
const HOOK_REL = 'hooks/orchestrator-impl-guard.mjs'

const scenarios = [
  {
    name: 'subagent_always_passes',
    description: 'Caller is subagent (agent_type set) — always passthrough regardless of file_path',
    stdin: {
      tool_name: 'Edit',
      tool_input: { file_path: `${REPO_ROOT}/src/foo.ts` },
      agent_type: 'groundwork:general-purpose',
      agent_id: 'abc123',
    },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'orchestrator_blocked_src_file',
    description: 'Orchestrator (no agent signals) tries to Edit a src/ file — WARN with delegation nudge',
    stdin: {
      tool_name: 'Edit',
      tool_input: { file_path: `${REPO_ROOT}/src/foo.ts` },
    },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'orchestrator_blocked_hooks',
    description: 'Orchestrator tries to Write a hooks/ file — WARN',
    stdin: {
      tool_name: 'Write',
      tool_input: { file_path: `${REPO_ROOT}/hooks/foo.mjs` },
    },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'orchestrator_permitted_memory',
    description: 'Orchestrator writes to ~/.claude/projects/<hash>/memory/MEMORY.md — PASS (permit path)',
    stdin: {
      tool_name: 'Edit',
      tool_input: { file_path: `${HOME}/.claude/projects/abc123def456/memory/MEMORY.md` },
    },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'orchestrator_blocked_spoof_memory',
    description: 'Path traversal spoof: memory/../../src/evil.ts — resolves outside memory/, WARN',
    stdin: {
      tool_name: 'Edit',
      tool_input: { file_path: `${HOME}/.claude/projects/abc123/memory/../../src/evil.ts` },
    },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'orchestrator_blocked_groundwork_path',
    description: 'Orchestrator tries to Edit a .groundwork/ file — WARN',
    stdin: {
      tool_name: 'Edit',
      tool_input: { file_path: `${REPO_ROOT}/.groundwork/out-of-scope/foo.md` },
    },
    env: {},
    disk_state_setup: [],
  },
]

/**
 * Classify outcome for orchestrator-impl-guard:
 * PASS: empty stdout (true passthrough, subagent or permitted path)
 * WARN: stdout JSON has additionalContext (non-blocking delegation nudge)
 * DENY: permissionDecision: 'deny' (not expected for this hook, but handled)
 */
function classifyDecision(stdout, exitCode) {
  if (exitCode !== 0) return 'DENY'
  const trimmed = stdout.trim()
  if (!trimmed) return 'PASS'
  try {
    const parsed = JSON.parse(trimmed)
    const hs = parsed?.hookSpecificOutput
    if (hs?.permissionDecision === 'deny') return 'DENY'
    if (hs?.additionalContext) return 'WARN'
    if (hs?.permissionDecision === 'allow') return 'PASS'
  } catch {
    // non-JSON
  }
  return 'PASS'
}

const results = []

for (const scenario of scenarios) {
  const stdinStr = JSON.stringify(scenario.stdin)

  const result = spawnSync(HOOK_PATH, [], {
    input: stdinStr,
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, ...scenario.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const exitCode = result.status ?? (result.error ? 1 : 0)
  const decision = classifyDecision(stdout, exitCode)

  const fixture = {
    hook: HOOK_NAME,
    hook_path: HOOK_REL,
    event_type: 'PreToolUse',
    scenario_name: scenario.name,
    description: scenario.description,
    env: scenario.env,
    disk_state_setup: scenario.disk_state_setup,
    stdin_payload: scenario.stdin,
    stdout,
    stderr,
    exit_code: exitCode,
    decision,
  }

  const outPath = path.join(OUT_DIR, `${scenario.name}.json`)
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n')

  results.push({ name: scenario.name, decision, exitCode })
}

// Summary table
console.log('\norchestrator-impl-guard parity-corpus capture — summary')
console.log('─'.repeat(68))
console.log(`${'SCENARIO'.padEnd(46)} ${'DECISION'.padEnd(8)} EXIT`)
console.log('─'.repeat(68))
for (const r of results) {
  console.log(`${r.name.padEnd(46)} ${r.decision.padEnd(8)} ${r.exitCode}`)
}
console.log('─'.repeat(68))
console.log(`${results.length} fixtures written to ${OUT_DIR}`)
