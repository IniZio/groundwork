---
name: goal
description: Manage persistent project goals that survive context compression and session restarts. Set objectives with acceptance criteria, check status, pause, resume, or clear. The active goal is injected into every message as a reminder.
---

# Goal

## Purpose

Persist an objective with acceptance criteria across sessions, context compression, and `/clear`. The goal reminder appears in every user message so the agent never loses track.

This is NOT session-scoped. The goal lives in `.opencode/goal.json` and persists until explicitly cleared or marked achieved.

## When to Use

- Starting a multi-wave implementation that needs focus tracking
- Running an end-to-end test of multiple flows
- Any task where losing the objective would cause rework
- When the user says "set a goal", "track this", "don't lose sight of"

## Workflow

### Set a Goal

```
set_goal(action: "set", objective: "<what to achieve>", acceptanceCriteria: ["<criterion 1>", "<criterion 2>", ...])
```

Requirements:
- `objective`: clear, specific description of what done looks like
- `acceptanceCriteria`: list of verifiable, testable criteria. Each must be independently confirmable

After setting, the goal reminder is injected into every subsequent user message automatically.

### Check Status

```
set_goal(action: "status")
```

Returns current goal, status, and acceptance criteria checklist.

### Pause / Resume

```
set_goal(action: "pause")   // temporarily stop reminders
set_goal(action: "resume")  // reactivate
```

Use when switching to an urgent interruption, then resume.

### Mark Achieved

```
set_goal(action: "achieved")
```

**Only after advisor-gate APPROVE confirms all acceptance criteria are met.** Do not self-certify.

### Clear

```
set_goal(action: "clear")
```

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
- The goal reminder survives context compression because it's injected via message transform, not stored in context

## Anti-Patterns

- Setting vague goals ("make it better") — use specific, testable criteria
- Setting a goal for every task — only for multi-step work where losing focus has consequences
- Marking achieved without running verification — the goal mechanism is only valuable if the criteria are honestly checked
- Clearing a goal to "start fresh" instead of marking it achieved with documented gaps — be honest about what wasn't done
