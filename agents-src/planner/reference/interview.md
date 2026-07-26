# Planner Reference: Interview Protocol

This document defines the interview protocol for the planner agent (Phase 1). The planner loads it when the requirements of a task are ambiguous or incomplete.

## Purpose

The interview phase establishes what is being built, for whom, and under what constraints — before any code is read or any plan is written. Skipping this phase produces plans that solve the wrong problem.

## Trigger Conditions

Run the full interview protocol when any of the following is true:
- The task brief does not name specific acceptance criteria
- The scope boundary is ambiguous (what is in, what is out)
- The success signal is subjective or undefined ("make it better", "improve X")
- The task touches shared or security-sensitive code without a stated constraint
- A spec_delta is implied but the requirement IDs are not given

If the task brief is fully specified (named files, named criteria, named requirement IDs), skip to Phase 2.

## Question Collection

Collect ALL open questions before emitting NEEDS-INPUT. Do not emit a partial set, wait for an answer, then ask more — compile the complete list in one pass.

For each open question:
1. State the question precisely
2. Supply a `recommended_answer` — your best inference from the task brief, codebase context, or project conventions. If you truly cannot infer, write "Unknown — please specify"
3. Mark `blocking: true` if the RFC cannot proceed without this answer, `blocking: false` if the recommended answer is acceptable as a default

## Required Interview Questions (always ask when spec_delta is planned)

When the task will modify `docs/spec/` or produce a `spec_delta` in the RFC frontmatter, include these questions if not already answered by the brief:

- Which concept nodes in `docs/spec/` does this change touch? (needed for steering ancestry resolution)
- Which existing requirement IDs does this task satisfy or modify?
- Is this a new requirement addition (`op: add`) or a modification of an existing one (`op: modify`)?

## Required Interview Questions (always ask when acceptance criteria are stated)

For each acceptance criterion stated in the brief:
- Is this criterion testable programmatically, or does it require manual verification?
- If testable: what is the observable output that confirms it?
- If not testable (`testable: false`): does the linked requirement in `docs/spec/` already declare `verification: manual`? If not, the criterion must either be made testable or the requirement must be updated.

## NEEDS-INPUT Format (reference)

```
NEEDS-INPUT
questions:
  - id: Q1
    question: "…"
    recommended_answer: "…"
    blocking: true
  - id: Q2
    question: "…"
    recommended_answer: "…"
    blocking: false
tooling_gap: <value or omit>
```

Emit exactly one NEEDS-INPUT payload with all collected questions. After the user responds, resume from the phase that was blocked.
