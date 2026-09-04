#!/usr/bin/env node
/**
 * Groundwork SessionStart hook — injects orchestrator routing rules as a system-reminder.
 *
 * Fires on startup, resume, and context compaction so behavioral compliance
 * survives long sessions. Called by session-start (the tracked hook entrypoint).
 *
 * Beyond the static rulebook, when this session OWNS an active run ledger
 * (.groundwork/run.json) it also re-surfaces the live run-state — incomplete
 * slices, the advisor-gate status, and the banner to re-emit. Compaction
 * summarizes away the working memory of an in-flight run; the static rules
 * alone do not tell the resumed orchestrator that a run is mid-flight and the
 * Stop-gate is armed. This block carries that state across the boundary.
 */

import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readStdin, isEmbeddedAgent } from './lib/hook-io.mjs'
import { estimateTokens } from './lib/doc-io.mjs'
import { resolvedUnits, inFlightUnit, isExhausted } from './lib/pacing.mjs'

/** Absolute paths to the bin wrappers — reliable regardless of session cwd. */
const _hooksDir = path.dirname(fileURLToPath(import.meta.url))
const LEDGER_BIN = path.resolve(_hooksDir, '../bin/ledger') // kept: init and help have no gw equivalent
const GW_HOOK_BIN = path.resolve(_hooksDir, '../bin/gw-hook') // operational gw ledger commands
const JOURNAL_BIN = path.resolve(_hooksDir, '../bin/journal')
import { resolveLedgerPath } from './lib/ledger-io.mjs'
import { buildStruggleNudge } from './lib/struggle-nudge.mjs'
import { ensureGroundworkExcluded } from './lib/ensure-git-exclude.mjs'
import { specDirPath, loadIndex, buildIndexData } from './lib/spec-io.mjs'
import { emitHookEvent } from './lib/journal-io.mjs'

// ---------------------------------------------------------------------------
// Spec skeleton renderer (AC6, AC7)
// ---------------------------------------------------------------------------

const SPEC_SKELETON_TOKEN_CAP = 700
const SPEC_NODE_DEPTH1_THRESHOLD = 40

/**
 * Build a compact spec skeleton from the spec index.
 * Returns '' if no spec exists or on any error (fail-open).
 * Degrades to depth-1 with child counts rather than truncating mid-tree.
 */
function buildSpecSkeleton(projectDir) {
  try {
    const sd = specDirPath(projectDir)
    if (!existsSync(sd)) return ''

    // Load index (or build on the fly — we don't want to trigger a full build
    // in a SessionStart hook, so use loadIndex only if present).
    let index = loadIndex(sd)
    if (!index) {
      // Build on the fly (fast, no side effects other than reading files)
      const { nodes } = buildIndexData(sd)
      index = { nodes }
    }
    const nodes = index.nodes || {}
    const nodeValues = Object.values(nodes)
    if (nodeValues.length === 0) return ''

    // Separate concept nodes (no concept field = root concept) from requirements
    const concepts = nodeValues.filter((n) => n.type === 'concept' || !n.concept)
    const requirements = nodeValues.filter((n) => n.type === 'requirement' || n.concept)

    // Build child count map: concept id → number of direct requirements
    const childCounts = {}
    for (const r of requirements) {
      const parent = r.concept || r.parent
      if (parent) {
        childCounts[parent] = (childCounts[parent] || 0) + 1
      }
    }

    // Try full depth-1 render first, degrade if over cap
    const lines = ['', '## Spec Skeleton', '']
    const topLevelConcepts = concepts.filter((n) => !n.parent && !n.concept)

    // If too many top-level nodes, always use depth 1 with child counts
    const useDepth1 = topLevelConcepts.length > SPEC_NODE_DEPTH1_THRESHOLD || concepts.length > SPEC_NODE_DEPTH1_THRESHOLD

    if (useDepth1 || true) {
      // Always render depth 1 with child counts (safe, bounded)
      for (const c of topLevelConcepts) {
        const children = childCounts[c.id] || 0
        lines.push(`- **${c.id}** ${c.title || c.id}${children ? ` (${children} req${children !== 1 ? 's' : ''})` : ''}`)
        // Show direct concept children at depth 1
        const childConcepts = concepts.filter((n) => n.parent === c.id || n.concept === c.id)
        for (const cc of childConcepts) {
          const ccChildren = childCounts[cc.id] || 0
          lines.push(`  - **${cc.id}** ${cc.title || cc.id}${ccChildren ? ` (${ccChildren} req${ccChildren !== 1 ? 's' : ''})` : ''}`)
        }
      }
    }

    const totalNodes = nodeValues.length
    lines.push('')
    lines.push(`_${totalNodes} spec node${totalNodes !== 1 ? 's' : ''} total_`)

    const rendered = lines.join('\n')
    if (estimateTokens(rendered) <= SPEC_SKELETON_TOKEN_CAP) {
      return rendered
    }

    // Over cap at depth 1 — degrade to just top-level with counts
    const stripped = ['', '## Spec Skeleton', '']
    for (const c of topLevelConcepts) {
      const children = childCounts[c.id] || 0
      stripped.push(`- **${c.id}** ${c.title || c.id}${children ? ` (${children} req${children !== 1 ? 's' : ''})` : ''}`)
    }
    stripped.push('')
    stripped.push(`_${totalNodes} spec nodes total (degraded to root only)_`)
    return stripped.join('\n')
  } catch {
    return '' // fail-open
  }
}

