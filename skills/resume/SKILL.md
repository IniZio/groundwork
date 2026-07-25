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

## Resolve which feature

1. If `<slug>` was provided: load `.groundwork/features/<slug>/.feature.yaml`.
2. Else scan `.groundwork/features/*/.feature.yaml` for `active: true`:
   - **Exactly one** → use it.
   - **None** → tell the user no active feature exists; offer to list archived (`active: false`) or create via `feature`.
   - **Multiple** → list them (`slug`, `status`, `health`, `resume.pointer`, short goal from `spec.md`) and ask which to resume.

Prefer `active: true` features. An explicit slug may open a paused or inactive feature for inspection, but do not silently treat archived features as the default.

## Reconstruct (always, in this order)

Read `.feature.yaml` first, then the markdown it points at.

1. **Goal + unmet acceptance criteria** — from `spec.md` (via `spec_ref` or default path). List each `AC#`; mark met vs unmet using `tasks.md` / `runs[].slices_completed` / history — never invent completion.
2. **Negative scope rails** — from `spec.md` `## Negative scope` (or equivalent). These bound what not to do.
3. **Program counter** — `resume.slice_id`, `resume.next_actions`, `resume.blocked_reason`, `resume.waiting_on`, `resume.pointer`.
4. **Open slices in wave order** — from `plan.md` / `tasks.md`, with `blocked_by` / depends-on. Highlight the pointed slice.
5. **Active slice context** — `plan_ref`, `branch`, and files owned by the current slice (from plan/tasks).
6. **Last session link** — last `runs[]` row: `session_id`, `run_path`, `gate_advisor`, `slices_completed`. If `run_path` exists on disk, note incomplete slices / gate from that run ledger.
7. **Recent memory** — last ~5 `history` entries and last ~5 `decisions` (summaries only).

Present this reconstruction briefly to the user before acting.

## Then act

Branch on sidecar state:

| Condition | Action |
|-----------|--------|
| `status ∈ {completed, canceled}` or `resume.pointer: done` | Report finished/canceled; do not open impl waves. Offer archive confirm if still `active: true`. |
| `resume.blocked_reason` or `waiting_on` set | Surface **blocked** state + reason; do not silently continue impl. Ask user how to unblock or whether to REPLAN. |
| `health: offTrack` or last `gate_advisor: REPLAN` | Surface **REPLAN** — re-enter `interview` (spec wrong) or `vertical-slice` (decomposition wrong). Do not resume impl waves. |
| `status: paused` and pointer valid | Set `status: started`, append `history` `type: resumed`, then continue as below. |
| Pointer names a concrete open slice and plan still sound | **Continue that slice**: restore goal rails, open or resume a session run ledger **with `feature_slug` set** to this slug, fan out only work for the pointed slice (and unblocked same-wave peers if appropriate). |
| Pointer valid but no open session run | **Open a new run ledger** (host ledger interface / `vertical-slice`) with `feature_slug: <slug>`, `plan_ref` from the feature, slices seeded from remaining plan/ACs; append `runs[]` + `history` `type: run_linked`. |

### Run ledger link rules

- Always set optional top-level `feature_slug` on new or continued runs for this feature.
- On link/update: maintain feature `runs[]` as the authoritative cross-session index.
- On slice completion: advance `resume.*`, append `history` `type: slice_complete`, tick `tasks.md`.

## What to load vs ignore

**Load:** `.feature.yaml` → `spec.md` → `plan.md` / `tasks.md` → latest `runs[].run_path` if present → optional handoff only as secondary color.

**Do not treat as source of truth:** raw transcripts, stale handoff markdown, session-only goal files that conflict with the feature (feature wins).

## Integration

- **`feature`** — owns layout, schema, lifecycle; this skill consumes it.
- **`handoff`** — projection of the same state; writing handoff does not replace updating `.feature.yaml`.
- **`goal`** — may mirror feature goal when exactly one active feature; on conflict, feature ledger wins.
- **`vertical-slice` / implement** — continue or open slices; seed acceptance from `spec.md` ACs when decomposing.
- **Advisor REPLAN** — stop impl; route per verdict (`interview` vs `vertical-slice`).

## Minimal resume checklist

```
[ ] Resolved slug (arg | sole active | user picked)
[ ] Read .feature.yaml first
[ ] Goal + unmet ACs from spec.md
[ ] Negative scope noted
[ ] Program counter (pointer / next_actions / blocked_reason)
[ ] Open slices + blocked_by in wave order
[ ] plan_ref / branch / files for active slice
[ ] Last runs[] row + run ledger path
[ ] Last ~5 history + decisions
[ ] Act: continue slice | new run with feature_slug | surface blocked/REPLAN
```

## What NOT to Do

- Do NOT resume by grepping the transcript or re-reading a handoff as the program counter
- Do NOT open impl waves when status is completed/canceled or verdict is REPLAN
- Do NOT ignore `blocked_reason` / `waiting_on`
- Do NOT create a run ledger without `feature_slug` when resuming a feature
- Do NOT invent AC completion — only mark met from evidence in tasks/runs/history
- Do NOT use resume for trivial fast-path work that never had a feature ledger
