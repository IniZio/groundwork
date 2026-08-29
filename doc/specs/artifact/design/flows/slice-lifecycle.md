---
id: "artifact-flow-slice-lifecycle"
type: "flow"
title: "Slice Lifecycle"
tags: [flow, slice, ledger, lifecycle]
---

# Slice Lifecycle

## State diagram

```
         ledger add
             │
             ▼
        ┌─────────┐
        │ pending │
        └────┬────┘
             │ ledger set --status in_progress
             ▼
        ┌─────────────┐
        │ in_progress │
        └──────┬──────┘
               │ ledger complete
               ▼
          ┌──────────┐
          │ complete │  ◄── terminal
          └──────────┘

   (blocked_by list keeps a slice in pending until
    all predecessors reach complete)
```

A slice has four lifecycle states. Three are non-terminal (`pending`, `in_progress`, `blocked`) and one is terminal (`complete`).

## Step table

| Step | Command | What changes |
|---|---|---|
| 1. Claim | `ledger add <id> [--wave N] [--desc "…"] [--blocked-by a,b] [--acceptance "…"] [--ticket t] [--covers-ac "…"] [--decisions "D-1"] [--kind plan\|diagnose\|design\|impl]` | Creates slice in `pending`; `kind` defaults to `impl` |
| 2. Start | `ledger set <id> --status in_progress` | Marks active work underway |
| 3. Complete | `ledger complete <id>` | Sets `status: complete`, records `completed_at` (ISO-8601) and `session_id` |

## Invariants

- `completed_at` and `session_id` are required on `complete`; the Stop hook validates both (ARTIFACT-R-001).
- The Stop hook blocks session end if any slice is not `complete` (ARTIFACT-R-003).
- `blocked_by` ids are informational; the CLI does not mechanically prevent completing a slice whose predecessors are not yet complete (sequencing is the orchestrator's responsibility).
- Pacing: `impl` and `design` slices consume the wave budget; `plan`, `diagnose`, and `fog` kinds are exempt.

## Related notes

- [[../components/run-ledger-slice]] — field specs for each lifecycle field
- [[../recipes/add-a-ticket]] — linking a ticket at claim time
- [[../reference/slice-fields-reference]] — all fields at a glance

## Related requirements

- [[../../requirements/artifact-r-001-ledger-records-slice-completion|R-001]] — completion fields
- [[../../requirements/artifact-r-003-stop-hook-incomplete-slice-guard|R-003]] — Stop hook guard
- [[../../requirements/artifact-r-010-slice-decisions-field-links-slices-to-journal-decision-events|R-010]] — decisions linkage
