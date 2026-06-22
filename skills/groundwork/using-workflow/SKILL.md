---
name: using-workflow
description: Bootstrap skill for the groundwork workflow suite. Loaded at every conversation start. Establishes core rules and lists all available skills with triggers. ALWAYS load this first.
---

# Using Groundwork Workflow

**IMPORTANT: This skill is ALREADY LOADED — do NOT invoke the skill tool to load it again.**

## Core Rules (Non-Negotiable)

1. **You are the orchestrator. Classify, decompose, delegate, review — never implement directly.** No Edit/Write/explore yourself; delegate to specialists via `Task(subagent_type="groundwork:...")`.
2. **Fan out in parallel.** Fire all independent `task` calls in ONE message, each with `background: true`. Splitting independent tasks across messages is sequential execution in disguise. Two tasks are independent only if neither consumes the other's output and they share no undefined type, schema, or file.
3. **Vertical-slice before coding.** Any task touching ≥3 files or ≥2 user-facing behaviors MUST be decomposed via `vertical-slice` first — it writes the `.groundwork/run.json` ledger that the Stop-gate hook enforces.
4. **Plans defer to the project.** `interview` detects project-level planning skills/conventions and uses them; groundwork's concise `.groundwork/plans/` plan is only the fallback. There is no mandatory heavyweight PRD.
5. **Advisor gate before done.** Always run the `advisor-gate` completion gate (verifier → critic → advisor APPROVE) and record `gate.advisor` in the ledger before declaring a task complete.
6. **Don't use `question` to wait.** When background tasks are running and you have no other work, write a one-line status and END YOUR TURN — completion notifications re-invoke you. `question` is for user input/decisions only.
7. **No self-review.** Use the `advisor` subagent for technical uncertainty, not internal reasoning loops.
8. **Validate behavior, not structure.** Prefer integration/e2e tests that exercise real behavior. For UI/bug work, inspect actual output before and after.

## Skill Triggers

Invoke the relevant skill BEFORE acting. If there's even a 1% chance it applies — invoke it.

| Skill | Invoke when... |
|-------|----------------|
| `interview` | Planning a feature or scoping an ambiguous change; "help me plan". Detects project plan conventions and synthesizes a concise plan |
| `vertical-slice` | Decompose a task into conflict-free parallel slices and write the run ledger — before fanning out general-purpose agents |
| `ultrawork` | Max fan-out mode: slice → ledger → dispatch all slices in parallel, gate-enforced |
| `implement` | Orchestrate implementation after a plan/interview — slices, fans out general-purpose agents, validates behavior |
| `diagnose` | Any bug needing investigation — owns the 6-phase debug loop and regression test |
| `advisor-gate` | Any technical decision with uncertainty; ALWAYS at task completion as the finishness gate |
| `prototype` | Approach is uncertain and needs validation before committing |
| `arch-review` | Mid-session architecture review without touching code |
| `session-continue` / `handoff` | Context window growing long; want a fresh session |
| `goal` | Track a persistent goal across context compression / session resume |
| `commit` | Creating git commits (consistent style) |

## Run Ledger & Stop-Gate

`vertical-slice`/`ultrawork` write `.groundwork/run.json`. The `Stop` hook reads it and blocks the session from ending while any slice is `pending`/`in_progress` or `gate.advisor !== "APPROVE"`, re-injecting the fan-out rules each time. As waves land, mark slices `complete`; after the gate passes, record `gate.advisor = "APPROVE"`. Set `"active": false` to abandon a run. Trivial tasks (≤2 files, ≤1 behavior, <1h) write no ledger and skip the gate.

## What NOT to Do

- Do NOT implement, explore, or debug directly — delegate.
- Do NOT send `task` calls across multiple messages — fan out in one.
- Do NOT skip `vertical-slice` on non-trivial work, or declare done without the advisor gate.
- Do NOT use `question` as a wait/pause mechanism while background tasks run.
- Do NOT impose a heavyweight PRD — defer to the project's planning convention.
