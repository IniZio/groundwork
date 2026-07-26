---
id: ORCHESTRATION-R-ve7w
concept: C-ORCHESTRATION
ears: "When the orchestrator classifies a task as non-trivial, the orchestrator shall delegate implementation to a groundwork:general-purpose subagent and shall not invoke Edit, Write, or MultiEdit directly on production code."
pattern: event
verify: "Confirm that the orchestrator impl-guard hook blocks Edit and Write calls from the orchestrator identity (agent_type absent, agent_id absent) on paths outside the two permitted shapes, and that a general-purpose subagent with agent_type set is allowed through."
verification: hybrid
criticality: must
origin_rfc: R-20260726-K4M2QX
superseded_by: null
status: active
---

The orchestrator-impl-guard.mjs PreToolUse hook enforces this requirement mechanically. When the orchestrator calls Edit or Write on a path that is neither a memory file nor a handoff document, the hook emits a deny block listing the delegation command to use instead.

## Manual procedure

Run a session where the orchestrator attempts to call Edit on a source file directly. Verify that the PreToolUse hook returns a deny response and the edit is blocked. Then repeat the same call from a subagent session (agent_type present) and verify it is allowed.
