---
name: handoff
description: Write a concise, user-readable continuation document for a later Codex session.
disable-model-invocation: true
---

# Handoff

## Core Principle

**A clean baton pass, not a context dump.** Write a short, structured artifact that the user can inspect, save, and provide to a later session. Summarize the state; do not assume the next session can access this session's transcript.

**Hard rule: never silently drop context.** The artifact must be shown to (or be readable by) the user before the current session ends. If anything important cannot be captured, say so explicitly.

## When to Use

- Context window getting full and the task is not done
- Switching machines or terminals mid-task
- Ending a work block and wanting a clean baton pass for the next session

## Write the continuation artifact

Write a Markdown file in a user-visible project location, such as `.groundwork/handoffs/<timestamp-or-session-id>.md`, with these sections:

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
Brief status of the active plan or run ledger. Include the run goal, incomplete slices, and gate verdict when known. If no run is active, say so.
```

**Rules:**
- Never include secrets or credentials in the handoff file
- Summarize, don't dump transcript

## Active feature — projection, not a second source of truth

When exactly one feature ledger is active (`active: true` under
`.groundwork/features/<slug>/.feature.yaml`), **render the handoff from that
feature** — primarily `.feature.yaml` + `spec.md` (goal, unmet ACs, negative
scope, `resume.*` program counter, open slices, last `runs[]` row, recent
`history`/`decisions`). Optionally fold in current session run-ledger status.

- The feature ledger is the source of truth; the handoff file is a **projection**
  for humans and later sessions, not a parallel state store.
- Still write the markdown artifact and show it to the user (delivery unchanged).
- Also append a feature `history` entry with `type: handoff` and record the
  handoff path under `links.handoffs` when practical.

When **no** active feature exists, handoff behavior is unchanged: summarize the
session from plan/run-ledger/context as above.

## Delivery

Tell the user the exact artifact path and show its contents or a concise summary. The user decides when and how to provide it to a later session. This skill only writes documentation; it does not create or launch another session.

## What NOT to Do

- Do NOT dump raw conversation content into the handoff document — summarize it
- Do NOT include secrets, tokens, or credentials in the handoff file
- Do NOT abandon the old session before the handoff document has been shown to (or is readable by) the user
- Do NOT claim that a later session was created or verified
