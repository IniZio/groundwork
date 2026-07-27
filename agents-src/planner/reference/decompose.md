# Planner Reference: Decomposition Protocol

This document defines the decomposition protocol for the planner agent (Phase 3).

## § Vertical-Slice Decomposition

Decompose the work into **vertical slices** — thin end-to-end behaviors that touch all necessary layers. Each slice must be independently testable.

### Rule

BAD: "Step 1: Add types. Step 2: Add logic. Step 3: Add UI."  
GOOD: "Slice 1: Add the feature for the simplest case (types + logic + test). Slice 2: Add edge cases."

### Task object schema

Each task in the RFC `tasks` frontmatter array must carry these fields:

| Field | Required | Description |
|---|---|---|
| `id` | yes | Short identifier: `T1`, `T2`, etc. |
| `title` | yes | One-line description of the slice |
| `wave` | yes | Execution wave (1-based integer) |
| `acceptance` | yes | List of acceptance criterion objects (see below) |
| `blocked_by` | yes | Array of task IDs this task depends on; `[]` if none |
| `conditional` | no | `true` if this task only runs under a specific condition |
| `trigger` | if conditional | Condition string; required when `conditional: true` |

### Acceptance criterion object

Each element of `acceptance` is an object:

| Field | Required | Description |
|---|---|---|
| `id` | yes | Criterion ID: `T1-AC1`, `T1-AC2`, etc. |
| `text` | yes | The verifiable acceptance criterion text |
| `testable` | yes | `true` if programmatically verifiable; `false` if manual |
| `req_id` | no | Requirement ID from `docs/spec/` that this criterion satisfies |

### Testability constraint

If `testable: false`, the corresponding requirement (identified by `req_id`) must declare `verification: manual` in `docs/spec/`. If it does not:
- Either convert the criterion to be testable (preferred), or
- Reject the criterion and add a blocking NEEDS-INPUT question asking the human to update the requirement

The planner must never accept an untestable criterion whose linked requirement lacks `verification: manual`.

### Wave assignment

- Wave 1: foundational slices with no dependencies
- Wave N+1: slices that `blocked_by` any wave-N task
- Tasks in the same wave are safe to execute in parallel

### Scope limits

- Plans over 8 tasks — decompose further or split into multiple RFCs
- No vague tasks like "refactor the module" or "update as needed" — every task must have observable acceptance criteria
