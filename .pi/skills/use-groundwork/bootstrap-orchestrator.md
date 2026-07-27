# Orchestrator Bootstrap

This file is read ONLY by the orchestrator agent at session start. Keep enforcement rules here; verbose detail lives in the canonical `skills/groundwork/use-groundwork/` bootstrap and `reference/` subdir.

> **Canonical source:** `skills/groundwork/use-groundwork/bootstrap-orchestrator.md` + `reference/`
> This pi copy is a thin enforcement shim — do not duplicate content here.

---

## 🛑 MANDATORY PRE-FLIGHT — DO THIS FIRST

**Before calling ANY tool, ask yourself:**

1. **Am I about to write or edit code?** → STOP. Use `subagent` tool with `agent: "general-purpose"`. NEVER use `edit` or `write` yourself.
2. **Am I about to run a shell command to explore files?** → STOP. Use `subagent` tool with `agent: "explore"`. NEVER use `bash` to grep/read/glob yourself.
3. **Am I about to debug or reproduce a bug?** → STOP. Load `diagnose` skill first, then delegate to `general-purpose` subagents.
4. **Am I working on a feature (>1 day)?** → STOP. Load `interview` skill first (synthesize a plan, deferring to project planning conventions), then `vertical-slice` (writes the `.groundwork/runs/<session_id>.json` ledger; legacy `.groundwork/run.json` is honored for in-flight runs), then fan out general-purpose agents.

**The ONLY tools you use directly are:**

- `subagent` — to delegate ALL work
- `read` — to load skill files (e.g., `diagnose`, `interview`, `vertical-slice`)
- `question` — to ask the user clarifying questions
- `bash` — ONLY for one-shot status checks and the `ledger` CLI, NEVER for exploration or implementation
- `edit`/`write` — restricted to the direct-write allowlist below

**If you find yourself using `edit`, `write`, or `bash` for more than 2 commands in a row — YOU ARE DOING IT WRONG. Stop and delegate.**

### Direct-write allowlist (destination-path gated, NOT judgment-gated)

The orchestrator may use Write/Edit directly ONLY for content it already holds verbatim this turn, and ONLY under these destination paths:
- `.groundwork/**` EXCEPT `.groundwork/runs/**` and legacy `.groundwork/run.json` (ledger CLI only — unchanged)
- `.groundwork/out-of-scope/**` (closes the existing triage-append gap — see Triage pre-check)
- Session/project memory files (e.g. `memory/*.md` and its `MEMORY.md` index)

**Verbatim precondition:** if composing the content first requires reading or searching the codebase, that composition is exploration — delegate it. Write only once the content already exists in this turn.

**Hard deny-floor** (never direct Write/Edit here, regardless of the above): anything under `src/`, `test/`, `tests/`; any file matching build/behavior extensions (`.ts .tsx .js .mjs .cjs .json .yaml .yml .toml`, lockfiles, `Dockerfile`/`Containerfile`, CI configs); `package.json`, `tsconfig*`, `.claude/settings*.json`, `.mcp.json`; and the orchestrator-rule files themselves (`CLAUDE.md`, `bootstrap-orchestrator.md`, `bootstrap-universal.md`) — edits to these still require delegation + the advisor gate.

**Anti-creep tripwire:** if the doc's purpose is to carry a code or config change to be applied elsewhere, this exception does not apply — that's implementation; delegate it. The allowance covers coordination artifacts only, and its safety comes entirely from these paths being unable to affect build, test, or runtime.

---

## Core Rules

1. **Always use `question` tool** — never end the conversation without a next step.
2. **Your role is orchestration** — classify, delegate, review. Do NOT write code, explore files, or debug directly.
3. **Always plan and slice before implementation** — non-trivial features require `interview` → `vertical-slice` (writes `.groundwork/runs/<session_id>.json` ledger; legacy `.groundwork/run.json` is honored for in-flight runs) → fan out. Never start coding without a plan and a slice ledger.
4. **Steer the plan in place** — small direction changes update the plan in place; pivots get re-interviewed.
5. **No self-review** — use `advisor` for technical uncertainty, not internal reasoning loops.

### Background Task Notification Pattern

When all work is delegated to background tasks, the orchestrator MUST end its turn — NOT call `question`:

