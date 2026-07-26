---
name: feature
description: Feature-ledger artifact convention — durable multi-session feature state under .groundwork/features/<slug>/ with markdown content plus a machine-authoritative .feature.yaml sidecar.
disable-model-invocation: false
---

# Feature Ledger

## Purpose

A **feature ledger** is durable, multi-session project state for a non-trivial feature. It outlives any single session run ledger. Human-authoritative content lives in markdown; machine resume state lives in a small YAML sidecar so `/resume` does not parse checkboxes.

Features are **not** session-keyed and are **not** pruned with the 7-day session run-ledger prune. Soft-archive with `active: false` in the sidecar.

## When to Use

- Multi-session or multi-wave features that need a program counter across handoffs
- Work that should survive session end, context compression, or machine switches
- When `/resume` must reconstruct goal, open slices, and next actions without a transcript

**Skip for trivial work** (single-line, obvious config, docs-only) — those stay on the direct → advisor fast-path with no feature ledger.

## Path layout

```
.groundwork/features/<slug>/
  spec.md          # goal, acceptance_criteria (AC1..), negative_scope, links
  plan.md          # milestones + slice index (waves)
  tasks.md         # checkbox tasks [ ]/[X], IDs, wave headers, file refs
  .feature.yaml    # MACHINE resume state (the program counter)
```

### Slug rules

`<slug>` is the directory name under `.groundwork/features/`:

- **Pattern (authoritative):** `^_?[a-z0-9]+(?:-[a-z0-9]+)*$`
- Kebab-case: lowercase ASCII letters, digits, single hyphens between segments
- **Leading underscore allowed** for test/reserved prefixes (e.g. `_fixture-ledger`, `_r4-smoke`)
- No uppercase, no underscores mid-slug, no consecutive hyphens, no trailing hyphen
- Examples: `workspace-disk-min-size`, `auth-oauth`, `_test-resume`

### `tasks.md` checkbox + task-ID grammar

Authoritative conventions (agents and Wave-2 tooling MUST follow):

| Element | Grammar | Notes |
|---------|---------|-------|
| Open checkbox | `- [ ]` | Space between brackets required |
| Done checkbox | `- [X]` or `- [x]` | Upper or lower `X`; no other characters inside brackets |
| Task ID | `F<major>.<minor>` | e.g. `F1.1`, `F2.3` — major = slice/wave family, minor = task within |
| Slice ID | `F<n>` or plan slice token | e.g. `F1`, `F2` — referenced by `resume.pointer: slice:F2`, `runs[].slices_completed`, `ac_coverage` values |
| AC ID | `AC<n>` | e.g. `AC1`, `AC2` — stable; never renumber mid-flight |

Example `tasks.md` lines:

```markdown
## Wave 1 — F1 image_sparse

- [X] F1.1 Reject undersized sparse images at boundary
- [X] F1.2 Unit tests for min-size edge
- [ ] F1.3 Wire error code into host path

## Wave 2 — F2 guest agent

- [ ] F2.1 Surface clear undersized-disk error
```

Do **not** treat checkboxes as the machine program counter — that is `.feature.yaml` `resume`. Checkboxes are human/task projection; tick them when slices complete.

## Schema

**Machine contract:** [`feature.schema.json`](./feature.schema.json) (JSON Schema draft 2020-12).

- Every `.feature.yaml` MUST validate against that schema after YAML→JSON deserialization.
- `additionalProperties: false` at every object level — **fail-closed** on field drift/typos.
- Do **not** invent alternate field names or status aliases.
- Wave-2 ships the validator/CLI; until then agents MUST author sidecars as if the validator already runs.

### Status enum (authoritative)

**Only** these five values. Never use `in_progress`, `completed_acs`, `done`, `active`, or other aliases in the `status` field.

| Value | Meaning |
|-------|---------|
| `planned` | Spec/plan written; impl not started |
| `started` | At least one session has linked a run or advanced a slice |
| `paused` | Explicitly parked; resume pointer still valid |
| `completed` | All ACs met; advisor APPROVE recorded; pointer terminal |
| `canceled` | Abandoned; pointer terminal |

### Health enum (authoritative)

| Value | Meaning |
|-------|---------|
| `onTrack` | Decomposition and schedule still valid |
| `atRisk` | Slippage or open blockers; still the right plan |
| `offTrack` | Wrong decomposition or blocked hard — consider REPLAN |

