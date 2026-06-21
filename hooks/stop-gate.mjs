#!/usr/bin/env node
/**
 * Groundwork Stop hook — the enforcement teeth for max fan-out.
 *
 * Advisory prompts injected at SessionStart are routinely ignored. This hook is
 * the mechanical backstop: it refuses to let a session end while an active run
 * still has incomplete vertical slices or has not been signed off by the advisor
 * gate, and on every blocked stop it re-injects the parallel-fan-out rules.
 *
 * Source of truth is the artifact-only ledger at `.groundwork/run.json`, written
 * by the `vertical-slice` / `ultrawork` skills and updated by the orchestrator as
 * waves complete. The hook can only READ the ledger and BLOCK — it cannot observe
 * truth — so it demands the orchestrator record specific evidence (every slice
 * `complete`, `gate.advisor === "APPROVE"`) before the run is allowed to end.
 *
 * Design guarantees:
 *  - FAIL-OPEN. Any error, missing/garbled ledger, or absent run → allow the stop.
 *    A hook must never wedge a user's session.
 *  - SESSION-SCOPED. A ledger stamped with a different session_id never blocks the
 *    current session (prevents cross-session leakage of stale runs).
 *  - BOUNDED. A reinforcement counter caps how many times a single run may block,
 *    so a stuck orchestrator cannot trap the user forever. The counter measures
 *    CONSECUTIVE no-progress blocks: it resets to 0 whenever the ledger advances
 *    (a slice completes, a gate flips), so a run that is genuinely progressing is
 *    never prematurely released, while a truly stuck run still hits the cap.
 *  - YIELD-AWARE. A turn-end is not always a stall. When the transcript shows the
 *    orchestrator deliberately yielded — awaiting user input (`needs input:`),
 *    reporting failure (`failed:`), or having just launched background delegation
 *    — the stop is ALLOWED without burning a reinforcement, so the session can
 *    yield and be re-invoked instead of busy-looping against the gate.
 *
 * Ledger schema (.groundwork/run.json) — see vertical-slice/SKILL.md:
 *   {
 *     "version": 1,
 *     "active": true,
 *     "session_id": "<session that owns this run, or omitted>",
 *     "brief": "<one-line task description>",
 *     "reinforcements": 0,
 *     "slices": [
 *       { "id": "S1", "behavior": "...", "files": ["..."], "wave": 0,
 *         "blocked_by": [], "depends_on": [],
 *         "acceptance": ["verifiable done-condition", "..."],
 *         "status": "pending|in_progress|complete" }
 *     ],
 *     "gate": { "verifier": "pending|passed",
 *               "critic":   "pending|passed|skipped",
 *               // advisor accepts EITHER a legacy string OR an object:
 *               "advisor":  "pending|APPROVE|REVISE|REJECT"
 *                 | { "verdict": "APPROVE|REVISE|REJECT", "rubric": "...",
 *                     "axes": { "correctness": 0, "completeness": 0, "over_engineering": 0 },
 *                     "citation": "<file:line|construct|'none'>" } }
 *   }
 *
 *   slices[].blocked_by is the canonical wave-ordering dependency (depends_on is an
 *   accepted legacy alias). slices[].acceptance is an optional string[] of checkbox
 *   done-conditions surfaced in the block reason.
 *
 *   The hook also maintains two fields itself (orchestrator need not touch them):
 *   reinforcements (consecutive no-progress block count) and progressSig (a hash of
 *   the enforcement-relevant ledger state at the last block, used to detect progress).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Hard ceiling on how many times one run may block a stop before we give up. */
const REINFORCEMENT_CAP = 12

/** Read all of stdin; resolve '' on empty/closed/error. Never throws. */
async function readStdin() {
  try {
    let data = ''
    for await (const chunk of process.stdin) data += chunk
    return data
  } catch {
    return ''
  }
}

/**
 * Pure: extract the advisor verdict from either the legacy string form
 * ("APPROVE") or the object form ({ verdict: "APPROVE", ... }). Returns an
 * UPPERCASE verdict string, or null when absent/unrecognized.
 */
