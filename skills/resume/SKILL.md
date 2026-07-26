---
name: resume
description: Resume an active feature from its .feature.yaml program counter — reconstruct goal, open slices, and next actions without relying on transcripts or handoff docs.
disable-model-invocation: false
---

# Resume

## Purpose

Continue a multi-session feature from durable feature-ledger state. **Read `.feature.yaml` FIRST** — not the transcript, not a handoff file. Handoff is a human-readable projection; the sidecar is the program counter.

## When to Use

- User invokes `/resume` or `/resume <slug>`
- Starting a session that should pick up an in-flight feature
- After context compression when a feature ledger exists

## Machine validator + resume printer

A Wave-2 CLI validates sidecars and emits the same briefing this skill describes:

```bash
node hooks/feature.mjs validate <path>   # .feature.yaml file OR feature dir
node hooks/feature.mjs resume <slug>     # .groundwork/features/<slug>/
```

| Command | Behavior |
|---------|----------|
| `validate <path>` | Validates against `feature.schema.json` + the terminal/active `oneOf` invariant. Prints `OK` or field-named errors. Exit `0` valid / `1` invalid. |
| `resume <slug>` | Loads `.groundwork/features/<slug>/.feature.yaml` (+ `spec.md` / `plan.md` / `tasks.md`), validates, prints the resume briefing (goal, AC met/unmet, program counter, next actions, null/`run_path` notes). Exit `0`/`1`. |

**Recommendations:**

- Run `validate` after **any** write to `.feature.yaml`.
- Agents MAY use `resume <slug>` CLI output **or** follow this procedure manually — **both MUST agree** on AC met/unmet, pointer, and next actions.
- Do not invent fields; the schema is fail-closed (`additionalProperties: false`).

## Resolve which feature

1. If `<slug>` was provided: load `.groundwork/features/<slug>/.feature.yaml`.
2. Else scan `.groundwork/features/*/.feature.yaml` for `active: true`:
   - **Exactly one** → use it.
   - **None** → tell the user no active feature exists; offer to list archived (`active: false`) or create via `feature`.
   - **Multiple** → list them (`slug`, `status`, `health`, `resume.pointer`, short goal from `spec.md`) and ask which to resume.

Prefer `active: true` features. An explicit slug may open a paused or inactive feature for inspection, but do not silently treat archived features as the default.

Optional fast path: `node hooks/feature.mjs resume <slug>` performs resolve+briefing when the slug is already known.

## Reconstruct (always, in this order)

Read `.feature.yaml` first, then the markdown it points at.

### 1. Goal

From `spec.md` (via `spec_ref` or default `.groundwork/features/<slug>/spec.md`). State the goal in one short paragraph.

### 2. AC met / unmet — authoritative derivation (gap #2)

**Do not** derive AC status by parsing `plan.md` prose or `tasks.md` checkboxes alone. Those are secondary/corroborating only.

From `.feature.yaml`:

1. Read `ac_coverage` — map of `AC#` → covering slice id arrays (keys match `^AC[0-9]+$`).
2. Compute  
   `completed = ⋃ runs[*].slices_completed`  
   (optionally also union `history` rows with `type: slice_complete` and `ref` = slice id if a run row was lost).
3. For each `ACn` in `ac_coverage` (and every `AC#` listed in `spec.md`):
   - **MET** iff `ac_coverage[ACn]` is **non-empty** **and** every listed covering slice id is ∈ `completed`.
   - **UNMET** if the key is missing, the array is empty, or any covering slice is not yet in `completed`.

List each `AC#` with met/unmet and the covering slices. Never invent completion.

`tasks.md` checkboxes (`- [ ]` open; `- [X]` / `- [x]` done; task ids `F<major>.<minor>`; slice ids `F<n>`; AC ids `AC<n>`) may corroborate progress for humans — they are **not** the machine source of truth.

### 3. Negative scope rails

From `spec.md` `## Negative scope` (or equivalent). These bound what not to do.

### 4. Program counter

From `resume`:

- `pointer` — active: `slice:<id>` \| `milestone:<id>` \| `ac:<id>`; terminal: `done` or `null`
- `slice_id`, `next_actions[]`, `blocked_reason`, `waiting_on`
- `updated_at`, `updated_by_session`

### 5. Open slices in wave order

From `plan.md` / `tasks.md`, with `blocked_by` / depends-on. Highlight the pointed slice. Slice ids are `F<n>` (or plan tokens) as referenced by `resume.pointer`, `runs[].slices_completed`, and `ac_coverage` values.

### 6. Active slice context

`plan_ref`, `branch`, and files owned by the current slice (from plan/tasks).

### 7. Last session link + null `run_path` fallback (gap #4)

Read the last `runs[]` row (and earlier rows as needed): `session_id`, `run_path`, `gate_advisor`, `slices_completed`, timestamps.

**Canonical fallback when ephemeral run detail is unavailable:**

- If `run_path` is `null`, **or**
- If `run_path` is a non-null path but the file **does not exist on disk** (typical 7-day session-ledger prune),

then **do NOT fail**. Note that ephemeral run detail is unavailable and **proceed using `.feature.yaml` structural fields only**:

- `ac_coverage` + `runs[*].slices_completed` for AC met/unmet
- `resume.pointer` / `next_actions` / blocked fields for the program counter
- `history` / `decisions` / `gate` for recent memory and feature-level advisor snapshot

When `run_path` exists on disk, optionally enrich the briefing with incomplete slices / gate from that session run ledger — still treat feature `runs[]` + `resume` as authoritative if they disagree.

### 8. Recent memory

Last ~5 `history` entries and last ~5 `decisions` (summaries only).

Present this reconstruction briefly to the user before acting (or rely on `node hooks/feature.mjs resume <slug>` output when it matches this shape).

