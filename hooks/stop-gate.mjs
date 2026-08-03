#!/usr/bin/env node
/**
 * Groundwork Stop hook — the enforcement teeth for max fan-out.
 *
 * Advisory prompts injected at SessionStart are routinely ignored. This hook is
 * the mechanical backstop: it refuses to let a session end while an active run
 * still has incomplete vertical slices, and on every blocked stop it re-injects
 * the parallel-fan-out rules.
 *
 * Source of truth is the artifact-only ledger at `.groundwork/run.json`, written
 * by the `vertical-slice` / `ultrawork` skills and updated by the orchestrator as
 * waves complete. The hook can only READ the ledger and BLOCK — it cannot observe
 * truth — so it demands the orchestrator record specific evidence (every slice
 * `complete` or `skipped`) before the run is allowed to end.
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
 *  - YIELD-AWARE. A turn-end is not always a stall. When the orchestrator
 *    deliberately yielded — the Stop payload's `background_tasks` shows work still
 *    in flight (authoritative), or the transcript shows awaiting user input
 *    (`needs input:`), reporting failure (`failed:`), having just launched
 *    background delegation, or more `state="running"` launches than
 *    `<task-notification>` completions — the stop is ALLOWED
 *    without burning a reinforcement, so the session can yield and be re-invoked
 *    instead of busy-looping against the gate. The in-flight check is what keeps
 *    the gate from misfiring when the orchestrator is re-invoked on a PARTIAL
 *    completion (one agent of many finished) and ends its turn to await the
 *    rest — that turn issues no new Task call, so the last-turn markers alone
 *    would wrongly read it as a stall.
 *
 * Ledger schema (.groundwork/run.json) — see vertical-slice/SKILL.md:
 *   {
 *     "version": 1,
 *     "active": true,
 *     "session_id": "<session that owns this run, or omitted>",
 *     "brief": "<one-line task description>",
 *     "plan_ref": "<path to plan artifact, or omitted/null>",
 *     "feature_slug": "<kebab-case feature id linking .groundwork/features/<slug>/, or null>",
 *     "reinforcements": 0,
 *     "slices": [
 *       { "id": "S1", "behavior": "...", "files": ["..."], "wave": 0,
 *         "blocked_by": [], "depends_on": [],
 *         "acceptance": ["verifiable done-condition", "..."],
 *         "kind": "plan|diagnose|design|impl",
 *         "status": "pending|in_progress|complete" }
 *     ],
 *     "gate": { "verifier": "pending|passed",
 *               // advisor accepts EITHER a legacy string OR an object:
 *               "advisor":  "pending|APPROVE|CORRECTION|STOP|GAPS|REPLAN"
 *                 | { "verdict": "APPROVE|CORRECTION|STOP|GAPS|REPLAN", "rubric": "...",
 *                     "axes": { "correctness": 0, "completeness": 0, "over_engineering": 0,
 *                               "contract_fitness": 0, "plan_soundness": 0 },
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

import { existsSync, readFileSync } from 'node:fs'
import { mutateLedger, resolveLedgerPath } from './lib/ledger-io.mjs'
import { readStdin, isEmbeddedAgent } from './lib/hook-io.mjs'
import { emitHookEvent } from './lib/journal-io.mjs'

/** Hard ceiling on how many times one run may block a stop before we give up. */
const REINFORCEMENT_CAP = 12

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
    advisor: advisorVerdict(gate),
  })
}

/**
 * Pure: how many background delegations are still in flight, derived from the raw
 * transcript. Every background launch echoes a `state="running"` tool-result and
 * every completion injects one `<task-notification>`; launches in excess of
 * completions are tasks the orchestrator is still legitimately awaiting. Regexes
 * tolerate JSON/escaped quoting (`state=\"running\"`, double-escaped in nested
 * transcripts). Over-counting only biases toward allowing the yield, which never
 * traps the user, so this is deliberately permissive.
 */