function advisorVerdict(gate) {
  const a = gate?.advisor
  if (typeof a === 'string') return a.toUpperCase()
  if (a && typeof a === 'object' && a.verdict != null) return String(a.verdict).toUpperCase()
  return null
}

/**
 * Pure: a stable fingerprint of the enforcement-relevant ledger state (slice
 * statuses + gate verdicts). Two blocks with the same signature mean the run did
 * NOT advance between them — that is what the reinforcement counter counts.
 */
function progressSignature(ledger) {
  const slices = Array.isArray(ledger?.slices) ? ledger.slices : []
  const sliceState = slices.map((s) => `${s?.id ?? '?'}:${s?.status ?? '?'}`).join(',')
  const gate = ledger?.gate ?? {}
  return JSON.stringify({
    sliceState,
    verifier: gate.verifier ?? null,
    critic: gate.critic ?? null,
    advisor: advisorVerdict(gate),
  })
}

/**
 * Best-effort: return the LAST assistant turn's concatenated text and the names of
 * any tool_use blocks it issued. Tolerates the several transcript line shapes
 * (message-wrapped or flat). Throws only on unreadable file — caller catches.
 */
function lastAssistantTurn(transcriptPath) {
  const raw = readFileSync(transcriptPath, 'utf8')
  let text = ''
  let toolNames = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let obj
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }
    const role = obj?.message?.role ?? obj?.role ?? (obj?.type === 'assistant' ? 'assistant' : undefined)
    if (role !== 'assistant') continue
    const content = obj?.message?.content ?? obj?.content
    if (typeof content === 'string') {
      text = content
      toolNames = []
      continue
    }
    if (!Array.isArray(content)) continue
    let txt = ''
    const names = []
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') txt += `${block.text}\n`
      if (block?.type === 'tool_use' && typeof block.name === 'string') names.push(block.name)
    }
    text = txt
    toolNames = names
  }
  return { text, toolNames }
}

/**
 * Best-effort: did the orchestrator deliberately yield this turn (vs. stall)?
 * Returns a short reason string when yielding, else null. Fail-open: any read or
 * parse failure returns null so normal enforcement proceeds.
 */
function detectYield(transcriptPath) {
  if (!transcriptPath) return null
  let turn
  try {
    turn = lastAssistantTurn(transcriptPath)
  } catch {
    return null
  }
  const text = turn.text || ''
  // Protocol markers (own line, optionally prefixed by markdown list/quote chars).
  if (/^[ \t>*\-]*needs input:/im.test(text)) return 'awaiting user input (needs input:)'
  if (/^[ \t>*\-]*failed:/im.test(text)) return 'run reported failed (failed:)'
  // Just launched a delegation and ended the turn → waiting for it to land.
  if (turn.toolNames.some((n) => /task|agent/i.test(n))) return 'launched background delegation and yielded'
  if (/waiting for .{0,40}(completion|notification|background|task)/i.test(text)) return 'waiting on background tasks'
  return null
}

/** Emit a decision and exit. Default lets the stop proceed. */
function allow() {
  console.log(JSON.stringify({ continue: true }))
  process.exit(0)
}

function block(reason) {
  console.log(JSON.stringify({ decision: 'block', reason }))
  process.exit(0)
}

