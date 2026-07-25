---
name: goal
description: Track a multi-step objective and acceptance criteria without automatic per-turn injection.
disable-model-invocation: false
---

# Goal (Codex)

Use this skill only when a multi-step task benefits from a persistent objective.
Keep the objective and acceptance criteria in the available plan or a
user-visible handoff artifact. Codex skills do not automatically inject goal
text into later turns.

## Workflow

1. Record one clear objective and independently verifiable acceptance criteria.
2. Re-read or restate them after context compaction, and only when they affect
   the current turn.
3. Mark each criterion met from fresh evidence; do not create recurring
   reminders for ordinary turns.
4. Mark the goal complete only after the completion review approves the evidence.

Keep reminders short. This skill provides workflow guidance; persistence and
goal tooling depend on the host.
