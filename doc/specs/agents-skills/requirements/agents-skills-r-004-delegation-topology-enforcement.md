---
id: "agents-skills-r-004"
type: requirement
title: "Delegation topology enforcement"
concept: C-AGENTS-SKILLS
criticality: must
verification: automated
status: open
---

## AGENTS-SKILLS-R-004 — Delegation topology enforcement {#agents-skills-r-004}

**If** a subagent attempts to dispatch a `junior-orchestrator`, **then** the `nesting-guard` PreToolUse hook **shall** deny the spawn (only the primary orchestrator may spawn a junior-orchestrator). **If** a `junior-orchestrator` caller attempts to dispatch any agent type outside `{general-purpose, explore, advisor, designer, test-engineer, qa}`, **then** nesting-guard **shall** deny the spawn. **If** any identifiable subagent (depth ≥ 1) attempts to dispatch an agent type in `{general-purpose, orchestrator, debugger}` (the `DENIED_AT_DEPTH_1` set), **then** nesting-guard **shall** deny the spawn.

- **Why** — Without topology enforcement an unbounded chain of general-purpose or junior-orchestrator spawns can form, bypassing cost-tiering, accumulating token fees at the session model tier, and making fan-out auditing impossible. The deny rules are the mechanical backstop for delegation discipline that prose alone cannot enforce.
- **Fit criterion** — Send a PreToolUse input with `tool_name: "Task"`, `tool_input.subagent_type: "groundwork:junior-orchestrator"`, and a populated `agent_id` (marking the caller as a subagent). Nesting-guard **shall** return `permissionDecision: "deny"`. Send the same input with no `agent_id` and a blank `agent_type` (primary orchestrator caller); the guard **shall** return exit 0 with no deny.
- **Verification**: automated — `nesting-guard` PreToolUse hook fires on every Agent/Task/TaskCreate dispatch; all three policy rules are exercised by the unit test suite under `test/`.
- **Criticality**: must