## Status enum (authoritative)

Only these five values — never `in_progress`, `completed_acs`, or other aliases:

| Value | Meaning |
|-------|---------|
| `planned` | Spec/plan written; impl not started |
| `started` | At least one session has linked a run or advanced a slice |
| `paused` | Explicitly parked; resume pointer still valid |
| `completed` | All ACs met; advisor APPROVE recorded; pointer terminal |
| `canceled` | Abandoned; pointer terminal |

## Then act

Branch on sidecar state:

| Condition | Action |
|-----------|--------|
| `status ∈ {completed, canceled}` or `resume.pointer` ∈ `{done, null}` | Report finished/canceled; do not open impl waves. Offer archive confirm if still `active: true`. |
| `resume.blocked_reason` or `waiting_on` set | Surface **blocked** state + reason; do not silently continue impl. Ask user how to unblock or whether to REPLAN. |
| `health: offTrack` or last `gate_advisor: REPLAN` | Surface **REPLAN** — re-enter `interview` (spec wrong) or `vertical-slice` (decomposition wrong). Do not resume impl waves. |
| `status: paused` and pointer valid | Set `status: started`, append `history` `type: resumed`, then continue as below. **Preserve the terminal/active invariant on write** (see below). Run `validate` after the write. |
| Pointer names a concrete open slice and plan still sound | **Continue that slice**: restore goal rails, open or resume a session run ledger **with `feature_slug` set** to this slug, fan out only work for the pointed slice (and unblocked same-wave peers if appropriate). |
| Pointer valid but no open session run | **Open a new run ledger** (host ledger interface / `vertical-slice`) with `feature_slug: <slug>`, `plan_ref` from the feature, slices seeded from remaining plan/ACs; append `runs[]` + `history` `type: run_linked`. |

### Run ledger link rules

- Always set optional top-level `feature_slug` on new or continued runs for this feature.
- On link/update: maintain feature `runs[]` as the authoritative cross-session index.
- On slice completion: advance `resume.*`, append `history` `type: slice_complete`, tick `tasks.md` (`- [ ]` → `- [X]` / `- [x]`).
- If a session ledger is later pruned, set `run_path: null` (prefer null over a stale path). Consumers must tolerate null/missing paths (gap #4).

### Invariant-on-write

Any write to `.feature.yaml` **MUST** preserve the schema `oneOf` invariant:

- **Terminal (A):** `status ∈ {completed, canceled}` **↔** `resume.pointer` is `done` or `null`/absent.
- **Active (B):** `status ∈ {planned, started, paused}` **↔** `resume.pointer` matches `^(slice|milestone|ac):[A-Za-z0-9][A-Za-z0-9_.-]*$` (names a non-complete target).

Illegal (must never write):

- `status: completed` with `resume.pointer: slice:F2`
- `status: started` with `resume.pointer: done` or `null`

`node hooks/feature.mjs validate <path>` enforces this. Run it after every sidecar write.

Do not introduce fields absent from `feature.schema.json`.

## What to load vs ignore

**Load:** `.feature.yaml` → `spec.md` → `plan.md` / `tasks.md` → latest `runs[].run_path` **if non-null and present on disk** → optional handoff only as secondary color.

**Do not treat as source of truth:** raw transcripts, stale handoff markdown, session-only goal files that conflict with the feature (feature wins), `plan.md`/`tasks.md` alone for AC met/unmet.

## Integration

- **`feature`** — owns layout, schema, lifecycle; this skill consumes it. Schema: `skills/groundwork/feature/feature.schema.json`.
- **`handoff`** — projection of the same state; writing handoff does not replace updating `.feature.yaml`.
- **`goal`** — may mirror feature goal when exactly one active feature; on conflict, feature ledger wins.
- **`vertical-slice` / implement** — continue or open slices; seed acceptance from `spec.md` ACs when decomposing; keep `ac_coverage` aligned when decomposition changes.
- **Advisor REPLAN** — stop impl; route per verdict (`interview` vs `vertical-slice`).
- **CLI** — `node hooks/feature.mjs validate|resume` (see above).

## Minimal resume checklist

```
[ ] Resolved slug (arg | sole active | user picked)
[ ] Read .feature.yaml first (or CLI: node hooks/feature.mjs resume <slug>)
[ ] Goal from spec.md
[ ] AC met/unmet from ac_coverage + ⋃ runs[*].slices_completed (NOT plan.md alone)
[ ] Negative scope noted
[ ] Program counter (pointer / next_actions / blocked_reason)
[ ] Open slices + blocked_by in wave order
[ ] plan_ref / branch / files for active slice
[ ] Last runs[] row; if run_path null or missing on disk → note + continue on sidecar fields
[ ] Last ~5 history + decisions
[ ] Act: continue slice | new run with feature_slug | surface blocked/REPLAN
[ ] Any .feature.yaml write preserves terminal/active invariant; validate after write
```

## What NOT to Do

- Do NOT resume by grepping the transcript or re-reading a handoff as the program counter
- Do NOT open impl waves when status is completed/canceled or verdict is REPLAN
- Do NOT ignore `blocked_reason` / `waiting_on`
- Do NOT create a run ledger without `feature_slug` when resuming a feature
- Do NOT invent AC completion — only mark met via `ac_coverage` + `completed` slices (gap #2)
- Do NOT fail resume when `runs[].run_path` is null or the file was pruned (gap #4)
- Do NOT write `.feature.yaml` that breaks the terminal/active invariant
- Do NOT use status aliases (`in_progress`, `completed_acs`, etc.) — only `planned|started|paused|completed|canceled`
- Do NOT invent fields absent from `feature.schema.json`
- Do NOT use resume for trivial fast-path work that never had a feature ledger
