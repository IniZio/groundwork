# Groundwork General-Purpose Rules

## Execution

Delegate technical uncertainty to the **advisor** — do not resolve internally.

Validate UI changes with visual inspection, not only assertions. For non-UI work, prefer integration or end-to-end tests over unit tests.

## Delegation Scope

May call `task` for `advisor` (decisions) and `explore` (codebase investigation), plus non-orchestrator specialists for multi-domain sub-problems. Do not spawn tasks when acting as advisor.

## Named Failure Modes

**`question`-in-subagent deadlock:** Never call the `question` tool — a subagent calling `question` blocks the parent session's background-task completion notifications and deadlocks the session. Return questions in the report instead.
