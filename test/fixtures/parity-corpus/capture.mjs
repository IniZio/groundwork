#!/usr/bin/env node
/**
 * Master parity-corpus capture harness.
 *
 * WARNING: This corpus is frozen (pre-conversion, D-10). The per-hook capture
 * scripts are guarded to refuse execution when the target hook is a gw shim.
 * Do not re-run capture to "refresh fixtures" — the corpus is the ground truth
 * and must not be overwritten with shim output.
 *
 * Usage:
 *   node test/fixtures/parity-corpus/capture.mjs [--dry-run]
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const HOOK_DIRS = [
  'stop-gate',
  'session-reminder',
  'nesting-guard',
  'agent-model-guard',
  'orchestrator-impl-guard',
  'ledger-guard',
  'ledger-bash-guard',
  'piped-exit-code-guard',
  'struggle-detector',
]

// Scenario counts per hook (matches captured fixture counts)
const SCENARIO_COUNTS = {
  'stop-gate': 9,
  'session-reminder': 4,
  'nesting-guard': 9,
  'agent-model-guard': 6,
  'orchestrator-impl-guard': 6,
  'ledger-guard': 8,
  'ledger-bash-guard': 8,
  'piped-exit-code-guard': 8,
  'struggle-detector': 6,
}

const dryRun = process.argv.includes('--dry-run')
const extraArgs = dryRun ? ['--dry-run'] : []

const results = []

console.log(`\nGroundwork parity-corpus capture${dryRun ? ' (dry-run)' : ''}\n`)

for (const hookDir of HOOK_DIRS) {
  const script = join(__dirname, hookDir, 'capture.mjs')
  const result = spawnSync('node', [script, ...extraArgs], { stdio: 'inherit' })
  const ok = result.status === 0 && result.error == null
  results.push({ hookDir, ok, status: result.status, error: result.error })
}

// Summary table
const COL_HOOK = 34
const COL_SCENARIOS = 11
const COL_STATUS = 8

const header =
  'Hook'.padEnd(COL_HOOK) +
  'Scenarios'.padEnd(COL_SCENARIOS) +
  'Status'
const sep = '-'.repeat(COL_HOOK + COL_SCENARIOS + COL_STATUS)

console.log('\n' + header)
console.log(sep)

let anyFailed = false
for (const { hookDir, ok } of results) {
  const count = SCENARIO_COUNTS[hookDir] ?? '?'
  const status = ok ? 'OK' : 'ERROR'
  if (!ok) anyFailed = true
  console.log(
    hookDir.padEnd(COL_HOOK) +
    String(count).padEnd(COL_SCENARIOS) +
    status
  )
}

console.log(sep)

const total = Object.values(SCENARIO_COUNTS).reduce((a, b) => a + b, 0)
const failCount = results.filter(r => !r.ok).length
console.log(
  `Total`.padEnd(COL_HOOK) +
  String(total).padEnd(COL_SCENARIOS) +
  (anyFailed ? `${failCount} FAILED` : 'ALL OK')
)
console.log()

if (anyFailed) {
  process.exit(1)
}
