---
id: enforcement-r-003
type: requirement
concept: C-ENFORCEMENT
title: Agent-model-guard injects registry-mapped model tier when model is absent
status: implemented
verification: unverified
criticality: must
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-003 — Agent-model-guard injects registry-mapped model tier when model is absent {#enforcement-r-003}

When an Agent, Task, or TaskCreate call carries no explicit `model` field (or an empty one), the enforcement hook **shall** inject the `model` tier recorded for the target `subagent_type` in `model-registry.json`; when the target maps to no registry entry or the registry cannot be loaded, the hook **shall** inject the default tier (`sonnet`) to prevent inheritance of the expensive session model; when an explicit non-empty `model` is already present, the hook **shall** pass through without modification.

- **Why** — Omitting `model` silently inherits the parent session's model — opus when the orchestrator runs. Every background task dispatched without an explicit tier therefore bills at the most expensive tier, with no diagnostic that it happened. Across a fan-out of 10–20 subagents this is a large cost amplifier; the memory note `sonnet-alias-pin` documents a related drift. The hook closes this gap at the call site rather than relying on every prompt author to remember to set the field.
- **Fit criterion** — Running the hook with `{"tool_name":"Agent","tool_input":{"subagent_type":"groundwork:general-purpose"}}` (no `model` field) returns an allow response with `updatedInput` containing `model:"sonnet"` and a reason string "injected model". Verified against live hook:
  
  ```
  $ echo '{"tool_name":"Agent","tool_input":{"subagent_type":"groundwork:general-purpose"}}' \
      | CLAUDE_PLUGIN_ROOT=. bin/gw-hook hook agent-model-guard
  {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow",
  "permissionDecisionReason":"groundwork model-guard: injected model \"sonnet\" for
  groundwork:general-purpose (was unset — would have inherited the opus session model)",
  "updatedInput":{"subagent_type":"groundwork:general-purpose","model":"sonnet"}}}
  EXIT: 0
  ```
  
  Running with `{"tool_name":"Agent","tool_input":{"subagent_type":"groundwork:general-purpose","model":"opus"}}` returns empty stdout and exit 0 (passthrough — operator intent wins).
- **Verification**: unverified — the hook is tested in `test/hooks/agent-model-guard.test.ts`.
- **Criticality**: must