function outstandingBackgroundTasks(raw) {
  const launches = (raw.match(/state=\\*"running/g) || []).length
  const completions = (raw.match(/<task-notification>/g) || []).length
  return launches - completions
}

/**
 * Best-effort: return the LAST assistant turn's concatenated text and the names of
 * any tool_use blocks it issued. Tolerates the several transcript line shapes
 * (message-wrapped or flat). Operates on the already-read raw transcript string.
 */
function lastAssistantTurn(raw) {
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
 * Pure: are any harness-tracked background tasks still in flight, per the Stop
 * hook's structured `background_tasks` payload (subagents, shell monitors,
 * workflows, teammates)? This is the AUTHORITATIVE signal — it comes from the
 * harness, not a transcript regex. A task counts as in-flight unless its status
 * is clearly terminal (completed/failed/cancelled/…). Returns false when the
 * field is absent or empty.
 */
function hasInFlightBackgroundTasks(input) {
  const tasks = input?.background_tasks
  if (!Array.isArray(tasks) || tasks.length === 0) return false
  const TERMINAL = /^(completed?|complete|done|failed|error|cancell?ed|stopped|killed|timed_?out)$/i
  return tasks.some((t) => {
    const s = typeof t?.status === 'string' ? t.status : ''
    return !TERMINAL.test(s)
  })
}

/**
 * Best-effort: did the orchestrator deliberately yield this turn (vs. stall)?
 * Returns a short reason string when yielding, else null. Fail-open: any read or
 * parse failure returns null so normal enforcement proceeds.
 *
 * Order of evidence, strongest first:
 *  1. the structured `background_tasks` payload (harness truth);
 *  2. the transcript's own launch/completion bookkeeping (fallback for hosts that
 *     don't populate background_tasks);
 *  3. explicit last-turn protocol markers (needs input:/failed:/just-launched).
 */
function detectYield(input) {
  // 1. Authoritative: harness says background work is still running.
  if (hasInFlightBackgroundTasks(input)) {
    return 'background tasks still in flight (background_tasks payload) — orchestrator awaiting completion'
  }
  const transcriptPath = typeof input?.transcript_path === 'string' ? input.transcript_path : ''
  if (!transcriptPath) return null
  let raw
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return null
  }
  // 2. Fallback in-flight detection from transcript bookkeeping: the orchestrator
  // ending its turn while agents are still running is a yield, not a stall — even
  // on the re-invocation after a PARTIAL completion, where this turn launched
  // nothing new and so the last-turn markers below would miss it.
  if (outstandingBackgroundTasks(raw) > 0) {
    return 'background delegations still in flight — orchestrator awaiting completion'
  }
  let turn
  try {
    turn = lastAssistantTurn(raw)
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
  console.log(
    JSON.stringify({
      decision: 'block',
      reason,
      hookSpecificOutput: { hookEventName: 'Stop', additionalContext: reason },
    }),
  )
  process.exit(0)
}

function buildReason(ledger, incomplete, count) {
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
  lines.push(`Completion gate — advisor: ${advisorShown} (must be APPROVE). [verifier: ${gate.verifier ?? 'n/a'} — informational only]`)

  // REPLAN is non-terminal (only APPROVE releases). Steer the orchestrator back
  // to interview (spec wrong) or vertical-slice (decomposition wrong) — never more impl.
  if (advisorShown === 'REPLAN') {
    lines.push('')
    lines.push('Advisor returned REPLAN — re-enter interview (spec wrong) or vertical-slice (decomposition wrong) before more impl slices; do not resume impl waves.')
  }

  if (count === 0) {
    lines.push('')
    lines.push('REMEMBER THE FAN-OUT RULES:')
    lines.push('- Launch every independent slice in the next wave in ONE message — splitting Task calls across messages is sequential execution in disguise.')
    lines.push('- Each file is owned by exactly ONE slice per wave; shared types live in the Wave 0 tracer.')
    lines.push('- One objective per Task; each prompt self-contained (paths, constraints, success criteria).')
    lines.push('- You are the ORCHESTRATOR — delegate to groundwork:general-purpose. Do not implement slices yourself.')
    lines.push('')
    lines.push('TO FINISH (use the ledger CLI — do NOT Read/Edit run.json by hand): as each slice lands, run `$CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs complete <id>`. When all slices are complete, run the completion gate ([qa if interactive UI] → advisor) and record it with `ledger.mjs gate advisor APPROVE`. Check progress any time with `ledger.mjs status`.')
    lines.push('TO ABANDON: run `$CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs abandon` (sets active:false — the run is cancelled and the gate releases).')
  } else {
    lines.push('')
    lines.push('Full rules were shown on the first block. Finish: ledger.mjs complete <ids> + gate advisor APPROVE. Abandon: ledger.mjs abandon.')
  }
  return lines.join('\n')
}

async function main() {
  // Embedded SDK agents (sdk-py/sdk-js) have no groundwork ledger — pass through silently.
  if (isEmbeddedAgent()) return allow()

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

  const ledgerPath = resolveLedgerPath({ projectDir, sessionId: sessionId || undefined })

  let ledger
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  } catch {
    // No ledger (trivial task / no active run) or unreadable → nothing to enforce.
    return allow()
  }

  if (!ledger || ledger.active !== true) return allow()

  // Never block on a run owned by a different session (defensive layer for legacy fallback).
  if (typeof ledger.session_id === 'string' && ledger.session_id && sessionId && ledger.session_id !== sessionId) {
    return allow()
  }

  const slices = Array.isArray(ledger.slices) ? ledger.slices : []

  const TERMINAL_STATUSES = new Set(['complete', 'skipped'])
  const incomplete = slices.filter((s) => !TERMINAL_STATUSES.has(s?.status))

  // rfc_ref (if present) is informational metadata — it does NOT block session close.

  // Only APPROVE is terminal. REPLAN/REVISE/REJECT/pending keep the gate closed;
  // advisor validates real-world completeness (UI tested, e2e coverage, clarifications
  // resolved) — not just internal consistency.
  const advisorApproved = advisorVerdict(ledger.gate) === 'APPROVE'

  const workRemains = incomplete.length > 0 || !advisorApproved
  // Complete + APPROVE → allow before plan pre-gate (done runs need no plan check).
  // SESSION_END fires on exactly this path — ledger existed, was active, belonged to
  // this session, all slices are terminal, and the advisor verdict is APPROVE.
  // All other allow() paths (embedded agent, unparseable stdin, absent/inactive ledger,
  // foreign session_id, yield, reinforcement-cap) emit nothing — see plan D5.
  if (!workRemains) {
    emitHookEvent({
      projectDir,
      sessionId,
      ledger,
      type: 'SESSION_END',
      msg: 'session ended — run complete',
      source: 'hook:stop-gate',
      data: { outcome: 'complete' },
    })
    return allow()
  }

  // Contract B.5/B.6 — kind:plan / plan_ref pre-gate (non-trivial only).
  // FAIL-OPEN: any error in this check falls through (never wedge the session).
  // Skipped for absent/garbled/foreign-session ledgers (already allowed above).
  // Only mid-flight runs (workRemains) reach this pre-gate.
  try {
    const brief = typeof ledger.brief === 'string' ? ledger.brief : ''
    const trivialEscape =
      (slices.length <= 2 && !slices.some((s) => s?.kind === 'impl')) ||
      /trivial|single-line|config|typo/i.test(brief)
    if (!trivialEscape) {
      const planRef = ledger.plan_ref
      const planRefOk =
        typeof planRef === 'string' &&
        planRef.length > 0 &&
        existsSync(planRef)
      const planSliceComplete = slices.some(
        (s) =>
          (s?.kind === 'plan' || s?.kind === 'design') &&
          s?.status === 'complete',
      )
      if (!planRefOk && !planSliceComplete) {
        return block(
          'Non-trivial run has no plan artifact (plan_ref missing/absent on disk, or no plan/design slice complete). Run interview or planner to produce a plan before more impl.',
        )
      }
    }
  } catch {
    // Fail-open: never block on pre-gate errors.
  }

  // Yield-aware: a deliberate turn-end (background work still in flight, awaiting
  // input, reported failure, or just-launched delegation) is not a stall — let the
  // session yield and be re-invoked, without burning a reinforcement. Fail-open if
  // signals can't be read. Leave the counter untouched so a later genuine stall is
  // still bounded.
  if (detectYield(input)) return allow()

  // Consecutive-no-progress reinforcement: only count when the ledger has NOT
  // advanced since the last block. Real progress resets the counter, so a moving
  // run is never prematurely released; a truly stuck run still hits the cap.
  const sig = progressSignature(ledger)
  const prevSig = typeof ledger.progressSig === 'string' ? ledger.progressSig : ''
  const prevCount = Number.isInteger(ledger.reinforcements) ? ledger.reinforcements : 0
  const count = sig === prevSig ? prevCount : 0
  if (count >= REINFORCEMENT_CAP) return allow()

  // Persist the counter via the shared locked/atomic helper, re-reading fresh so
  // a concurrent `ledger` CLI write (e.g. a slice just marked complete) is never
  // clobbered — we touch only the two housekeeping fields. Best-effort: still
  // block this time even if persistence fails.
  try {
    mutateLedger(ledgerPath, (fresh) => {
      if (!fresh) return null
      fresh.reinforcements = count + 1
      fresh.progressSig = sig
    })
  } catch {
    // Counter persistence is best-effort; still block this time.
  }

  return block(buildReason(ledger, incomplete, count))
}

main().catch(() => allow())
