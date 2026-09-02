---
id: enforcement-r-001
type: requirement
concept: C-ENFORCEMENT
title: Impl-guard warns on orchestrator direct edits outside permitted paths (advisory)
status: implemented
verification: automated
criticality: must
design: "[[design/components/orchestrator-impl-guard]]"
---

## ENFORCEMENT-R-001 — Impl-guard warns on orchestrator direct edits outside permitted paths (advisory) {#enforcement-r-001}

If an Edit or Write call is received from the orchestrator identity on a path that is not a permitted memory file, then the enforcement hook **shall** emit an advisory warning via `additionalContext` and allow the edit to proceed (exit 0, no `permissionDecision`). The orchestrator delegation obligation remains a MUST; the hook enforces it through a visible reminder, not a hard block.

- **Why** — The orchestrator role is to classify, delegate, and review work — never to implement directly. Direct implementation by the orchestrator consumes the expensive session model (opus) for file edits that should be delegated to subagents (which run on sonnet per model-registry.json). Under real context pressure, this advisory is routinely dropped: observed groundwork sessions ran 200+ Edits + 37+ Writes on the orchestrator's model despite correct fan-out machinery being available, resulting in ~88% of output-token load landing on the expensive model. This hook reinforces the division of labor through an advisory nudge. The one permitted path (session/project memory under `~/.claude/projects/<hash>/memory/`) is silently allowed without a warning; code and test and tooling changes belong to delegated subagents.
- **Fit criterion** — The enforcement hook test suite verifies all advisory cases: Edit, Write, and MultiEdit calls from the orchestrator on paths outside the permitted shape emit `additionalContext` containing a delegation reminder and carry no `permissionDecision` (edit proceeds); calls from subagents are silently passed through; the permit path (memory files under the user home claude projects directory) is allowed without a warning; and spoof paths resolving outside that shape emit a warning.
- **Verification**: automated — all advisory cases are verified by `test/hooks/orchestrator-impl-guard.test.ts` (the `@verifies ENFORCEMENT-R-001` suite).
- **Criticality**: must
