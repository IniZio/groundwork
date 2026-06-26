---
name: vertical-slice
description: Decompose any implementation task into conflict-free parallel slices for maximum general-purpose fan-out. Each slice is a thin end-to-end tracer through all layers for one user-facing behavior. Use before delegating to general-purpose agents — this is the decomposition phase, not the implementation phase. Writes the .groundwork/run.json ledger that the Stop-gate hook enforces.
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

- Before delegating implementation to general-purpose agents
- Before `implement` or when the orchestrator is planning a wave
- Whenever ≥3 files will change or ≥2 distinct user-facing behaviors are involved — no exceptions

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

| Task size | Target slices per wave |
|-----------|------------------------|
| Small change (1 day) | 3–6 slices |
| Feature (PRD) | 6–20 slices per wave |
| Large refactor | 8–20 slices across waves |

These counts are *slices per wave* (one general-purpose each), bounded by the orchestrator's per-agent ceilings (general-purpose ≤20 per wave). They are caps, not quotas — never invent or artificially fragment slices to hit a number. A valid slice is a real, independently-testable behavior with non-overlapping file ownership.

**Single-slice waves are a FAILURE on non-trivial work.** If a wave has only one slice, you have not decomposed hard enough — re-examine for independent behaviors before proceeding.

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

## The Ledger — `.groundwork/run.json` (MANDATORY)

The slice table is not just a message to yourself — it is a **durable artifact** that
the Stop-gate hook reads to decide whether the session is allowed to end. Producing
the table without writing the ledger means the gate has nothing to enforce against.

**After producing the slice plan, write `.groundwork/run.json`** with the Write tool.
This is the contract; the hook (`hooks/stop-gate.mjs`) reads exactly these fields:

```json
{
  "version": 1,
  "active": true,
  "session_id": "<this session's id — from the SessionStart 'Session identity' block>",
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
      "status": "pending" },
    { "id": "S2", "behavior": "guest agent disk handlers",
      "files": ["server.go", "disk.go"],
      "wave": 0, "blocked_by": [], "depends_on": [],
      "acceptance": ["disk grow/shrink handlers respond over the agent socket"],
      "status": "pending" }
  ],
  "gate": {
    "critic": "pending",
    "advisor": {
      "verdict": "APPROVE",
      "rubric": "groundwork-completion-v1",
      "axes": { "correctness": 3, "completeness": 3, "over_engineering": 0 },
      "citation": "image_sparse.go:120"
    }
  }
}
```

`gate.advisor` also accepts the legacy bare string `"APPROVE"` (case-insensitive) for
backward compatibility; the object form is preferred (see `advisor-gate`).

**Field rules (the hook depends on these exact shapes):**

- `active` — `true` while the run is live. Set to `false` ONLY to cancel/abandon the run.
- `session_id` — copy from the SessionStart "Session identity" block. A ledger owned by a
  different session never blocks the current one. Omit only if you cannot find it.
- `slices[].status` — one of `pending` | `in_progress` | `complete`. The Stop gate blocks
  while ANY slice is not `complete`.
- `slices[].blocked_by` — array of slice IDs that must reach `complete` before this slice
  may be marked `complete`. This is the **canonical** wave-ordering dependency.
  `depends_on` is an accepted legacy alias; if both are present, treat them as a union.
- `slices[].acceptance` — optional `string[]` of checkbox-style, individually verifiable
  done-conditions. Each entry is one concrete assertion the critic can confirm; the
  Stop-gate surfaces the count for incomplete slices.
- `gate.advisor` — `pending` until the advisor gate runs; must resolve to `APPROVE` for the
  run to end (see `advisor-gate`). Accepts **either** form:
  - **Legacy string**: `"APPROVE"` | `"REVISE"` | `"REJECT"` (case-insensitive).
  - **Object**: `{ "verdict": "APPROVE|REVISE|REJECT", "rubric": "<id/text>", "axes": {
    "correctness": 0-3, "completeness": 0-3, "over_engineering": 0-3 }, "citation":
    "<file:line or construct, or 'none'>" }`.
  The run is approved when the string, or the object's `verdict`, equals `APPROVE`
  (case-insensitive). `verifier`/`critic` are informational (`pending`|`passed`|`skipped`) — tolerated as ledger keys but not required for the gate.
- `reinforcements` — leave at `0`; the hook manages it.

**Lifecycle the orchestrator owns (the hook only reads):**

1. `vertical-slice` writes the ledger with all slices `pending`.
2. As each wave's general-purpose agents return and you verify them, update those slices to `complete`
   (Edit `.groundwork/run.json`).
3. When all slices are `complete`, run the risk-tiered completion gate: `[qa if interactive UI] → critic (evidence+quality) → advisor` and record `gate.advisor = "APPROVE"`. Trivial work (≤2 files, ≤1 behavior, <1h) may skip directly to advisor.
4. With every slice `complete` and `gate.advisor === "APPROVE"`, the Stop gate releases.

If you ever need to bail out, set `"active": false` — the gate releases immediately.

## Rejection KB — `.groundwork/out-of-scope/<concept-slug>.md`

When a **concept** is rejected as out of scope (by the advisor gate or at triage), record it
as a durable knowledge-base entry — **one markdown file per concept**, keyed by a stable
kebab-case slug (e.g. `realtime-collab.md`, `multi-tenant-billing.md`). This is the dedup
store: at triage, scan this directory and match an incoming request **by concept, not
keyword** ("night theme" matches `dark-mode.md`). On a match, append to *Prior requests* and
decline rather than re-planning work already rejected.

Record a concept here **only when it is genuinely rejected** — never for features already
implemented (that would poison the dedup check with false rejections). Keep the reasoning
**durable**: explain the lasting why (architecture fit, product direction, cost), not the
circumstances of one request — those are deferrals, not rejections.

Template:

```markdown
# Out of scope: <Concept name>

**Slug:** <concept-slug>
**Status:** REJECTED
**First rejected:** <YYYY-MM-DD>

## Why this is out of scope

<Durable, evergreen rationale that should survive across sessions.>

## What would change this

<Concrete conditions that would make it in-scope later, or "none".>

## Prior requests

- <YYYY-MM-DD> — <who/where it was raised> — <one-line context / outcome>
```
