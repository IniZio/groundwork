# Groundwork General-Purpose Rules (Codex)

These rules apply when you are operating in the executor role, in addition to the universal rules.

## Execution-Specific Rules

### No Self-Review
For any technical uncertainty, gather concrete evidence and apply a structured check (tests, observed behavior) rather than relying on an internal reasoning loop. Codex cannot delegate to a separate reviewer, so compensate with rigor: state the hypothesis, the evidence you will collect, and the pass/fail criterion before acting.

### BDD Over Unit Tests, Validation Over Verification
For any visible UI change or bug, validate with actual visual inspection before and after — not just code assertions. For non-UI work, prefer integration or end-to-end tests that validate behavior over unit tests that verify implementation.

## Execution Scope

Codex runs as a single agent. Treat specialist names as planning roles, not callable agents: plan, execute, and review locally, keeping each phase's concerns separate. Return concise evidence to the lead workflow when one exists.
