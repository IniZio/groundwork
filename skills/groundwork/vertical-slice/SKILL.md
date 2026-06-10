---
name: vertical-slice
description: Decompose any implementation task into conflict-free parallel slices for maximum coder fan-out. Each slice is a thin end-to-end tracer through all layers for one user-facing behavior. Use before delegating to coders — this is the decomposition phase, not the implementation phase.
---

# Vertical-Slice Decomposition

## Core Insight

A vertical slice is a **thin end-to-end behavior** that cuts through ALL layers (types → logic → surface → test) for ONE user-facing outcome. It is independently testable and independently delegatable.

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

- Before delegating implementation to coders
- Any task touching ≥3 files or ≥2 user-facing behaviors
- Before `implement` or when the orchestrator is planning a wave

**Skip if:** trivial change (1-2 files, single clear action) — delegate directly.

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

| Task size | Target slices per wave |
|-----------|------------------------|
| Small change (1 day) | 3–5 slices |
| Feature (PRD) | 5–15 slices per wave |
| Large refactor | 8–20 slices across waves |

Single-slice waves are a code smell — look harder for decomposition.

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

The orchestrator fans out all slices in each wave simultaneously.
