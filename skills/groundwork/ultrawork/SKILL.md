---
name: ultrawork
description: Engage maximum parallel fan-out mode. Decompose into conflict-free vertical slices, write the .groundwork/run.json ledger, and dispatch every independent slice simultaneously to specialist subagents. The Stop-gate hook holds the session open until every slice is complete and the advisor gate approves. Triggers on "ultrawork", "ulw", "max fan-out", "go parallel", "fan out hard".
---

# Ultrawork — Maximum Fan-Out, Mechanically Enforced

You are now in **Ultrawork Mode**. This is not just advice you can drop when the
context gets long — it is backed by the Stop-gate hook, which refuses to end the
session while the run ledger shows incomplete work.

## Emit the banner FIRST (compliance tripwire)

Your **first line of output** after engaging ultrawork MUST be one of:

```
GROUNDWORK ▸ ultrawork: <N> slices across <M> waves → .groundwork/run.json
```
or, for a task that is genuinely trivial (≤2 files AND ≤1 user-facing behavior AND <1h):
```
GROUNDWORK ▸ trivial: single general-purpose, no slicing
```

The banner is an observable signal that the workflow is actually engaged. If you find
yourself implementing without having emitted it, you have dropped the mode — stop and
re-engage.

## The Prime Directive

**Fire all independent agent calls simultaneously. NEVER serialize independent work.**

Sequential execution is the #1 velocity killer. If two tasks don't share state, they run
in parallel — always. Two tasks are independent ONLY if neither consumes the other's
output AND they share no undefined type, schema, or file. When unsure, serialize the
dependency into Wave 0.

## Execution Policy

1. **Decompose before dispatching.** Load `vertical-slice` and cut the work into the
   maximum number of conflict-free slices. Each slice is a thin end-to-end tracer through
   all layers (types → logic → surface → test) for ONE user-facing behavior.
2. **Write the ledger.** `vertical-slice` writes `.groundwork/run.json` with every slice
   `pending`. This is what the Stop-gate hook enforces — no ledger means no enforcement.
3. **One objective per task.** If describing a task takes more than 2 sentences, split it.
4. **ALL parallel Task calls in ONE message.** Task A in one message, Task B in the next is
   sequential execution in disguise.
5. **Route to the right specialist.** `general-purpose` for implementation, `explore` for discovery,
   `designer` for UI, `general-purpose` for root-cause, `advisor`/`critic` for gates.
6. **Context-isolate every task — durably.** Each prompt is self-contained (subagents have no
   session history), but describe the work by **behavioral contract, not pinned line numbers**:
   the files the slice owns, the interfaces/signatures it must satisfy, and observable
   acceptance criteria. Line ranges rot the instant a sibling slice edits the file — a contract
   ("export `parseConfig(src): Config`; invalid input throws `ConfigError`") survives. The
   ledger's `files[]` still lists ownership for conflict detection; that is structural, not the
   brief.
7. **Background fan-out.** Every fan-out `task()` call passes `background: true`. When a
   wave is dispatched and you have no other work, write a one-line status and END YOUR
   TURN — completion notifications re-invoke you. Never use `question` to wait.

## Wave / Task-Graph Template

```
TASK GRAPH:
Wave 0 (tracer bullet — 1–2 tasks): prove the E2E path; define shared types
Wave 1 (exploration — parallel):    one explore per area/module (only if needed)
Wave 2 (implementation — parallel): one general-purpose/designer per slice
Wave 3 (verification):              [qa if interactive UI] → critic (evidence+quality) → advisor APPROVE
```

Fire Wave 0, assess, then fire the next wave wide. Never start Wave N+1 until Wave N
completes; within a wave, maximize width.

## Fan-Out Targets (ceilings, not quotas)

| Agent | Tasks per wave |
|---|---|
| `explore` | 3–7 (one per area/module) |
| `general-purpose` | 5–20 (one per semantic slice) |
| `designer` | 2–5 |
| `test-engineer` | 2–5 |
| `advisor` / `critic` | 1–2 (decision gates only) |

Never invent or fragment slices to hit a number. A valid slice is a real,
independently-testable behavior with non-overlapping file ownership. **Single-slice waves
on non-trivial work are a failure — decompose harder.**

## Pre-Delegation Declaration (mandatory)

Before each wave, state for each task: **Agent** (which specialist) · **Reason** (why this
one) · **Success criteria** (how you'll know it worked). This surfaces bad routing before
tokens are spent.

## As Slices Land

Update `.groundwork/run.json` as you go — set each verified slice's `status` to `complete`.
The Stop-gate hook reads this file on every stop attempt and will block the session (and
re-inject these rules) until every slice is `complete` and `gate.advisor === "APPROVE"`.

## Anti-Patterns — These Are Failures

```
# BAD: Sequential — costs Nx wall time
Task(general-purpose, "slice 1") → wait → Task(general-purpose, "slice 2") → wait → ...

# BAD: Orchestrator implementing directly
Edit(file, ...)   ← YOU ARE THE ORCHESTRATOR, NOT THE CODER

# BAD: Mega-task
Task(general-purpose, "implement rate limiting + audit logging + tests + UI")  ← 4 tasks in 1

# BAD: Vague context
Task(general-purpose, "implement as we discussed")  ← subagent has no session history

# BAD: Under-sliced wave
Task(general-purpose, "do the whole feature")  ← you haven't sliced hard enough

# BAD: No ledger
Fan out general-purpose agents without writing .groundwork/run.json  ← the gate has nothing to enforce
```

## Completion Gate

When all slices are `complete` (non-trivial work only — trivial single-slice work skips the staged review):
1. `groundwork:qa` — if the change involves interactive UI or live behavior that must be exercised in a running env
2. `groundwork:critic` — fresh evidence only (rejects "should", "probably", "seems to"), PLUS code-quality review if code changed
3. `groundwork:advisor` — APPROVE / REVISE / REJECT, recorded as `gate.advisor` in the ledger

No APPROVE = not done. "It should work" is not evidence. The Stop gate enforces this.
