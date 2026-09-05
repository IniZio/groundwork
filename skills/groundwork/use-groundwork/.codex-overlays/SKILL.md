---
name: use-groundwork
description: Bootstrap the groundwork workflow suite for Codex. Load once at session start and again only after context compaction.
---

<!-- SUBAGENT-STOP: If you are operating in an executor role rather than the lead/orchestrator role, STOP. This skill contains orchestrator-only rules that will confuse an executor. -->

# Using Groundwork Workflow (Codex)

**Loading model — once, then compact reminders.** Load this skill once at session start, and again only after context compaction removes the bootstrap from context. On ordinary turns, keep any reminder to one or two lines naming the current workflow phase and next action. Do not reload the full bootstrap or repeat its rules every turn.

## Bootstrap Content

The full rules live in these sibling files, loaded together with this skill:

- `bootstrap-universal.md` — rules for every role
- `bootstrap-orchestrator.md` — rules for the lead/orchestrator role (includes a "Codex adaptation" section)
- `bootstrap-general-purpose.md` — rules for the executor role

## Codex Runtime (read once)

Codex is a single-agent terminal runtime. This overlay is the Codex contract: use the available shell, file, plan, and skill surfaces; keep delegation, gates, and reminders as explicit workflow conventions; and do not assume host-specific orchestration APIs. The `reference/` docs retain shared multi-agent guidance, so follow their Codex-scope notes before using any example.
