---
name: vertical-slice
description: Decompose any task into conflict-free parallel slices. Writes the .groundwork/run.json ledger the Stop-gate enforces.
---

# Vertical-Slice Decomposition

## Core Insight

A vertical slice is a **thin end-to-end behavior** that cuts through ALL layers (types → logic → surface → test) for ONE user-facing outcome. It is independently testable and independently delegatable.

## Default Posture

Decompose by default. The question is never "should I slice?" but "what is the maximum number of conflict-free slices?". Maximize parallel width within each wave; the only constraints on slicing are real file-ownership conflicts and genuine data dependencies.

**Horizontal (wrong) — delays validation, blocks fan-out:**
```
Wave 0: all types + all constants
Wave 1: all functions + services
Wave 2: all components + UI + tests
```

**Vertical (correct) — validates immediately, enables full fan-out:**
```
Slice 1 (tracer): add item — type → addItem() → ItemInput.vue → e2e test
Slice 2: complete + delete — toggle(), delete() → ItemRow.vue → e2e tests
Slice 3: filter + clear — filter state → FilterBar.vue → e2e tests
```

## When to Use

**This skill is MANDATORY** — not optional — for any task touching ≥3 files or ≥2 user-facing behaviors before delegating to general-purpose agents.

**Skip ONLY if trivial — ≤2 files AND ≤1 user-facing behavior AND <1h. If either ≥3 files OR ≥2 user-facing behaviors, slicing is mandatory.**

## Decomposition Process

### 1. List user-facing behaviors from the spec

Each behavior the user can observe = one candidate slice. Write them out before grouping.

### 2. Identify the tracer bullet

The first slice must prove the full end-to-end path: data model → business logic → surface → test. It should be the simplest behavior that exercises every layer.

### 3. Map file ownership per slice

For each slice, list the files it will create or modify. A file owned by two slices in the same wave = conflict. Resolve by:
- Merging the slices into one
- Serializing them (put one in Wave 0, one in Wave 1)
- Splitting the file so each slice owns a non-overlapping section

### 4. Assign waves by dependency

```
Wave 0: tracer bullet (1-2 slices)
Wave 1: slices that only depend on tracer output
Wave 2: slices that depend on Wave 1 output
```

Slices in the same wave MUST have non-overlapping file ownership.

### 5. Write the slice table

```
Slice N: <behavior name>
  Files:      <files owned — created or modified>
  Test:       <e2e or integration test validating the behavior>
  Depends on: <slice IDs, or "none">
  Wave:       <0 / 1 / 2 ...>
```

## Fan-Out Targets

Fan-out targets (from your agent definition's Fan-out Protocol section): general-purpose 5–20, explore 3–7, designer 2–5, advisor 1–2 per wave. **Single-slice waves on non-trivial work are a failure — decompose harder.**

## Conflict-Free Rules

- Each file is owned by exactly ONE slice per wave
- Shared types/interfaces needed by multiple slices: define them in the tracer bullet
- Test files: each slice owns its own test file; shared harness/fixtures go in Wave 0
- Generated or schema files: treat as a single-owner file, serialize in Wave 0

## Output Format

Hand the orchestrator this table plus wave assignments:

```markdown
## Slice Plan

| Slice | Behavior | Files Owned | Wave | Depends On |
|-------|----------|-------------|------|------------|
| S1 (tracer) | Add workspace disk min-size | image_sparse.go, image_sparse_test.go | 0 | — |
| S2 | Guest agent disk handlers | server.go, disk.go | 0 | — |
| S3 | Data disk monitor | driver_data_disk_monitor.go, manager.go | 1 | S1 |
| S4 | E2e harness + tests | suite.go, harness.go, disk_grow_test.go | 1 | S2 |

Wave 0: S1 + S2 (parallel, no file conflicts)
Wave 1: S3 + S4 (parallel, no file conflicts)
```

## The Ledger (MANDATORY)

The run ledger is written per-session at `.groundwork/runs/<session_id>.json` (legacy `.groundwork/run.json` is still honored for in-flight runs). Use ONLY the `ledger` CLI (`${CLAUDE_PLUGIN_ROOT}/hooks/ledger.mjs`) for all mutations — never Read/Edit the ledger file by hand. The schema this skill writes on initial creation:

```json
{
  "version": 1,
  "active": true,
  "session_id": "<from the SessionStart 'Session identity' block>",
  "brief": "<one-line description of the task>",
  "plan_ref": "<path to a plan file if one exists, else null>",
  "reinforcements": 0,
  "slices": [
    { "id": "S1", "behavior": "add workspace disk min-size",
      "files": ["image_sparse.go", "image_sparse_test.go"],
      "wave": 0, "blocked_by": [], "depends_on": [],
      "acceptance": [
        "image_sparse rejects a workspace smaller than the min size",
        "image_sparse_test covers the min-size boundary"
      ],
      "status": "pending",
      "kind": "impl" }
  ],
  "gate": { "advisor": "pending" }
}
```

Slice `kind` is optional (default `impl`); values: `plan | diagnose | design | impl`. Use non-`impl` kinds to track planning, diagnosis, or design phases as first-class ledger items. Gating is status-keyed — `kind` is metadata only and does not affect stop-gate logic.

Write this file once with the Write tool (all slices `pending`). After that, use ONLY the `ledger` CLI — never Read/Edit the file by hand.

## Rejection KB

When a concept is rejected as out of scope, record it in `.groundwork/out-of-scope/<concept-slug>.md`. See `reference/rejection-kb.md` for the template and full rules.