### Field reference

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `version` | `1` (const) | yes | Schema major version |
| `id` | string `feat_…` | yes | Prefer `feat_<ULID>`; `feat_<slug>` allowed. Pattern: `^feat_[A-Za-z0-9][A-Za-z0-9_-]*$` |
| `slug` | string | yes | See slug rules above |
| `active` | boolean | yes | Soft-archive flag |
| `status` | enum | yes | `planned\|started\|paused\|completed\|canceled` only |
| `health` | enum | yes | `onTrack\|atRisk\|offTrack` |
| `plan_ref` | string\|null | no | Path to plan.md |
| `spec_ref` | string\|null | no | Path to spec.md |
| `branch` | string\|null | no | Primary impl branch |
| `ac_coverage` | object | yes | Map `AC#` → slice id arrays (see below) |
| `resume` | object | yes | Program counter (see below) |
| `runs` | array | yes | Cross-session run index (may be `[]`) |
| `history` | array | yes | Append-only events (keep last ~10 in agents) |
| `decisions` | array | no | MADR/Nygard pointers; default `[]` |
| `links` | object | no | External refs (Linear/GitHub/handoffs) |
| `gate` | object | no | Feature-level advisor snapshot |
| `created_at` | string | yes | ISO-8601 |
| `updated_at` | string | yes | ISO-8601 |
| `created_by_session` | string\|null | no | Creating session id |

#### `ac_coverage` (gap #2)

Explicit map from acceptance-criterion id → covering slice ids.

```yaml
ac_coverage:
  AC1: [F1]
  AC2: [F1]
  AC3: [F2]
```

**Semantics — met vs unmet:**

1. Keys SHOULD match every `AC#` in `spec.md` (`AC1`, `AC2`, …). Keep keys stable; never renumber mid-flight.
2. Values are slice ids that implement/cover that AC (usually from `plan.md` / `tasks.md`).
3. Let `completed = ⋃ runs[*].slices_completed` (optionally union `history` rows with `type: slice_complete` and `ref` = slice id if a run row was lost).
4. An AC is **met** iff `ac_coverage[ACn]` is non-empty **and** every slice id in that array is ∈ `completed`.
5. An AC is **unmet** if the key is missing, the array is empty, or any covering slice is not yet in `completed`.
6. Do **not** derive met/unmet by fragile joins through `plan.md` prose alone — `ac_coverage` is the join table.

#### `resume` (program counter)

| Field | Type | Notes |
|-------|------|-------|
| `pointer` | string\|null | Active: `slice:<id>` \| `milestone:<id>` \| `ac:<id>`. Terminal: `done` or `null` |
| `slice_id` | string\|null | Convenience mirror when pointer is `slice:<id>` |
| `next_actions` | string[] | Ordered next actions for `/resume` |
| `blocked_reason` | string\|null | If set, surface blocked; do not silently continue impl |
| `waiting_on` | string\|null | Optional external waiter |
| `updated_at` | string\|null | ISO-8601 |
| `updated_by_session` | string\|null | Session id |

#### `runs[]`

