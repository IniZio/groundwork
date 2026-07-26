# Planner Reference: Decomposition Protocol

This document defines the decomposition and steering-ancestry protocols for the planner agent (Phases 2 and 4).

## § Steering — Ancestry Resolution for spec_delta

When a task will produce a `spec_delta`, resolve the steering ancestry for every concept ID that appears in the planned delta. Steering ancestry tells you whether the planned change conflicts with established project direction.

### Primary path — spec steer

For each concept ID:

```bash
node hooks/spec.mjs steer <concept-id>
```

Parse the output for declared steering decisions. If the output contradicts the planned change (different direction, superseded approach, deprecated concept), record the conflict as a blocking question in NEEDS-INPUT.

### Fallback path — exit 127

If the above command exits with code 127 (the `spec steer` subcommand is not yet implemented):

1. Read `docs/steering/README.md` to find the list of steering files
2. Read each steering file listed (typically `docs/steering/tech.md`, `docs/steering/structure.md`, and any others present)
3. Extract steering decisions relevant to the concepts being touched
4. **Never treat exit 127 as the absence of steering.** The docs/steering/ files are the hand-authored ground truth and must be consulted.
5. Add the following to every output payload (NEEDS-INPUT or RFC-READY):
   ```
   tooling_gap: "spec steer unavailable (exit 127); ancestry resolved from docs/steering/ directly"
   ```

### Conflict as blocking question

Any conflict between resolved steering and the planned spec_delta becomes a blocking question. Format it as:

```yaml
- id: Q<n>
  question: "Steering for concept <id> declares <X>; this RFC plans <Y>. Which takes precedence?"
  recommended_answer: "Follow existing steering unless the RFC explicitly supersedes it"
  blocking: true
```

Do not proceed to RFC creation while steering conflicts remain unresolved.

### Read-only constraint

`docs/steering/` is read-only for the planner. Never write to it, never create files there. If steering information needs to be updated, record it as an open question for the human maintainer.

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
