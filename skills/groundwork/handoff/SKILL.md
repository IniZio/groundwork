---
name: handoff
description: Write a concise, user-readable continuation document for a later session, or compress context to keep going in this one. Never silently drop context.
disable-model-invocation: true
---

# Handoff

## Core Principle

**A clean baton pass, not a context dump.** Summarize the state; do not assume the next session can access this session's transcript.

**Hard rule: never silently drop context.** The artifact must be shown to (or be readable by) the user before the current session ends. If anything important cannot be captured, say so explicitly.

## Entry conditions — when to use this skill

Use `handoff` when:

- Context window is getting long (rough signal: >50 messages or >100k tokens)
- Agent is losing track of decisions made earlier in the session
- User says "start fresh", "new session", "continue in a new session", "write a handoff"
- Switching machines or terminals mid-task
- About to begin a large new phase of work (natural breakpoint)

Do **not** use `handoff` when:

- The user wants to **resume** a prior session's unfinished work — use `resume` instead (it reconstructs state from the run ledger and motive).
- The goal is to **author or update a motive charter** — use `motive` instead.

## Two modes

### Mode 1 — Compress and continue (stay in this session)

Good for: short remaining work, user wants continuity, context is dense but manageable.

1. Write a concise in-session summary covering: current goal, key decisions, current state (done / next), active files/paths, open questions.
2. Show the summary to the user, then continue.

Present the choice when context is long but the call is not obvious:

```
"Context is getting long. How would you like to continue?"

Options:
- "Compress and continue here" — summarise context and keep going in this session
- "Write a handoff file" — save a continuation artifact for a later session
```

### Mode 2 — File handoff (for a later session)

1. Tell the user that a continuation artifact will be created.
2. Write a Markdown file at `.groundwork/handoffs/<timestamp-or-session-id>.md` with these sections:

```markdown
# Continuation handoff

## Goal
What the overall task is.

## Current state
What is done, what is in flight.

## Decisions made
Each decision with a one-line rationale.

## Files
path:line references.

## Next steps
Ordered, concrete.

## Active run state
Brief status of the active plan or run ledger. Include the run goal, incomplete slices,
and gate verdict when known. If no run is active, say so.
```

**Rules:**
- Never include secrets, tokens, or credentials in the handoff file
- Summarize — do not dump transcript

## Active motive — projection, not a second source of truth

When a motive is active (`.groundwork/motives/<slug>/motive.md` exists and is the current work thread), **render the handoff from that motive** — use `journal compile` output as the primary source: Objective, open TBD/TBR items from the charter, recent Decision Log entries, and current run-ledger status (open slices, gate verdict).

- The motive charter and Decision Log are the source of truth; the handoff file is a **projection** for humans and later sessions, not a parallel state store.
- Still write the markdown artifact and show it to the user (delivery unchanged).

When **no** active motive exists, compile the handoff from plan/run-ledger/session context as described above.

## Delivery

Tell the user the exact artifact path and show its contents or a concise summary. The user decides when and how to provide it to a later session. This skill only writes documentation — it does not create or launch another session.

## What NOT to Do

- Do NOT dump raw conversation content into the handoff document — summarize it
- Do NOT include secrets, tokens, or credentials in the handoff file
- Do NOT abandon the old session before the handoff document has been shown to (or is readable by) the user
- Do NOT claim that a later session was created or verified
- Do NOT silently start fresh or drop context — if in doubt, compress and show the user
