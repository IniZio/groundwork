---
name: prototype
description: Build throwaway prototypes to answer a design question, then delete or absorb them. Two branches: LOGIC (interactive TUI) or UI (variant switcher). Never promote to production.
disable-model-invocation: true
---

# Prototype

## Core Principle

**Throwaway from day one.** Prototypes answer a specific design question, then get deleted or absorbed. They are never promoted to production directly.

## When to Use

- "Does this logic / state model feel right?" → **Logic prototype**
- "What should this look like?" → **UI prototype**
- Exploring a design space before committing to implementation
- Spike: technical investigation with uncertain outcome
- User asks to "try something out", "prototype this", "spike on"

## Pick a Branch

| Question | Branch | Artifact |
|---|---|---|
| "Does this logic / state model feel right?" | LOGIC | Interactive terminal app exercising state through cases |
| "What should this look like?" | UI | Several UI variations on a single route, switchable via URL param |

If ambiguous, default based on code context (backend → LOGIC, UI component → UI).

## Both Branches

1. **Clearly marked as prototype** — named so any reader sees it's throwaway. Located near where it'll be used.
2. **One command to run** — whatever the project's existing task runner supports.
3. **No persistence by default** — state in memory. If question involves DB, use scratch DB with clear "WIPE ME" marker.
4. **Skip the polish** — no tests, no error handling beyond runnability, no abstractions.
5. **Surface the state** — print/render full relevant state after every action or variant switch.
6. **Delete or absorb when done** — never leave prototype code rotting.

See [`reference/logic-prototype.md`](reference/logic-prototype.md) for the LOGIC branch step-by-step process and anti-patterns.
See [`reference/ui-prototype.md`](reference/ui-prototype.md) for the UI branch step-by-step process and anti-patterns.

## Failure Modes

**The prototype that quietly becomes production.** The prototype was "good enough" to ship. Untested, unpolished code runs in production and accumulates debt with each change. Correction: always rewrite when absorbing. Prototype code is a sketch, not a commit.

**Scope creep kills the question.** The design question is too broad and the prototype runs past an hour. You are building a feature, not answering a question. Correction: bound the question before building. If it cannot be answered in ≤1 hour of prototyping, split the question first.

**Blurred logic and TUI** (LOGIC branch). Business rules end up inside the TUI loop rather than the isolated module. When the TUI is deleted, the logic goes with it. Correction: isolate logic behind a pure interface first; the TUI only dispatches and renders.

## Completion

Observable state: the design question has a written answer (what was learned, which approach won and why); prototype code is deleted or the portable logic module is absorbed into the codebase; if the finding changes planned direction, the advisor gate has been invoked.
