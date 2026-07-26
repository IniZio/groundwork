---
id: ENFORCEMENT-R-wfdw
concept: C-ENFORCEMENT
ears: "If an Edit or Write call is received from the orchestrator identity on a path that is not a permitted memory file or handoff document, then the enforcement hook shall return a deny block and the tool call shall not execute."
pattern: unwanted
verify: "Run the enforcement hook test suite and confirm all deny cases pass. Verify the two permit paths (memory under the user home claude projects directory and handoff under the groundwork handoffs subdirectory) are allowed, and that spoof paths resolving outside those shapes are blocked."
verification: automated
criticality: must
origin_rfc: R-20260726-K4M2QX
superseded_by: null
status: active
---

The orchestrator-impl-guard.mjs hook uses three signals to identify the orchestrator: absence of `agent_type`, `agent_id`, and a `transcript_path` basename not starting with `agent-`. The hook is fail-open: when the caller's identity cannot be determined, the call is allowed rather than blocked, to avoid wedging a legitimate orchestrator session.