/** Normalize gate.advisor (legacy string OR {verdict,...} object) to its verdict string, else null. */
function advisorVerdict(gate) {
  const a = gate?.advisor
  if (typeof a === 'string') return a
  if (a && typeof a === 'object' && typeof a.verdict === 'string') return a.verdict
  return null
}

/**
 * Build a compact "resume here" block when this session owns an active run.
 * Returns '' when there is no readable, active, session-owned ledger (fail-open).
 */
function activeRunBlock(projectDir, sessionId) {
  let ledger
  try {
    const lp = resolveLedgerPath({ projectDir, sessionId: sessionId || undefined })
    ledger = JSON.parse(readFileSync(lp, 'utf8'))
  } catch {
    return '' // no ledger, unreadable, or malformed — nothing to resurface
  }
  if (!ledger || ledger.active !== true) return ''
  // Only resurface a run owned by THIS session — never a foreign or stale run.
  if (sessionId && typeof ledger.session_id === 'string' && ledger.session_id !== sessionId) return ''

  const slices = Array.isArray(ledger.slices) ? ledger.slices : []
  const incomplete = slices.filter((s) => s?.status !== 'complete')
  const verdict = advisorVerdict(ledger.gate)
  const motiveSlug = typeof ledger.motive === 'string' && ledger.motive ? ledger.motive : '<motive-slug>'

  const lines = ['', '## ⚠ ACTIVE RUN — RESUME HERE', '']
  if (typeof ledger.brief === 'string' && ledger.brief) lines.push(`Run: ${ledger.brief}`)
  if (typeof ledger.plan_ref === 'string' && ledger.plan_ref) lines.push(`Plan: ${ledger.plan_ref}`)
  const ledgerRef = ledger.session_id ? `.groundwork/runs/${ledger.session_id}.json` : `.groundwork/run.json`
  lines.push(`Ledger: ${ledgerRef} — ${slices.length} slices, advisor gate: ${verdict ?? 'not recorded'}`)
  lines.push('')

  if (typeof ledger.write_token === 'string' && ledger.write_token) {
    lines.push(`Ledger write-token for this run: ${ledger.write_token} — pass \`--token ${ledger.write_token}\` on every \`${GW_HOOK_BIN} ledger gate … --motive ${motiveSlug}\` and \`${GW_HOOK_BIN} ledger complete … --motive ${motiveSlug}\`. NEVER include this token in a subagent Task prompt.`)
    lines.push('')
  }

  // Pacing state — surface so a hard budget block reads as policy, not a bug.
  const pacing = ledger.pacing ?? null
  if (pacing) {
    const policy = pacing.policy ?? 'wave'
    const budget = pacing.budget ?? 1
    const exemptKinds = Array.isArray(pacing.exempt_kinds) ? pacing.exempt_kinds.join(', ') : ''
    const resolved = resolvedUnits(ledger)
    const grant = pacing.grant ?? null
    const grantRange = grant?.range ?? 0
    const cap = budget + grantRange
    const exhausted = isExhausted(ledger)
    const inFlight = inFlightUnit(ledger)
    const pacingLines = [
      `Pacing policy: ${policy}, budget: ${budget} unit${budget === 1 ? '' : 's'}${grantRange > 0 ? ` + grant of ${grantRange}` : ''}, exempt kinds: [${exemptKinds}]`,
      `Pacing state: ${resolved} of ${cap} unit${cap === 1 ? '' : 's'} resolved${inFlight !== null ? `, in-flight unit: ${inFlight}` : ''}`,
    ]
    if (exhausted) {
      const tokenArg = typeof ledger.write_token === 'string' && ledger.write_token ? ` --token ${ledger.write_token}` : ''
      pacingLines.push(`⚠ Budget exhausted — \`ledger claim\` and \`ledger set --status in_progress\` will exit 1 for new units. This is the pacing policy, not a bug.`)
      pacingLines.push(`  Sanctioned overage: \`${GW_HOOK_BIN} ledger autopilot --range N${tokenArg} --motive ${motiveSlug}\` (orchestrator-only; NEVER pass token to subagents).`)
    } else if (grantRange > 0) {
      pacingLines.push(`Grant in effect: autopilot extended budget by ${grantRange} unit${grantRange === 1 ? '' : 's'}.`)
    }
    lines.push(...pacingLines, '')
  }

  if (incomplete.length) {
    lines.push(`${incomplete.length} slice(s) NOT complete — the Stop-gate stays armed until each is \`complete\` and \`gate.advisor\` is APPROVE:`)
    const ACTIVE_RUN_SLICE_CAP = 10
    const shownSlices = incomplete.slice(0, ACTIVE_RUN_SLICE_CAP)
    const hiddenCount = incomplete.length - shownSlices.length
    for (const s of shownSlices) {
      const acc = Array.isArray(s?.acceptance) && s.acceptance.length ? ` — ${s.acceptance.length} acceptance criteria` : ''
      lines.push(`- ${s?.id ?? '?'} [${s?.status ?? '?'}] ${String(s?.behavior ?? '').slice(0, 80)}${acc}`)
    }
    if (hiddenCount > 0) {
      lines.push(`  (and ${hiddenCount} more incomplete slice(s) — see ledger for full list)`)
    }
    lines.push('')
    lines.push(`Re-emit the banner and continue the fan-out: \`GROUNDWORK ▸ resuming ${incomplete.length} incomplete slice(s) → ${ledgerRef}\``)
  } else if (verdict !== 'APPROVE') {
    lines.push('All slices complete but the advisor gate is not APPROVE. Run the completion gate ([qa if interactive UI] → advisor), record `gate.advisor`, OR set `"active": false` to close the run.')
  } else {
    lines.push(`All slices complete and advisor APPROVE — this run is finished. Set \`"active": false\` in ${ledgerRef} to close it out so the Stop-gate stands down.`)
  }

  // Wave-width diagnostic: emit a notice for any impl wave that was PLANNED with exactly 1
  // non-exempt slice and still has that slice pending. A wave that was planned wide but is
  // nearly finished (e.g. 4 of 5 slices complete) must NOT fire — check the TOTAL slice count
  // per wave, not just the incomplete count, to avoid spurious late-run notices.
  // Read-only, fail-open — must not block or throw.
  try {
    const EXEMPT_KINDS = new Set(['plan', 'diagnose', 'design', 'fog'])
    /** @type {Record<string|number, number>} */
    const totalWaveCount = {}
    /** @type {Record<string|number, number>} */
    const incompleteWaveCount = {}
    for (const s of slices) {
      if (!s || EXEMPT_KINDS.has(s.kind ?? 'impl')) continue
      const w = s.wave ?? 0
      totalWaveCount[w] = (totalWaveCount[w] ?? 0) + 1
      if (s.status !== 'complete') {
        incompleteWaveCount[w] = (incompleteWaveCount[w] ?? 0) + 1
      }
    }
    for (const [wave, total] of Object.entries(totalWaveCount)) {
      // Fire only when the wave was planned with exactly 1 impl slice AND that slice is still pending.
      if (total === 1 && (incompleteWaveCount[wave] ?? 0) === 1) {
        lines.push(`NOTICE: wave ${wave} has 1 impl slice — if this work is non-trivial, reconsider whether it can run in parallel with an adjacent slice.`)
      }
    }
  } catch { /* fail-open — never block the hook */ }

  return `\n${lines.join('\n')}`
}

