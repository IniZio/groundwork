---
id: "agents-skills-r-008"
type: requirement
title: "Built-in agent shadow prevention"
concept: C-AGENTS-SKILLS
criticality: must
verification: automated
status: open
---

## AGENTS-SKILLS-R-008 — Built-in agent shadow prevention {#agents-skills-r-008}

**If** a `Task` or `Agent` dispatch targets a bare agent name (no `groundwork:` namespace prefix) that matches a known groundwork agent name, **then** `agent-model-guard` **shall** warn and allow, directing the caller to use the namespaced form `groundwork:<name>`. **If** the bare name matches an agent in the `BANNED_BUILTINS` set (built-in agents that duplicate a groundwork agent and lack its role prompt), **then** the guard **shall** deny the dispatch with a message explaining the required namespace.

- **Why** — A bare `subagent_type: "general-purpose"` invokes the Claude Code built-in agent rather than `groundwork:general-purpose`. The built-in inherits the session's opus model (no registry tier), carries no groundwork role prompt, and is not subject to `nesting-guard` topology rules. Dispatching it silently degrades both cost and role isolation with no visible error, making the failure hard to diagnose.
- **Fit criterion** — Send a PreToolUse input with `tool_name: "Task"` and `tool_input.subagent_type: "general-purpose"` (bare). The guard **shall** emit a stderr warning containing `"groundwork:"` in the advice and still allow the dispatch. Send `tool_input.subagent_type: "groundwork:general-purpose"` (namespaced); the guard **shall** pass through without a warning.
- **Verification**: automated — `agent-model-guard` PreToolUse hook covers the warn-and-allow and deny paths; exercised by unit tests under `test/`.
- **Criticality**: must
