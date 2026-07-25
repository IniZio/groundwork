---
name: goal
description: Manage persistent project goals that survive context compression and session restarts. Set objectives with acceptance criteria, check status, pause, resume, or clear. The active goal is injected into every message as a reminder.
disable-model-invocation: true
---

# Goal

## Platform contract

Goal persistence and automatic reminders are host-specific. OpenCode may expose
its goal tool and message transform; Codex skills alone do not register a
`set_goal` tool or inject text into every user message. In Codex, keep the goal
in the available plan or handoff artifact and repeat only a short status when
it is relevant. Do not claim automatic persistence or per-turn injection.

## Purpose

Persist an objective with acceptance criteria across sessions, context compression, and `/clear`. The goal reminder appears in every user message so the agent never loses track.

On hosts with a goal runtime, the goal may persist beyond a session. Otherwise
this is a workflow convention and should be recorded in the host's plan or a
handoff artifact.

## Feature ledger

When exactly one feature is `active: true` under `.groundwork/features/`,
`goal` **MAY** mirror that feature's goal and acceptance criteria from
`spec.md` / `.feature.yaml`. Session-goal behavior above still applies.

**On conflict, the feature ledger wins** — do not let a divergent session goal
override feature ACs or negative scope. Clear or realign the session goal to
match the feature rather than forking two objectives.

## When to Use

- Starting a multi-wave implementation that needs focus tracking
- Running an end-to-end test of multiple flows
- Any task where losing the objective would cause rework
- When the user says "set a goal", "track this", "don't lose sight of"

## Workflow

### Set a Goal

Use the host's documented goal interface, if one exists; otherwise write the
objective and acceptance criteria into the current plan or handoff artifact.

Requirements:
- `objective`: clear, specific description of what done looks like
- `acceptanceCriteria`: list of verifiable, testable criteria. Each must be independently confirmable

Do not assume automatic reminders. Keep any reminder short and emit it only
when the goal materially affects the current turn.

### Check Status

Check status through the host's documented goal interface, or inspect the
current plan/handoff artifact.

Returns current goal, status, and acceptance criteria checklist.

### Pause / Resume

Pause or resume reminders through the host's documented interface. In Codex,
simply omit the optional short reminder until it is relevant again.

Use when switching to an urgent interruption, then resume.

### Mark Achieved

Mark the goal achieved in the host's documented goal interface or plan artifact.

**Only after advisor-gate APPROVE confirms all acceptance criteria are met.** Do not self-certify.

### Clear

Clear it through the host's documented interface, or remove it from the plan or
handoff artifact when the host treats those as the source of truth.

Removes the goal file entirely. Use after achieving or when abandoning.

## Advisor Gate Integration

When an active goal exists, the completion gate must include:

```
Active goal: <objective>
Acceptance criteria status:
1. <criterion> — <MET/UNMET>
2. <criterion> — <MET/UNMET>
```

The advisor must check each criterion. If any is UNMET, the response is GAPS (not APPROVE).

## Rules

- Only one active goal at a time
- Goal file is never committed to git (lives in `.opencode/`)
- Acceptance criteria must be verifiable — no subjective terms
- Do NOT set a goal for trivial tasks (<1h) — it's overhead
- Do NOT mark achieved without advisor-gate confirmation
- On Codex, a skill cannot guarantee survival across context compression; preserve
  the goal in the plan or handoff artifact and re-read it only when needed.

## Anti-Patterns

- Setting vague goals ("make it better") — use specific, testable criteria
- Setting a goal for every task — only for multi-step work where losing focus has consequences
- Marking achieved without running verification — the goal mechanism is only valuable if the criteria are honestly checked
- Clearing a goal to "start fresh" instead of marking it achieved with documented gaps — be honest about what wasn't done