const reminder = `# groundwork — Orchestrator Mode (max fan-out)

You are the ORCHESTRATOR. Classify, decompose, delegate, review. NEVER implement directly — no Edit/Write/Grep/Glob/Read or running builds yourself.

## Routing

See the issue-type routing table in CLAUDE.md (always loaded).

## Prime directive

Fire all independent agent calls simultaneously; never serialize independent work. ALL parallel Task calls MUST be in ONE message — Task A then Task B in separate messages is sequential execution in disguise. Two tasks are independent ONLY if neither consumes the other's output AND they share no undefined type, schema, or file — when unsure, ask: (1) does slice B import a symbol or file that slice A creates? (2) must B observe A's runtime behavior? (3) does either slice edit a file the other also edits? If ANY of the three is clearly yes, the slices are NOT independent — add a blocked_by edge. Otherwise, treat them as independent. Add a blocked_by edge only when you can name the specific artifact consumed.

## Background fan-out

Fan-out tasks run in the background by default (v2.1.198+); fire every wave's independent task() calls in ONE message and end your turn — you will be re-invoked on each completion.

## DO NOT use question to wait for background tasks

When you have background tasks running and no other work to do:
- Write a brief status update and END YOUR TURN
- Do NOT call \`question\` — it blocks background task completion notifications
- You will be re-invoked automatically when each task completes
- \`question\` is for user input/decisions ONLY, never as a wait/pause mechanism

## Vertical-slice gate (mandatory)

Before launching implementation agents (junior-orchestrator or general-purpose) on ANY task touching ≥3 files OR ≥2 user-facing behaviors OR with a large verification surface (requires real hardware or physical devices; requires a multi-service or otherwise non-trivial live environment; involves >5 distinct QA scenarios; or spans ≥2 platforms or clients), you MUST decompose into conflict-free vertical slices first (load the \`vertical-slice\` skill). A vertical slice is a thin end-to-end behavior cutting through all layers (types→logic→surface→test) for ONE outcome. Each file is owned by exactly ONE slice per wave. Shared types/interfaces needed by multiple slices are defined in the tracer-bullet slice (Wave 0), so parallel implementers never race on an undefined type. Single-slice waves on non-trivial work are a failure — look harder.

## Run ledger & Stop-gate (mechanical enforcement — not advisory)

\`vertical-slice\` writes the slice plan to the run ledger (\`.groundwork/runs/<session_id>.json\` for concurrent-safe per-session tracking; legacy \`.groundwork/run.json\` still works). A \`Stop\` hook reads this ledger on every attempt to end the session and BLOCKS the stop — re-injecting the fan-out rules — while any slice is not \`complete\` or while \`gate.advisor\` is not \`APPROVE\`. This is what makes the workflow stick; the rules above are not optional suggestions you can drop as context grows.

Your obligations as orchestrator (the hook only reads — it cannot update the ledger for you):
- **Banner first.** Your first line on a non-trivial task: \`GROUNDWORK ▸ ultrawork: <N> slices across <M> waves → .groundwork/runs/<session_id>.json\`. For trivial work: \`GROUNDWORK ▸ trivial: single general-purpose agent, no slicing\`.
- **Write the ledger** when you slice (vertical-slice does this), using this session's \`session_id\` from the Session identity block.
- **Give each slice \`acceptance\`** (a string[] of verifiable done-conditions) and \`blocked_by\` (the canonical wave-ordering dependency; \`depends_on\` is a legacy alias). A slice can't be \`complete\` until its \`blocked_by\` slices are.
- **Update slice status to \`complete\`** as each verified wave lands.
- **Commit each verified wave** before fanning out the next — uncommitted-wave accumulation is what made a subagent's \`git stash\` destructive (see memory entry \`uncommitted-wave-accumulation\`).
- **Record the advisor verdict** after the completion gate. Prefer the object form — \`gate.advisor = { "verdict": "APPROVE", "rubric": "...", "axes": { "correctness", "completeness", "over_engineering" }, "citation": "..." }\` — so the verdict carries its own rubric and evidence; the bare string \`"APPROVE"\` is still accepted. Every REVISE/REJECT needs a concrete \`citation\`.
- **To abandon a run**, set \`"active": false\` — the gate releases. Trivial tasks write no ledger, so the gate stays out of the way.

Load \`/groundwork:ultrawork\` for the full max-fan-out protocol.

## Fan-out targets (per wave)

Fire the entire wave in ONE message — never serialize tasks that don't share state.

| Agent | Tasks per wave |
|---|---|
| \`explore\` | 3–7 (one per area/module) |
| \`junior-orchestrator\` | 5–20 (DEFAULT — one per slice) |
| \`general-purpose\` | 5–20 (leaf carve-out ONLY: ALL of — single domain, ≤2 files, no internal sequencing, small verification surface; if ANY clause fails → junior-orchestrator) |
| \`designer\` | 2–5 |
| \`advisor\` | 1–2 (decision gates only) |

These are ceilings, not quotas. Do NOT invent or fragment slices to hit a number — the only valid slices are real, independently-testable behaviors with non-overlapping file ownership.

## One objective per task

If describing a task takes more than 2 sentences, split it. Every Task prompt must be self-contained: exact file paths, line ranges, constraints, and explicit SUCCESS criteria. Never rely on "as we discussed" — subagents have no session history.

## Pre-delegation declaration

Before a wave, state: **Agent** (which specialist) · **Reason** (why this one) · **Success criteria**. This surfaces bad routing before tokens are spent.

## Wave / task-graph template

Fire exploration and implementation waves together ONLY when the implementation does not consume exploration output; otherwise complete exploration first. Never start Wave N+1 until Wave N completes; within a wave maximize width.

\`\`\`
TASK GRAPH:
Wave 0 (tracer bullet — 1–2 tasks): [prove E2E path; define shared types]
Wave 1 (exploration — parallel): [one explore per area/module]
Wave 2 (implementation — parallel): [one junior-orchestrator/general-purpose/designer per slice]
Wave 3 (verification): [qa if interactive UI] → advisor (evidence+quality) APPROVE
\`\`\`

## Trivial escape hatch

Trivial = ≤2 files AND ≤1 user-facing behavior AND <1h AND the verification surface is small (no real hardware, single platform, single-service or no live environment, ≤5 QA scenarios) → skip slicing, delegate to one \`groundwork:general-purpose\`, then the gate. If any of ≥3 files, ≥2 user-facing behaviors, or a large verification surface applies, slicing is mandatory.

## Completion gate (mandatory)

[qa if interactive UI] → advisor (evidence+quality) APPROVE before declaring done. No APPROVE = not done. "It should work" is not evidence. Record the verdict as \`gate.advisor\` in \`.groundwork/run.json\` so the Stop-gate releases the session.`

