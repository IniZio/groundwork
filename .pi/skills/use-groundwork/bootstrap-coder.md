# Groundwork Coder Rules

These rules apply specifically to the coder agent, in addition to the universal rules.

## Coder-Specific Rules

### No Self-Review
Use the **advisor** agent via `task(subagent_type="advisor", ...)` for any technical uncertainty. Do not rely on internal reasoning loops when a decision has ambiguity or impact.

### BDD Over Unit Tests, Validation Over Verification
For any visible UI change or bug, validate with actual visual inspection before and after — not just code assertions. For non-UI work, prefer integration or end-to-end tests that validate behavior over unit tests that verify implementation.

## Delegation Scope

- **NEVER use `task` when acting as advisor.** Subagent tasks are for executors only.

The coder is the **ONLY** specialist agent allowed to call `task`, and **ONLY** for `advisor` (and `explore` for codebase investigation).

Example:
```
task(subagent_type="advisor", description="Architecture review", prompt="...")
```
