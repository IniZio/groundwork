---
id: enforcement-r-002
type: requirement
concept: C-ENFORCEMENT
title: Nesting-guard enforces agent spawn topology via type allowlist
status: implemented
verification: unverified
criticality: must
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-002 — Nesting-guard enforces agent spawn topology via type allowlist {#enforcement-r-002}

If an Agent, Task, or TaskCreate call is received from a caller identified as a subagent (via non-empty `agent_type`, `agent_id`, or an `agent-`-prefixed `transcript_path`) and the target `subagent_type` is `junior-orchestrator`, then the enforcement hook **shall** deny it; if the caller is identified as a `junior-orchestrator` subagent and the target is not in the set `{general-purpose, explore, advisor, designer, test-engineer, qa}`, then the enforcement hook **shall** deny it; if any other subagent targets `general-purpose`, `orchestrator`, or `debugger`, then the enforcement hook **shall** deny it.

- **Why** — Without this gate, a subagent could spawn a `junior-orchestrator` (creating unbounded nesting), or a leaf `general-purpose` worker could fan out its own sub-agents (bypassing the model-cost and context-budget contracts of the three-level topology). The type allowlist is the only lever available at a PreToolUse hook: spawn depth is unknowable from this hook position because the harness does not expose `parent_agent_id` or `nesting_depth` in the payload. Enforcement is therefore a flat type allowlist, not a depth counter. A primary orchestrator spawning a junior that in turn spawns another junior cannot be detected mechanically.
- **Fit criterion** — Running the hook with `{"tool_name":"Agent","tool_input":{"subagent_type":"junior-orchestrator"},"agent_type":"general-purpose","agent_id":"test-abc"}` returns a deny response with `permissionDecision:"deny"` and a reason naming "only the primary orchestrator may spawn a junior-orchestrator". Running the same payload without `agent_type` or `agent_id` (primary caller) returns empty stdout and exit 0 (passthrough). Verified against live hook:
  
  ```
  $ echo '{"tool_name":"Agent","tool_input":{"subagent_type":"junior-orchestrator"},"agent_type":"general-purpose","agent_id":"test-abc"}' \
      | CLAUDE_PLUGIN_ROOT=. bin/gw-hook hook nesting-guard
  {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
  "permissionDecisionReason":"groundwork nesting-guard: only the primary orchestrator may spawn
  a junior-orchestrator. A subagent (a general-purpose worker or another junior-orchestrator)
  must not — implement the slice directly or surface a blocker to the parent orchestrator."}}
  EXIT: 0
  
  $ echo '{"tool_name":"Agent","tool_input":{"subagent_type":"junior-orchestrator"}}' \
      | CLAUDE_PLUGIN_ROOT=. bin/gw-hook hook nesting-guard
  (no stdout)
  EXIT: 0
  ```
- **Verification**: unverified — the hook is tested in `test/hooks/nesting-guard.test.ts`.
- **Criticality**: must