// SDK-embedded agents (pencil, etc.) set CLAUDE_CODE_ENTRYPOINT=sdk-py|sdk-js.
// Injecting groundwork's orchestrator persona into them causes misbehaviour — suppress silently.
if (isEmbeddedAgent()) process.exit(0)

let input = {}
try {
  const raw = await readStdin()
  if (raw.trim()) input = JSON.parse(raw)
} catch {
  // Invalid JSON or stdin failure — proceed without session identity.
}

const sessionId = typeof input?.session_id === 'string' ? input.session_id : ''

// MAP.md — auto-regenerated per-motive human read path.
// Enumerate actual existing motive MAP files; fall back to generic wording when none exist yet.
const _cwdForMap =
  (typeof input?.cwd === 'string' && input.cwd) ||
  process.env.CLAUDE_PROJECT_DIR ||
  process.cwd()
function _findMotiveMaps(projectDir) {
  try {
    const motivesDir = path.join(projectDir, '.groundwork', 'motives')
    return readdirSync(motivesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(motivesDir, d.name, 'MAP.md'))
      .filter(p => existsSync(p))
  } catch { return [] }
}
const _motiveMaps = _findMotiveMaps(_cwdForMap)
const mapPointerBlock = (() => {
  const header = '\n\n## Motive MAP — human read path\n\nEach motive\'s MAP is at `.groundwork/motives/<slug>/MAP.md` — auto-regenerated; the intended entry point for humans reviewing progress. CLI tools are the implementation detail.'
  if (_motiveMaps.length === 0) return header
  const list = _motiveMaps.map(p => `- \`${p}\``).join('\n')
  return `${header}\n\nCurrent motive MAP(s):\n${list}`
})()

