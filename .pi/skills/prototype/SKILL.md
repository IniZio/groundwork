---
name: prototype
description: Build throwaway prototypes to flesh out a design before committing. Logic prototypes (interactive TUI) or UI prototypes (variant switcher). Delete when done. Use for spikes and design exploration.
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

## Universal Rules (both branches)

1. **Clearly marked as prototype** — named so any reader sees it's throwaway. Located near where it'll be used.
2. **One command to run** — whatever the project's existing task runner supports.
3. **No persistence by default** — state in memory. If question involves DB, use scratch DB with clear "WIPE ME" marker.
4. **Skip the polish** — no tests, no error handling beyond runnability, no abstractions.
5. **Surface the state** — print/render full relevant state after every action or variant switch.
6. **Delete or absorb when done** — never leave prototype code rotting.

## LOGIC Branch

When exploring state machines, algorithms, business rules, or data flow:

1. **State the question** — one paragraph about what you're trying to learn.
2. **Isolate logic** in a portable module behind a pure interface (reducer, state machine, pure function set). The TUI is throwaway; the logic module isn't.
3. **Build lightweight TUI** — clear screen each frame, current state pretty-printed, keyboard shortcuts listed. Read one keystroke, dispatch, re-render, loop.
4. **Walk through cases** — exercise the state model through normal paths, edge cases, and error states.

**Anti-patterns:** no tests, no real DB, no generalization, no blurring logic and TUI.

## UI Branch

When exploring visual design, layout, or interaction patterns:

1. **Default to 3 variants** — structurally different layouts, NOT just color changes. Cap at 5.
2. **Wire with `?variant=A|B|C`** — switcher component on existing page. Existing data fetching stays.
3. **Float a variant bar** — left/right arrows cycling variants, hidden in production.
4. **Capture the answer** — delete losers, fold winner into codebase properly (rewrite, don't promote prototype directly).

**Anti-patterns:** variants differing only in color, sharing too much code between variants, wiring to real mutations, promoting prototype directly.

## Completion

After the design question is answered:

1. **Document the finding** — what did you learn? Which approach won and why?
2. **Delete prototype code** — or absorb the portable logic module if it's reusable.
3. **Proceed to next skill** — based on finding: `create-prd`, `bdd-implement`, or report results.
4. **Advisor gate** — invoke if the finding changes planned direction.

## What NOT to Do

- Do NOT promote prototype code directly to production — always rewrite
- Do NOT add tests, error handling, or polish to prototypes
- Do NOT leave prototype code in the codebase after the spike is done
- Do NOT use real databases or external services — mock everything
- Do NOT spend more than 1 hour on a prototype — if it's taking longer, the question is too broad
