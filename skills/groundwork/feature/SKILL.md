---
name: feature
description: Feature-ledger artifact convention — durable multi-session feature state under .groundwork/features/<slug>/ with markdown content plus a machine-authoritative .feature.yaml sidecar.
disable-model-invocation: true
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

`<slug>` = kebab-case feature id (e.g. `workspace-disk-min-size`).

Default split: keep `plan.md` for milestones + slice index; `tasks.md` for checkbox work. Do not duplicate the same checklist in both.

## `.feature.yaml` schema (verbatim)

Machine-authoritative. Do not invent alternate field names.

```yaml
version: 1
id: feat_<ULID>            # or feat_<slug>
slug: <slug>
active: true
status: planned            # planned|started|paused|completed|canceled  (Linear ProjectStatusType)
health: onTrack            # onTrack|atRisk|offTrack                     (Linear ProjectUpdateHealthType)
plan_ref: <path|null>
spec_ref: <path|null>
branch: <branch|null>
resume:                    # DAP continue/restartFrame metaphor — THE program counter
  pointer: slice:F2        # slice:<id> | milestone:<id> | ac:<id> | done
  slice_id: F2
  next_actions: ["...", "..."]
  blocked_reason: null
  waiting_on: null
  updated_at: <iso8601>
  updated_by_session: <sid>
runs:                      # authoritative cross-session index (Linear AgentSession list metaphor)
  - session_id: <sid>
    run_path: .groundwork/runs/<sid>.json
    started_at: <iso8601>
    ended_at: <iso8601|null>
    gate_advisor: pending  # pending|APPROVE|REPLAN|...
    slices_completed: [F1]
history:                   # append-only status pulses (Linear ProjectUpdate metaphor); last ~10
  - {at: <iso8601>, session_id: <sid>, type: created|status_update|slice_complete|slice_reopened|run_linked|decision|handoff|paused|resumed|completed|canceled, summary: "...", ref: null}
decisions:                 # MADR/Nygard-shaped pointers
  - {at: <iso8601>, summary: "...", adr: null}
links: {linear_project_id: null, linear_issue_ids: [], github_issue: null, github_prs: [], handoffs: []}
gate: {advisor: pending, last_verdict_at: null}
created_at: <iso8601>
updated_at: <iso8601>
created_by_session: <sid>
```

### Status enum

| Value | Meaning |
|-------|---------|
| `planned` | Spec/plan written; impl not started |
| `started` | At least one session has linked a run or advanced a slice |
| `paused` | Explicitly parked; resume pointer still valid |
| `completed` | All ACs met; advisor APPROVE recorded; pointer `done` |
| `canceled` | Abandoned; pointer may be `done` |

### Health enum

| Value | Meaning |
|-------|---------|
| `onTrack` | Decomposition and schedule still valid |
| `atRisk` | Slippage or open blockers; still the right plan |
| `offTrack` | Wrong decomposition or blocked hard — consider REPLAN |

## Invariants

1. Exactly one of: `resume.pointer` → a non-complete slice/milestone/AC, **or** `status ∈ {completed, canceled}`.
2. Session run ledgers MAY set optional top-level `feature_slug` (see `vertical-slice` ledger schema). Feature `runs[]` is the authoritative cross-session index; session ledgers are ephemeral.
3. Feature dir is **NOT** pruned with session ledgers (7d prune does not touch `.groundwork/features/`).
4. No secrets. PRDs stay untracked per policy — `plan_ref` / `spec_ref` may point at gitignored `docs/prds/`.
5. `spec.md` acceptance criteria use stable IDs (`AC1`, `AC2`, …) referenced by `resume.pointer: ac:<id>` and by advisor `contract_fitness`.

## Linking session runs

When opening a run ledger for work on this feature, set the optional ledger field:

```json
"feature_slug": "<slug>"
```

Default `null` when no feature is active. On link, append a `runs[]` row and a `history` entry with `type: run_linked`. When the run ends, fill `ended_at`, `gate_advisor`, and `slices_completed`.

## Lifecycle

### Create

1. Choose kebab-case `<slug>`.
2. Create `.groundwork/features/<slug>/`.
3. Write `spec.md` (goal, `AC1..`, negative_scope, links).
4. Write `plan.md` (milestones + slice index) and `tasks.md` (checkboxes).
5. Write `.feature.yaml` with `status: planned`, `active: true`, `health: onTrack`, `resume.pointer` at the first slice or AC, empty `runs[]`, and a `history` row `type: created`.
6. Optionally set session `goal` to mirror the feature goal (feature wins on conflict — see `goal` skill).

### Update (during impl)

- Advance `resume.pointer` / `slice_id` / `next_actions` when a slice completes or the program counter moves.
- Append `history` (keep last ~10) and `decisions` as needed.
- Flip `status` from `planned` → `started` on first real progress.
- Adjust `health` when risk changes.
- Tick checkboxes in `tasks.md`; keep `spec.md` ACs stable (IDs never renumber mid-flight).

### Pause

- Set `status: paused`, append `history` `type: paused`.
- Leave `resume.*` intact so `/resume` can continue.
- Do **not** set `active: false` (that is archive).

### Complete

- All ACs met and advisor-gate APPROVE on the finishing run.
- Set `status: completed`, `resume.pointer: done`, `gate.advisor: APPROVE`, append `history` `type: completed`.
- Optionally clear or mark-achieved the session goal.

### Archive (soft)

- Set `active: false` (and usually `status: completed` or `canceled`).
- Directory remains on disk; `/resume` ignores inactive features unless slug is explicit.
- Never delete the feature dir as part of session ledger prune.

### Cancel

- Set `status: canceled`, `resume.pointer: done` (or leave pointer + `blocked_reason` if useful), `active: false` when done with it, append `history` `type: canceled`.

## Relation to other skills

| Skill | Relationship |
|-------|----------------|
| `resume` | Reads `.feature.yaml` first; reconstructs program counter |
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

**`.feature.yaml` (mid-flight)**

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

**Session run ledger** for that session includes `"feature_slug": "workspace-disk-min-size"`. `/resume workspace-disk-min-size` reads the sidecar first and continues slice F2.

## What NOT to Do

- Do NOT store feature state only in handoff docs or chat transcripts — handoff is a projection
- Do NOT prune or delete feature dirs when session ledgers age out
- Do NOT renumber AC IDs mid-flight
- Do NOT put secrets, tokens, or credentials in any feature file
- Do NOT create a feature ledger for trivial fast-path work
- Do NOT treat `tasks.md` checkboxes as the machine program counter — that is `.feature.yaml` `resume`
