---
id: enforcement-r-001
type: requirement
concept: C-ENFORCEMENT
title: Impl-guard blocks orchestrator direct edits outside permitted paths
status: implemented
verification: unverified
criticality: must
design: "[[design/components/orchestrator-impl-guard]]"
---

## ENFORCEMENT-R-001 — Impl-guard blocks orchestrator direct edits outside permitted paths {#enforcement-r-001}

If an Edit or Write call is received from the orchestrator identity on a path that is not a permitted memory file, then the enforcement hook **shall** return a deny block.

- **Why** — The orchestrator role is to classify, delegate, and review work — never to implement directly. Direct implementation by the orchestrator consumes the expensive session model (opus) for file edits that should be delegated to subagents (which run on sonnet per model-registry.json). Under real context pressure, this advisory is routinely dropped: observed groundwork sessions ran 200+ Edits + 37+ Writes on the orchestrator's model despite correct fan-out machinery being available, resulting in ~88% of output-token load landing on the expensive model. This hook enforces the division of labor mechanically. The one permitted path (session/project memory under `~/.claude/projects/<hash>/memory/`) covers composition-in-context documents the orchestrator must write in a single turn; code and test and tooling changes belong to delegated subagents.
- **Fit criterion** — The enforcement hook test suite passes all deny cases: Edit and Write calls from the orchestrator on paths outside the permitted shape are blocked; calls from subagents are passed through; the permit path (memory files under the user home claude projects directory) is allowed; and spoof paths resolving outside that shape are blocked.
- **Verification**: unverified — the hook is tested against all deny cases in the test suite (`test/hooks/orchestrator-impl-guard.test.ts`).
- **Criticality**: must
