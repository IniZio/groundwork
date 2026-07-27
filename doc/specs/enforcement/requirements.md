---
concept: C-ENFORCEMENT
origin_rfc: R-20260726-K4M2QX
---

### ENFORCEMENT-R-001 — Impl-guard blocks orchestrator direct edits outside permitted paths {#enforcement-r-001}

If an Edit or Write call is received from the orchestrator identity on a path that is not a permitted memory file or handoff document, then the enforcement hook **shall** return a deny block.

- **Why** — The orchestrator role is to classify, delegate, and review work—never to implement directly. Direct implementation by the orchestrator consumes the expensive session model (opus) for file edits that should be delegated to subagents (which run on sonnet per model-registry.json). Under real context pressure, this advisory is routinely dropped: observed groundwork sessions ran 200+ Edits + 37+ Writes on the orchestrator's model despite correct fan-out machinery being available, resulting in ~88% of output-token load landing on the expensive model. This hook enforces the division of labor mechanically. The two permitted paths (memory under `~/.claude/projects/<hash>/memory/` and handoffs at `.groundwork/handoffs/handoff-*.md`) are composition-in-context documents the orchestrator must write in a single turn; code and test and tooling changes belong to delegated subagents.
- **Fit criterion** — The enforcement hook test suite passes all deny cases. Edit and Write calls from the orchestrator on paths outside the two permitted shapes are blocked; calls from subagents are passed through; the two permit paths (memory files under user home claude projects directory and handoff documents under groundwork handoffs subdirectory) are allowed; and spoof paths resolving outside those shapes are blocked.
- **Verification** automated · **Criticality** must · **Source** R-20260726-K4M2QX
