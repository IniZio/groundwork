---
name: ultrawork
description: Execute maximum parallel fan-out mode — slice, write ledger, dispatch all independent slices simultaneously. Triggers on "ultrawork", "ulw", "max fan-out", "go parallel".
---

# Ultrawork — Maximum Fan-Out

## Triggers

User says "ultrawork", "ulw", "max fan-out", "go parallel", or the task has ≥5 independent slices and maximum speed is desired.

**Do not use for:**
- Trivial tasks (≤2 files, ≤1 behavior, <1h, small verification surface) — delegate directly to `general-purpose`, then `advisor-gate`.
- Bugs — use `diagnose` instead.

**Chain position:** `feature-interview` → `planner` → this skill → `advisor-gate`. `vertical-slice` (step 1 below) writes the ledger and slice table. Run `plan-review` optionally to validate coverage before dispatching. Ultrawork does not gate itself.

## Banner First

**Failure: omitting the banner on first output** → the run ledger's compliance tripwire fires and marks the session out-of-spec.

Emit the banner as your first line of output. Its format is defined in CLAUDE.md §Run ledger & Stop-gate and injected at SessionStart by `hooks/session-reminder.mjs`; this skill defers to those sources.

## Prime Directive

**Fire all independent agent calls simultaneously. Serializing independent work is a failure.**

Two slices are independent only if neither imports a symbol the other creates AND they share no pre-existing file. When unsure, add a `blocked_by` edge rather than guessing independent.

## Execution Policy

1. **Decompose.** Load `vertical-slice`; cut to the maximum number of conflict-free slices. Each slice = one user-facing behavior through all layers.
2. **Write the ledger.** `vertical-slice` writes every slice `pending`. No ledger = no enforcement.
3. **One objective per task.** If a task description exceeds two sentences, split it.
4. **All parallel calls in one message.** Dispatching Task A then Task B in separate messages is sequential execution.
5. **Route correctly.** Default to `junior-orchestrator`. Drop to `general-purpose` (leaf, cannot spawn workers) only when ALL hold: single domain, ≤2 files, no internal sequencing, small verification surface.
6. **Context-isolate by behavioral contract.** Describe each task by interfaces and observable acceptance criteria — not pinned line numbers (they rot when siblings edit the file).
7. **End your turn.** After dispatching a wave with no remaining work, write a one-line status and stop. You are re-invoked on each task completion.

**Worktree conflict-fallback:** When slices share file ownership, isolate each in its own git worktree and reconcile serially after the wave. Full mechanism: `vertical-slice` skill.

## Pre-Delegation Declaration

Before each wave, state per task: **Agent · Reason · Success criteria**.

## Tracking Slices

Mark slices complete through the ledger CLI. On Claude Code hosts, commands are defined in CLAUDE.md §Run ledger & Stop-gate and injected at SessionStart; this skill defers to those sources. On other hosts, track slice state in the plan artifact and report ledger operations as advisory.

Platform-specific enforcement differences: [`reference/platform-contract.md`](reference/platform-contract.md).

## Named Failures

**Sequential dispatch** — fan-out across separate messages costs Nx wall time. All independent slices go in one message.

**Orchestrator implements** — calling Edit or Write means you are not orchestrating. Delegate.

**Mega-task** — a task combining rate-limiting + audit-logging + tests + UI is four tasks. Split before dispatching.

**Vague context** — "implement as we discussed" gives a subagent with no session history nothing to act on. Brief each task self-containedly.

**No ledger** — fan-out without writing the run ledger leaves the gate nothing to enforce.

**`question` as wait** — asking the user a non-blocking question mid-wave to defer ending your turn is sequential in disguise. End your turn.
