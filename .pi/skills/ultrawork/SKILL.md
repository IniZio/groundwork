---
name: ultrawork
description: Maximum parallel fan-out mode. Slice, write ledger, dispatch all independent slices simultaneously. Triggers on "ultrawork", "ulw", "max fan-out", "go parallel".
---

# Ultrawork — Maximum Fan-Out

## When to Use

**Triggers:** user says "ultrawork", "ulw", "max fan-out", "go parallel", or the task has ≥5 independent slices and maximum speed is desired.

**Chain position:** The feature-planning pipeline (`interview` → `planner`) MUST have produced a planning artifact (`motive_ref`) before this skill runs on non-trivial work. `interview` is the human front door; `planner` is the delegated stage that emits the motive charter. They are BOTH required steps in sequence, not competing alternatives. `vertical-slice` (step 1 below) produces the slice table and ledger. Optionally run `plan-review` to validate coverage before dispatching. After all waves complete, the orchestrator invokes `advisor-gate` — ultrawork does not gate itself.

**Do NOT use for:**
- Trivial tasks (≤2 files AND ≤1 behavior AND <1h AND small verification surface) — delegate directly to `general-purpose`, then `advisor-gate`.
- Bugs — use `diagnose` instead.

## Platform contract

The workflow is platform-neutral, but enforcement is not. Claude Code and
OpenCode may provide native delegation and hook surfaces; use those only when
the host documents them. In Codex, this skill is guidance: use native Codex
subagent/delegation tools only when they are actually available in the current
session. Otherwise execute slices sequentially and say that fan-out, ledger
tracking, and completion gating are advisory.

You are now in **Ultrawork Mode**. Where the host supplies a Stop-gate hook,
it may enforce the run ledger. Codex has no such guarantee from a skill alone;
do not claim that ending the session is mechanically blocked.

## Emit the banner FIRST (compliance tripwire)

Your **first line of output** after engaging ultrawork MUST be the banner defined in CLAUDE.md §Run ledger & Stop-gate (on Claude Code hosts it is also injected at SessionStart by `hooks/session-reminder.mjs`). This skill defers to those sources rather than restating the format.

## The Prime Directive

**Fire all independent agent calls simultaneously. NEVER serialize independent work.**

Two tasks are independent ONLY if neither consumes the other's output AND they share no undefined type, schema, or file — when unsure whether two slices are independent, ask: does slice B import a symbol or file that slice A creates, or must B observe A's runtime behavior, or do both slices edit the same pre-existing file? If none is clearly yes, treat them as independent. Add a blocked_by edge only when you can name the specific artifact consumed.

## Execution Policy

1. **Decompose first.** Load `vertical-slice` and cut the work into the maximum number of conflict-free slices. Each slice = ONE user-facing behavior through all layers.
2. **Write the ledger.** `vertical-slice` writes the run ledger with every slice `pending`. No ledger = no enforcement.
3. **One objective per task.** If describing a task takes more than 2 sentences, split it.
4. **ALL parallel Task calls in ONE message.** Task A in one message, Task B in the next is sequential execution.
5. **Route to the right specialist.** See CLAUDE.md §Delegation matrix. Dispatch `junior-orchestrator` by **default** to own a domain end-to-end. Drop to `general-purpose` (leaf implementer, cannot spawn further workers) ONLY when ALL of the following hold: single domain with no sub-domains, ≤2 files, no internal sequencing, small verification surface. If ANY clause fails → `junior-orchestrator`.
6. **Context-isolate by behavioral contract.** Describe each task by the interfaces/signatures it must satisfy and observable acceptance criteria — not pinned line numbers (they rot when siblings edit the file).
7. **Fan-out.** When a wave is dispatched and you have no other work, write a one-line status and END YOUR TURN (you're re-invoked on each task completion).

Fan-out ceilings, wave template, and completion-gate rules are in your agent definition's Fan-out Protocol section (self-contained, platform-independent).

**Worktree conflict-fallback:** When slices would otherwise be serialized due to overlapping file ownership, you MAY preserve parallel width by isolating each slice in its own git worktree and reconciling serially after the wave lands. This is a fallback — default remains disjoint ownership. The full mechanism is documented in the `vertical-slice` skill.

## Pre-Delegation Declaration (mandatory)

Before each wave, state for each task: **Agent** · **Reason** · **Success criteria**.

## As Slices Land

Mark slices complete through the ledger CLI. On Claude Code hosts the exact commands are defined in CLAUDE.md §Run ledger & Stop-gate and injected at SessionStart; this skill defers to those sources. On other hosts (Codex, pi) where the injection is absent, track slice state in the plan or handoff artifact and report ledger operations as advisory — never invent plugin-root paths or claim hook enforcement.

## Anti-Patterns — These Are Failures

```
# BAD: Sequential — costs Nx wall time
Task(general-purpose, "slice 1") → wait → Task(general-purpose, "slice 2") → ...

# BAD: Orchestrator implementing directly
Edit(file, ...)   ← YOU ARE THE ORCHESTRATOR, NOT THE CODER

# BAD: Mega-task
Task(general-purpose, "rate limiting + audit logging + tests + UI")  ← 4 tasks in 1

# BAD: Vague context
Task(general-purpose, "implement as we discussed")  ← subagent has no session history

# BAD: No ledger
Fan out without writing the run ledger  ← the gate has nothing to enforce
```
