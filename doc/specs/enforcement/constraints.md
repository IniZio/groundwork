---
type: constraints
id: C-ENFORCEMENT
---

# Enforcement Constraints

## Normative Invariants

### Orchestrator Implementation Guard (ENFORCEMENT-R-001)

The enforcement hook **shall** deny any Edit or Write call originating from the orchestrator identity when the target path does not match one of the two permitted shapes:

1. Session/project memory files whose resolved path is under `~/.claude/projects/<hash>/memory/`
2. Handoff documents whose parent directory is `handoffs/`, which is itself a child of `.groundwork/`

This constraint is a **hard block**: the hook returns a deny result synchronously and the tool call never executes. It is not advisory and does not fail-open.

Subagent callers — identified by the presence of `agent_type`, `agent_id`, or a `transcript_path` basename starting with `agent-` — are exempt from this guard and **shall** be permitted to proceed without restriction.

Spoof paths that appear to match a permitted shape but resolve outside it (e.g. via path traversal) **shall** be blocked.

### Fail-Open Guards

The nesting guard and spec guard **shall** fail-open when the caller's depth or RFC coverage cannot be determined: if the detection signal is absent, the call is permitted and a warning is emitted. This preserves liveness over strictness for advisory checks, in contrast to the hard-block behavior of the orchestrator impl-guard.
