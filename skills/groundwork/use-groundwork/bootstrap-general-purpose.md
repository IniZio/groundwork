# Groundwork General-Purpose Rules

These rules apply specifically to the general-purpose agent, in addition to the universal rules.

## Execution-Specific Rules

### No Self-Review
Use the **advisor** agent via `task(subagent_type="groundwork:advisor", ...)` for any technical uncertainty. Do not rely on internal reasoning loops when a decision has ambiguity or impact.

### BDD Over Unit Tests, Validation Over Verification
For any visible UI change or bug, validate with actual visual inspection before and after — not just code assertions. For non-UI work, prefer integration or end-to-end tests that validate behavior over unit tests that verify implementation.

## Delegation Scope

- **NEVER use `task` when acting as advisor.** Subagent tasks are for executors only.

The general-purpose agent may call `task` for `advisor` (technical decisions) and `explore` (codebase investigation), plus other non-orchestrator specialists for a genuinely multi-domain sub-problem.

Example:
```
task(subagent_type="groundwork:advisor", description="Architecture review", prompt="...")
```