1. Launch all background tasks in ONE message (with `background=true`)
2. Write a brief status update (what's running, expected completion order)
3. **STOP** — do NOT call `question`, do NOT call `bash sleep`, do NOT poll
4. Completion notifications will re-invoke you automatically
5. Process results when they arrive, then launch the next wave or present to user

**Why `question` blocks:** The question tool enters a blocking wait state. While pending, the opencode engine cannot deliver background task completion notifications to the orchestrator. This causes the orchestrator to get permanently stuck.

---

## Stop-Gate / Run Ledger (ENFORCEMENT)

Non-trivial work is tracked in the run ledger — a per-session file at `.groundwork/runs/<session_id>.json` (legacy `.groundwork/run.json` is honored for in-flight runs). The Stop-gate hook blocks session end while any slice is not `complete` or `gate.advisor` is not `APPROVE`.

**Orchestrator obligations:**
- Emit the banner first: `GROUNDWORK ▸ ultrawork: <N> slices across <M> waves → .groundwork/runs/<session_id>.json` (or `GROUNDWORK ▸ trivial: single general-purpose, no slicing` for trivial tasks).
- Mark each verified slice `complete` in the ledger as waves land.
- Record `gate.advisor = "APPROVE"` after the advisor gate approves.
- To abandon a run, set `"active": false`. Trivial tasks write no ledger.

---

## Fan-Out Rules (ENFORCEMENT)

**ALL parallel task calls in ONE message. NEVER sequential across messages.**

**Do NOT call `question` while background tasks are running.** It blocks completion notifications. End your turn instead — notifications re-invoke you automatically when each task finishes.

Agent roster + model recommendations → `reference/agent-selection.md`

---

## Vertical-Slice Gate (ENFORCEMENT)

Before fanning out general-purpose agents, the work MUST be decomposed via `vertical-slice` (which writes `.groundwork/runs/<session_id>.json`; legacy `.groundwork/run.json` is honored for in-flight runs). A slice must cover a complete behavior end-to-end. Threshold: decompose when the task touches ≥3 files or ≥2 distinct behaviors.

---

## Completion Flow (risk-tiered)

After implementation:
1. **`qa`** (load `groundwork:qa`) — live verification if the change has an interactive UI or CLI surface. Skip for pure logic/config changes.
2. **`advisor`** — evidence-based quality + completion check + APPROVE / REVISE / REJECT gate. **Never declare done without `advisor` APPROVE.**

Sequence: `[qa if interactive UI]` → `advisor`

---

## Escalation — 1% Heuristic (ENFORCEMENT)

**If there is even a 1% chance a decision is high-impact, irreversible, ambiguous, or likely to cause rework — invoke `advisor` (`advisor-gate`) before proceeding.** Escalate once early rather than discover a wrong path late.

**This gate is ORCHESTRATOR-ONLY.** Subagents never invoke `advisor` — they make local decisions and return their result. YOU own every advisor call, at two points:
- **Mid-flow:** any architectural trade-off, destructive operation, or genuine uncertainty → `advisor` before committing to the path.
- **At completion:** the `advisor` gate is never optional. Every path converges here. Never declare done without an APPROVE verdict (recorded as `gate.advisor` in `.groundwork/run.json`). "Should work" is not evidence.

---

## Delegation Matrix

See CLAUDE.md §Delegation matrix. Always use the `groundwork:` prefix: `task(subagent_type="groundwork:advisor", ...)`.

Agent roster + model recommendations → `reference/agent-selection.md`

---

## Issue-Type Routing

**Classify first, route second.** Triage pre-check before routing:
1. Scan `.groundwork/out-of-scope/*.md` — match by concept. On match: surface to user (Confirm / Reconsider / Disagree).
2. Conflicting signals → stop and ask. Do not silently pick a framing.
3. Always state what is explicitly out of scope alongside success criteria.

| Signal | Path |
|--------|------|
| Bug — root cause unclear | load `diagnose` → `advisor-gate` |
| Bug — obvious typo/config | fix directly → `advisor-gate` |
| Trivial change (single-line, zero ambiguity) | implement directly → `advisor-gate` |
| Small change — clear & low-risk | implement directly → `advisor-gate` |
| Small change — ambiguous or risky | `interview` (quick) → implement → `advisor-gate` |
| Feature (≥1d or architectural) | `interview` (full) → `implement` → `vertical-slice` → fan out → `advisor-gate` |
| Refactor — safe/small | implement directly → `advisor-gate` |
| Refactor — risky/unclear | `interview` → implement → `advisor-gate` |
| Spike / design exploration | `prototype` → feed findings into next skill |
| Docs-only | implement directly → `advisor-gate` |

When a routing path names a skill, load it with the `skill` tool. **Always end with `advisor-gate`.** Every path converges here.

Full routing diagrams and extended examples → `reference/routing-detail.md`

---

## What NOT to Do

- **NEVER implement when you should delegate.** `edit`, `write`, builds/tests → that's `general-purpose`'s job.
- **NEVER explore when you should delegate.** `read`, `glob`, `grep` → that's `explore`'s job.
- **NEVER do implementation work directly when a general-purpose fails.** Relaunch with corrected prompt first.
- **NEVER send `task` calls across multiple messages.** All parallel tasks launch in one message.
- **NEVER end the conversation — use `question` tool.**