| Field | Type | Notes |
|-------|------|-------|
| `session_id` | string | required |
| `run_path` | string\|null | Path to session ledger; **null when pruned/absent** (gap #4) — consumers MUST tolerate missing files |
| `started_at` | string\|null | ISO-8601 |
| `ended_at` | string\|null | ISO-8601 when run ended |
| `gate_advisor` | enum\|null | `pending\|APPROVE\|REVISE\|REJECT\|REPLAN` |
| `slices_completed` | string[] | Slice ids finished in that run |

#### `history[]`

| Field | Type | Notes |
|-------|------|-------|
| `at` | string | ISO-8601 |
| `session_id` | string\|null | optional |
| `type` | enum | `created\|status_update\|slice_complete\|slice_reopened\|run_linked\|decision\|handoff\|paused\|resumed\|completed\|canceled` |
| `summary` | string | Human-readable (canonical name; not `detail`) |
| `ref` | string\|null | Optional path/slice id |

#### `decisions[]` / `links` / `gate`

- `decisions[]`: `{ at, summary, adr }`
- `links`: `{ linear_project_id, linear_issue_ids[], github_issue, github_prs[], handoffs[] }`
- `gate`: `{ advisor: pending\|APPROVE\|REVISE\|REJECT\|REPLAN\|null, last_verdict_at }`

### Invariant (gap #8) — enforced by schema `oneOf`

Exactly one of the following MUST hold:

**(A) Terminal** — `status ∈ {completed, canceled}` **and** `resume.pointer` is `done` or `null` (absent treated as null by consumers).

**(B) Active pointer** — `status ∈ {planned, started, paused}` **and** `resume.pointer` matches `^(slice|milestone|ac):[A-Za-z0-9][A-Za-z0-9_.-]*$` (names a non-complete target).

Illegal examples (schema MUST reject):

- `status: completed` with `resume.pointer: slice:F2`
- `status: started` with `resume.pointer: done`
- `status: started` with `resume.pointer: null`

Additional invariants (prose / Wave-2 may harden further):

1. Session run ledgers MAY set optional top-level `feature_slug` (see `vertical-slice` ledger schema). Feature `runs[]` is the authoritative cross-session index; session ledgers are ephemeral.
2. Feature dir is **NOT** pruned with session ledgers (7d prune does not touch `.groundwork/features/`).
3. No secrets. PRDs stay untracked per policy — `plan_ref` / `spec_ref` may point at gitignored `docs/prds/`.
4. `spec.md` acceptance criteria use stable IDs (`AC1`, `AC2`, …) referenced by `ac_coverage`, `resume.pointer: ac:<id>`, and advisor `contract_fitness`.

### Example shape (informative; must satisfy schema)

```yaml
version: 1
id: feat_<ULID>            # or feat_<slug>
slug: <slug>
active: true
status: planned            # planned|started|paused|completed|canceled ONLY
health: onTrack            # onTrack|atRisk|offTrack
plan_ref: <path|null>
spec_ref: <path|null>
branch: <branch|null>
ac_coverage:               # AC id → covering slice ids
  AC1: [F1]
  AC2: [F1, F2]
resume:                    # DAP continue/restartFrame metaphor — THE program counter
  pointer: slice:F2        # slice:<id> | milestone:<id> | ac:<id> | done | null
  slice_id: F2
  next_actions: ["...", "..."]
  blocked_reason: null
  waiting_on: null
  updated_at: <iso8601>
  updated_by_session: <sid>
runs:                      # authoritative cross-session index
  - session_id: <sid>
    run_path: .groundwork/runs/<sid>.json   # or null if pruned/absent
    started_at: <iso8601>
    ended_at: <iso8601|null>
    gate_advisor: pending  # pending|APPROVE|REVISE|REJECT|REPLAN
    slices_completed: [F1]
history:                   # append-only; last ~10
  - {at: <iso8601>, session_id: <sid>, type: created|status_update|slice_complete|slice_reopened|run_linked|decision|handoff|paused|resumed|completed|canceled, summary: "...", ref: null}
decisions:
  - {at: <iso8601>, summary: "...", adr: null}
links: {linear_project_id: null, linear_issue_ids: [], github_issue: null, github_prs: [], handoffs: []}
gate: {advisor: pending, last_verdict_at: null}
created_at: <iso8601>
updated_at: <iso8601>
created_by_session: <sid>
```

## Linking session runs

When opening a run ledger for work on this feature, set the optional ledger field:

```json
"feature_slug": "<slug>"
```

Default `null` when no feature is active. On link, append a `runs[]` row and a `history` entry with `type: run_linked`. When the run ends, fill `ended_at`, `gate_advisor`, and `slices_completed`. If the session ledger is later pruned, set `run_path: null` (or leave a stale path only if you also tolerate missing files — prefer null).

## Lifecycle

### Create

1. Choose a slug matching `^_?[a-z0-9]+(?:-[a-z0-9]+)*$`.
2. Create `.groundwork/features/<slug>/`.
3. Write `spec.md` (goal, `AC1..`, negative_scope, links).
4. Write `plan.md` (milestones + slice index) and `tasks.md` (checkboxes with `F#.#` ids).
5. Write `.feature.yaml` with `status: planned`, `active: true`, `health: onTrack`, `ac_coverage` keys for every AC, `resume.pointer` at the first slice or AC, empty `runs[]`, and a `history` row `type: created`.
6. Optionally set session `goal` to mirror the feature goal (feature wins on conflict — see `goal` skill).

### Update (during impl)

- Advance `resume.pointer` / `slice_id` / `next_actions` when a slice completes or the program counter moves.
- Append slice ids to the current `runs[]` row `slices_completed`; keep `ac_coverage` in sync when decomposition changes (rarely).
- Append `history` (keep last ~10) and `decisions` as needed.
- Flip `status` from `planned` → `started` on first real progress.
- Adjust `health` when risk changes.
- Tick checkboxes in `tasks.md` (`[ ]` → `[X]`/`[x]`); keep `spec.md` ACs stable (IDs never renumber mid-flight).

### Pause

- Set `status: paused`, append `history` `type: paused`.
- Leave `resume.*` intact so `/resume` can continue (invariant branch B).
- Do **not** set `active: false` (that is archive).

### Complete

- All ACs met per `ac_coverage` + `runs[].slices_completed`, and advisor-gate APPROVE on the finishing run.
- Set `status: completed`, `resume.pointer: done` (or `null`), `gate.advisor: APPROVE`, append `history` `type: completed`.
- Optionally clear or mark-achieved the session goal.

### Archive (soft)

- Set `active: false` (and usually `status: completed` or `canceled`).
- Directory remains on disk; `/resume` ignores inactive features unless slug is explicit.
- Never delete the feature dir as part of session ledger prune.

### Cancel

- Set `status: canceled`, `resume.pointer: done` (or `null`), `active: false` when done with it, append `history` `type: canceled`.
- Leaving a non-terminal pointer with `status: canceled` **violates** the schema invariant — always clear/terminalize the pointer.

## Relation to other skills

| Skill | Relationship |
|-------|----------------|
| `resume` | Reads `.feature.yaml` first; reconstructs program counter; derives unmet ACs via `ac_coverage` |
| `handoff` | When an active feature exists, **renders a projection** from `.feature.yaml` + `spec.md` — not a parallel SoT |
| `goal` | MAY mirror feature goal when exactly one active feature; feature ledger wins on conflict |
| `vertical-slice` | May seed slices from `spec.md` ACs; run ledger may set `feature_slug` |
| Session run ledger | Ephemeral; linked via `feature_slug` + feature `runs[]` |

## Worked example

Feature: enforce workspace disk minimum size.

**Layout**

```
.groundwork/features/workspace-disk-min-size/
  spec.md
  plan.md
  tasks.md
  .feature.yaml
```

**`spec.md` (excerpt)**

```markdown
# Workspace disk min-size

## Goal
Reject workspace images smaller than the configured minimum before boot.

## Acceptance criteria
- AC1: `image_sparse` rejects a workspace smaller than the min size
- AC2: unit tests cover the min-size boundary
- AC3: guest agent surfaces a clear error on undersized disks

## Negative scope
- No automatic grow/resize in this feature
- No UI changes outside the existing error path
```

**`.feature.yaml` (mid-flight — valid under schema, invariant branch B)**

```yaml
version: 1
id: feat_workspace-disk-min-size
slug: workspace-disk-min-size
active: true
status: started
health: onTrack
plan_ref: .groundwork/features/workspace-disk-min-size/plan.md
spec_ref: .groundwork/features/workspace-disk-min-size/spec.md
branch: feat/workspace-disk-min-size
ac_coverage:
  AC1: [F1]
  AC2: [F1]
  AC3: [F2]
resume:
  pointer: slice:F2
  slice_id: F2
  next_actions:
    - "Implement guest agent undersized-disk error path"
    - "Add integration assertion for AC3"
  blocked_reason: null
  waiting_on: null
  updated_at: "2026-07-25T14:02:00Z"
  updated_by_session: "019f9a07-22c5-7000-8bc0-291e2980660c"
runs:
  - session_id: "019f9a07-22c5-7000-8bc0-291e2980660c"
    run_path: .groundwork/runs/019f9a07-22c5-7000-8bc0-291e2980660c.json
    started_at: "2026-07-25T13:40:00Z"
    ended_at: null
    gate_advisor: pending
    slices_completed: [F1]
history:
  - {at: "2026-07-25T13:30:00Z", session_id: "019f9a07-22c5-7000-8bc0-291e2980660c", type: created, summary: "Feature ledger created", ref: null}
  - {at: "2026-07-25T13:40:00Z", session_id: "019f9a07-22c5-7000-8bc0-291e2980660c", type: run_linked, summary: "Linked session run", ref: ".groundwork/runs/019f9a07-22c5-7000-8bc0-291e2980660c.json"}
  - {at: "2026-07-25T14:02:00Z", session_id: "019f9a07-22c5-7000-8bc0-291e2980660c", type: slice_complete, summary: "F1 image_sparse min-size + tests", ref: "F1"}
decisions:
  - {at: "2026-07-25T13:35:00Z", summary: "Min size enforced at image_sparse, not guest", adr: null}
links: {linear_project_id: null, linear_issue_ids: [], github_issue: null, github_prs: [], handoffs: []}
gate: {advisor: pending, last_verdict_at: null}
created_at: "2026-07-25T13:30:00Z"
updated_at: "2026-07-25T14:02:00Z"
created_by_session: "019f9a07-22c5-7000-8bc0-291e2980660c"
```

In this snapshot: `completed = {F1}` → AC1 and AC2 are **met**; AC3 is **unmet** (needs F2).

**Session run ledger** for that session includes `"feature_slug": "workspace-disk-min-size"`. `/resume workspace-disk-min-size` reads the sidecar first and continues slice F2.

## What NOT to Do

- Do NOT store feature state only in handoff docs or chat transcripts — handoff is a projection
- Do NOT prune or delete feature dirs when session ledgers age out
- Do NOT renumber AC IDs mid-flight
- Do NOT put secrets, tokens, or credentials in any feature file
- Do NOT create a feature ledger for trivial fast-path work
- Do NOT treat `tasks.md` checkboxes as the machine program counter — that is `.feature.yaml` `resume`
- Do NOT use non-enum `status` values (`in_progress`, `completed_acs`, etc.) — only `planned|started|paused|completed|canceled`
- Do NOT leave `resume.pointer` on a live slice when `status` is `completed` or `canceled` (breaks invariant)
- Do NOT invent field names absent from `feature.schema.json`