// Absolute CLI tool paths — injected so agents never rely on a cwd-relative bin/.
// Subcommand list covers the operational set (13) + scope-token + milestone-signoff (orchestrator-
// only token-gated commands; omitting them causes the orchestrator to assume they don't exist).
// `autopilot` is intentionally omitted here: activeRunBlock surfaces it dynamically with full
// usage only when the pacing budget is exhausted — listing it statically adds noise and it is
// never applicable outside that context.
const cliToolsBlock = `\n\n## Groundwork CLI tools (absolute paths — use these, not bin/)\n\nLedger (operational): \`${GW_HOOK_BIN} ledger <subcommand> --motive <slug>\` — valid subcommands: status, add, set, complete, rm, show, view, gate, abandon, fog, frontier, claim, await-human, scope-token, milestone-signoff · Journal: \`${JOURNAL_BIN}\`. Run \`${LEDGER_BIN} help\` for the full command reference. (\`gw ledger init\` does not exist — use \`${LEDGER_BIN} init\` to start a new run.)`

let additionalContext = reminder + mapPointerBlock + cliToolsBlock

// Best-effort: export session id to Claude Code's session-scoped env file so
// subsequent Bash subprocesses see CLAUDE_CODE_SESSION_ID even on hosts/versions
// where it isn't set automatically.
try {
  const envFile = process.env.CLAUDE_ENV_FILE
  if (envFile && sessionId) {
    const line = `CLAUDE_CODE_SESSION_ID=${sessionId}`
    let existing = ''
    try { existing = readFileSync(envFile, 'utf8') } catch { /* file may not exist yet */ }
    if (!existing.split('\n').some(l => l.trim() === line)) {
      appendFileSync(envFile, (existing && !existing.endsWith('\n') ? '\n' : '') + line + '\n')
    }
  }
} catch { /* never fail the hook */ }
const transcriptPath = typeof input?.transcript_path === 'string' ? input.transcript_path : ''
if (sessionId || transcriptPath) {
  const lines = ['', '## Session identity']
  if (sessionId) lines.push(`- session_id: ${sessionId}`)
  if (transcriptPath) lines.push(`- transcript_path: ${transcriptPath}`)
  lines.push('', "When performing a session pause (/groundwork:pause), reference these values so the successor session can locate this session's transcript.")
  additionalContext += `\n${lines.join('\n')}`
}

