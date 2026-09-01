---
id: "artifact-reference-slice-fields"
type: "reference"
title: "Slice Fields Reference"
tags: [reference, slice, ledger, fields]
---

# Slice Fields Reference

## Slice fields

| Field | Type | Required | CLI flag | Default | Description |
|---|---|---|---|---|---|
| `id` | string | Yes | positional | — | Unique identifier within the run (e.g. `s1`, `auth-handler`) |
| `wave` | int | No | `--wave N` | 1 | Execution wave; slices in the same wave may run in parallel |
| `status` | string | Yes | `--status` | `pending` | One of: `pending`, `in_progress`, `complete` |
| `kind` | string | No | `--kind` | `impl` | One of: `impl`, `plan`, `diagnose`, `design`, `fog` |
| `desc` | string | No | `--desc "…"` | — | Human-readable purpose of the slice |
| `blocked_by` | string[] | No | `--blocked-by a,b` | `[]` | Ids of slices that must be complete before this one starts |
| `acceptance` | string | No | `--acceptance "a;b"` | — | Semicolon-separated testable acceptance criteria |
| `ticket` | string | No | `--ticket <tid>` | — | Id of the linked ticket document (filename stem) |
| `covers_ac` | string[] | No | `--covers-ac "AC1,AC2"` | `[]` | Motive-charter acceptance-criterion ids covered by this slice |
| `decisions` | string\|string[] | No | `--decisions "D-1,D-2"` | — | Journal DECISION event ids this slice produces or is governed by |
| `completed_at` | string | No | set by `complete` | — | ISO-8601 timestamp; set automatically on `gw ledger complete` |
| `session_id` | string | No | set by `complete` | — | Id of the session that completed this slice |
| `created_by` | string | No | set at add time | — | Id of the session that created this slice |

## Slice kind vocabulary

| Kind | Pacing-exempt? | Typical use |
|---|---|---|
| `impl` | No | Production code implementation |
| `design` | No | UI/UX or architecture design |
| `plan` | Yes | Research, planning, decomposition |
| `diagnose` | Yes | Root-cause investigation |
| `fog` | Yes | Open question with unknown scope |

## Run-ledger top-level fields

| Field | Type | Description |
|---|---|---|
| `session_id` | string | Unique id for the session that created this ledger |
| `task` | string | Human-readable goal of the run |
| `slices` | Slice[] | Ordered list of work slices |
| `gate` | Gate\|null | Advisor verdict; `null` until recorded |
| `active` | boolean | `false` when run is abandoned or all slices are complete and gate recorded |
| `write_token` | string | Opaque token required by the CLI to mutate the ledger (orchestrator-only) |
| `rfc_ref` | string? | Optional path to the motivating RFC directory |

## Gate fields

| Field | Type | Description |
|---|---|---|
| `advisor` | string\|object | Verdict: `APPROVE`, `CORRECTION`, `REPLAN`, or `STOP`; may be an object `{verdict, citation, rubric}` |
| `citation` | string? | Evidence reference supporting the verdict |
| `rubric` | string? | Quality rubric applied |

## Ledger CLI quick reference

| Command | Purpose |
|---|---|
| `gw ledger add --motive <slug> <id> [flags]` | Add a new slice |
| `gw ledger set --motive <slug> <id> [flags]` | Update slice fields |
| `gw ledger complete --motive <slug> <id> [<id>…]` | Mark slices complete (requires `--token`) |
| `gw ledger rm --motive <slug> <id>` | Remove a slice |
| `gw ledger show --motive <slug> <id>` | Inspect one slice in full |
| `gw ledger view --motive <slug>` | View run summary |
| `gw ledger status --motive <slug>` | Quick progress check |
| `gw ledger gate --motive <slug> advisor APPROVE --token <t>` | Record advisor verdict |
| `gw ledger abandon --motive <slug>` | Abandon the run |

## Related requirements

- [[../../requirements/artifact-r-001-ledger-records-slice-completion|R-001]] — completed_at, session_id fields
- [[../../requirements/artifact-r-007-ticket-is-the-durable-work-object|R-007]] — ticket field
- [[../../requirements/artifact-r-010-slice-decisions-field-links-slices-to-journal-decision-events|R-010]] — decisions field
- [[../../requirements/artifact-r-012-ticket-filename-follows-nn-type-slug-convention|R-012]] — ticket id convention
