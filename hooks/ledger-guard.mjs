#!/usr/bin/env node
/**
 * Groundwork PreToolUse hook — ledger access guard (enforcement teeth).
 *
 * The instruction "mutate the ledger only via the `ledger` CLI, never Read/Edit
 * run.json" lives in CLAUDE.md and the skills — but advisory text is routinely
 * dropped under context pressure (the same reason model: was omitted 30× until a
 * hook enforced it). This hook makes the rule mechanical: it DENIES Read / Edit /
 * MultiEdit of `.groundwork/run.json` and points at the CLI. Denying a Read is
 * what actually saves context — the orchestrator never pulls the ~5 KB ledger in.
 *
 * Scope and safety:
 *  - Only Read/Edit/MultiEdit are intercepted. The one-shot initial `Write`
 *    (vertical-slice creating the ledger) is intentionally NOT touched.
 *  - Only the exact file `…/.groundwork/run.json` triggers a deny; everything
 *    else passes through untouched.
 *  - The stop-gate and other hooks read the ledger via node `readFileSync`, not
 *    the Read tool, so they are unaffected.
 *  - FAIL-OPEN: any error → emit nothing, exit 0 (let the call proceed).
 */

import path from 'node:path'

async function readStdin() {
  try {
    let data = ''
    for await (const chunk of process.stdin) data += chunk
    return data
  } catch {
    return ''
  }
}

function passthrough() {
  process.exit(0)
}

function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }),
  )
  process.exit(0)
}

/** Is this file path the run ledger (`…/.groundwork/run.json`)? */
function isLedgerPath(fp) {
  if (typeof fp !== 'string' || !fp) return false
  const norm = path.normalize(fp)
  return path.basename(norm) === 'run.json' && path.basename(path.dirname(norm)) === '.groundwork'
}

async function main() {
  let input = {}
  try {
    const raw = await readStdin()
    if (raw.trim()) input = JSON.parse(raw)
  } catch {
    return passthrough()
  }

  const tool = typeof input?.tool_name === 'string' ? input.tool_name : ''
  if (tool !== 'Read' && tool !== 'Edit' && tool !== 'MultiEdit') return passthrough()
  if (!isLedgerPath(input?.tool_input?.file_path)) return passthrough()

  return deny(
    `groundwork: do not ${tool} .groundwork/run.json directly — it forces the whole ledger into the orchestrator's context and races the stop-gate hook's writes. Use the ledger CLI instead (locked, atomic, one-line output):\n` +
      `  $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs status                 — compact progress view (use this instead of reading the file)\n` +
      `  $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs complete <id> [<id> …] — mark slices complete\n` +
      `  $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs gate advisor APPROVE [--citation … --rubric … --axes-correctness N …]\n` +
      `  $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs gate critic passed\n` +
      `  $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs abandon                — cancel the run (active:false)`,
  )
}

main().catch(() => passthrough())