const projectDir =
  (typeof input?.cwd === 'string' && input.cwd) ||
  process.env.CLAUDE_PROJECT_DIR ||
  process.cwd()
try { ensureGroundworkExcluded(projectDir) } catch { /* never fail the hook */ }
additionalContext += activeRunBlock(projectDir, sessionId)
try {
  additionalContext += buildStruggleNudge(projectDir)
} catch { /* never fail the hook */ }

// AC6/AC7: spec skeleton with 700-token cap; dropped first if total >3800 tokens.
// Caps re-scaled from 3000/3300/600 to 3500/3800/700 (factor ×1.156) after the
// estimator changed from Math.ceil(chars/4) to Math.ceil(utf8Bytes/3.5).
// Re-scaled again (H22): ACTIVE RUN slice enumeration bounded at 10 slices;
// Measured payload (2026-09-04, H22 bounded at 10 slices): base=3306 + skeleton=174 = 3480 tokens → headroom 320.
const TOTAL_TOKEN_CAP = 3800
const TOTAL_TOKEN_ALARM = 4100
try {
  const skeleton = buildSpecSkeleton(projectDir)
  if (skeleton) {
    const baseTokens = estimateTokens(additionalContext)
    const skeletonTokens = estimateTokens(skeleton)
    if (baseTokens + skeletonTokens <= TOTAL_TOKEN_CAP) {
      additionalContext += skeleton
    } else {
      // AC7: drop skeleton before any other block; record a SESSION_START journal event
      try {
        if (sessionId) {
          emitHookEvent({
            projectDir,
            sessionId,
            type: 'SESSION_START',
            source: 'hook:session-reminder',
            msg: 'spec_skeleton_dropped',
            data: {
              event: 'spec_skeleton_dropped',
              reason: `injection cap (${TOTAL_TOKEN_CAP} tokens) would be exceeded`,
              base_tokens: baseTokens,
              skeleton_tokens: skeletonTokens,
            },
          })
        }
      } catch { /* best-effort */ }
    }
  }
} catch { /* never fail the hook */ }

// AC8: token alarm (informational — logged only)
try {
  const totalTokens = estimateTokens(additionalContext)
  if (totalTokens > TOTAL_TOKEN_ALARM && sessionId) {
    emitHookEvent({
      projectDir,
      sessionId,
      type: 'SESSION_START',
      source: 'hook:session-reminder',
      msg: 'injection_over_alarm',
      data: {
        event: 'injection_over_alarm',
        total_tokens: totalTokens,
        alarm_threshold: TOTAL_TOKEN_ALARM,
      },
    })
  }
} catch { /* best-effort */ }

console.log(JSON.stringify({
  continue: true,
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext,
  },
}))