function buildReason(ledger, incomplete) {
  const lines = []
  lines.push('⛔ GROUNDWORK STOP-GATE — this run is NOT complete.')
  lines.push('')
  if (ledger.brief) lines.push(`Run: ${ledger.brief}`)

  const total = Array.isArray(ledger.slices) ? ledger.slices.length : 0
  const done = total - incomplete.length
  lines.push(`Slices: ${done}/${total} complete.`)
  if (incomplete.length) {
    lines.push('Incomplete slices (fan these out — do NOT finish them yourself):')
    for (const s of incomplete) {
      const files = Array.isArray(s.files) ? s.files.join(', ') : ''
      const ac = Array.isArray(s.acceptance) ? s.acceptance.length : 0
      const acNote = ac ? ` — ${ac} acceptance criteria to verify` : ''
      lines.push(`  - ${s.id ?? '?'} [wave ${s.wave ?? '?'}] ${s.behavior ?? ''} (${s.status ?? 'pending'})${files ? ` — owns: ${files}` : ''}${acNote}`)
    }
  }

  const gate = ledger.gate ?? {}
  const advisorShown = advisorVerdict(gate) ?? 'pending'
  lines.push('')
  lines.push(`Completion gate — verifier: ${gate.verifier ?? 'pending'} · critic: ${gate.critic ?? 'pending'} · advisor: ${advisorShown} (must be APPROVE).`)

  lines.push('')
  lines.push('REMEMBER THE FAN-OUT RULES:')
  lines.push('- Launch every independent slice in the next wave in ONE message — splitting Task calls across messages is sequential execution in disguise.')
  lines.push('- Each file is owned by exactly ONE slice per wave; shared types live in the Wave 0 tracer.')
  lines.push('- One objective per Task; each prompt self-contained (paths, constraints, success criteria).')
  lines.push('- You are the ORCHESTRATOR — delegate to groundwork:coder. Do not implement slices yourself.')
  lines.push('')
  lines.push('TO FINISH: as each slice lands, set its status to "complete" in .groundwork/run.json. When all slices are complete, run verifier → critic → advisor and record gate.advisor = "APPROVE".')
  lines.push('TO ABANDON: set "active": false in .groundwork/run.json (the run is cancelled and the gate releases).')
  return lines.join('\n')
}

async function main() {
  let input = {}
  try {
    const raw = await readStdin()
    if (raw.trim()) input = JSON.parse(raw)
  } catch {
    return allow()
  }

  // A stop that is itself a continuation of a prior stop-hook block still gets
  // re-evaluated below; the reinforcement counter (not stop_hook_active) bounds the loop.
  const sessionId = typeof input?.session_id === 'string' ? input.session_id : ''
  const projectDir =
    (typeof input?.cwd === 'string' && input.cwd) ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd()

  const ledgerPath = path.join(projectDir, '.groundwork', 'run.json')

  let ledger
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  } catch {
    // No ledger (trivial task / no active run) or unreadable → nothing to enforce.
    return allow()
  }

  if (!ledger || ledger.active !== true) return allow()

  // Never block on a run owned by a different session.
  if (typeof ledger.session_id === 'string' && ledger.session_id && sessionId && ledger.session_id !== sessionId) {
    return allow()
  }

  const slices = Array.isArray(ledger.slices) ? ledger.slices : []
  const incomplete = slices.filter((s) => s?.status !== 'complete')
  const advisorApproved = advisorVerdict(ledger.gate) === 'APPROVE'

  const workRemains = incomplete.length > 0 || !advisorApproved
  if (!workRemains) return allow()

  // Yield-aware: a deliberate turn-end (awaiting input, reported failure, or just
  // launched background delegation) is not a stall — let the session yield and be
  // re-invoked, without burning a reinforcement. Fail-open if the transcript can't
  // be read. Leave the counter untouched so a later genuine stall is still bounded.
  const transcriptPath = typeof input?.transcript_path === 'string' ? input.transcript_path : ''
  if (detectYield(transcriptPath)) return allow()

  // Consecutive-no-progress reinforcement: only count when the ledger has NOT
  // advanced since the last block. Real progress resets the counter, so a moving
  // run is never prematurely released; a truly stuck run still hits the cap.
  const sig = progressSignature(ledger)
  const prevSig = typeof ledger.progressSig === 'string' ? ledger.progressSig : ''
  const prevCount = Number.isInteger(ledger.reinforcements) ? ledger.reinforcements : 0
  const count = sig === prevSig ? prevCount : 0
  if (count >= REINFORCEMENT_CAP) return allow()

  try {
    ledger.reinforcements = count + 1
    ledger.progressSig = sig
    writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`)
  } catch {
    // Counter persistence is best-effort; still block this time.
  }

  return block(buildReason(ledger, incomplete))
}

main().catch(() => allow())
