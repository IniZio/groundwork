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
import { readStdin, passthrough, isEmbeddedAgent } from './lib/hook-io.mjs'

function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }),
  )
  process.exit(0)
}

/**
 * Is this file path a run ledger?
 * Matches:
 *   …/.groundwork/run.json          (legacy single-session path)
 *   …/.groundwork/runs/<id>.json    (per-session path)
 */
function isLedgerPath(fp) {
  if (typeof fp !== 'string' || !fp) return false
  const norm = path.normalize(fp)
  // Legacy: …/.groundwork/run.json
  if (path.basename(norm) === 'run.json' && path.basename(path.dirname(norm)) === '.groundwork') return true
  // Per-session: …/.groundwork/runs/<anything>.json
  if (norm.endsWith('.json') && path.basename(path.dirname(norm)) === 'runs') {
    const grandparent = path.basename(path.dirname(path.dirname(norm)))
    if (grandparent === '.groundwork') return true
  }
  return false
}

async function main() {
  // Embedded SDK agents have no groundwork ledger — no enforcement needed.
  if (isEmbeddedAgent()) return passthrough()

  let input = {}
  try {
    const raw = await readStdin()
    if (raw.trim()) input = JSON.parse(raw)
  } catch {
    return passthrough()
  }

  const rawTool = typeof input?.tool_name === 'string' ? input.tool_name : ''
  // Normalize: lowercase + strip leading "fast_" to catch fast_read, fast_edit, fast_multiedit
  const toolNorm = rawTool.toLowerCase().replace(/^fast_/, '')
  const tool = rawTool // keep original for message rendering
  if (toolNorm !== 'read' && toolNorm !== 'edit' && toolNorm !== 'multiedit') return passthrough()
  if (!isLedgerPath(input?.tool_input?.file_path)) return passthrough()

  return deny(
    `groundwork: do not ${tool} the run ledger directly — it forces the whole ledger into the orchestrator's context and races the stop-gate hook's writes. Use the ledger CLI instead (locked, atomic, one-line output):\n` +
      `  $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs status                 — compact progress view (use this instead of reading the file)\n` +
      `  $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs show <id>              — all fields of one slice\n` +
      `  $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs add <id> [--wave N] [--desc "…"] [--blocked-by a,b] [--acceptance "a;b"] [--status …]\n` +
      `  $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs set <id> [--status … | --wave N | --desc … | --blocked-by … | --acceptance …]\n` +
      `  $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs rm <id> [<id> …]       — remove slice(s)\n` +
      `  $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs complete <id> [<id> …] — mark slices complete\n` +
      `  $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs gate advisor APPROVE [--citation … --rubric … --axes-correctness N …]\n` +
      `  $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs abandon                — cancel the run (active:false)\n` +
      `  $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs help [<cmd>]           — full usage`,
  )
}

main().catch(() => passthrough())
