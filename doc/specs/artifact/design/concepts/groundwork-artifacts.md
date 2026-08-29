---
id: "artifact-concept-groundwork-artifacts"
type: "concept"
title: "Groundwork Artifacts"
tags: [concept, artifact, ledger, journal, spec, ticket]
---

# Groundwork Artifacts

## Overview

Groundwork maintains three artifact types as file-backed records that persist across sessions. Each has a distinct role and lifetime:

| Artifact | Location | Role |
|---|---|---|
| Run ledger | `.groundwork/runs/<session_id>.json` | Tracks slice progress for one orchestration run |
| Session journal | `.groundwork/journal/` | Append-only event log, sharded per session |
| Spec tree | `doc/specs/` | Durable, testable requirements indexed by concept |

A fourth quasi-artifact — the **ticket** — is a markdown document stored under `.groundwork/motives/<slug>/tickets/` (or a committed `tickets_dir` override) and is the cross-session work object that outlives any single run ledger.

## Run Ledger

The run ledger is a JSON file created at session start and mutated only via the `ledger` CLI. It records:

- The orchestration session's `session_id` and goal `task`
- An ordered list of `Slice` objects, each tracking one unit of work
- A `Gate` object recording the advisor verdict
- `active` flag — set `false` when the run is abandoned or complete
- `write_token` — opaque token required by the CLI to mutate the ledger (orchestrator-only)
- Optional `rfc_ref` linking to the motivating RFC directory

The run ledger is the Stop hook's ground truth: the hook blocks session end if any slice is incomplete or the advisor gate is not recorded.

## Session Journal

The journal is an append-only event log. Each event carries:

- `session_id`, `timestamp`, `event_type`, and a typed `payload` (`data` object)

Valid event types: `DECISION`, `SPEC_CHANGE`, `LINT_DRIFT`, `PROTOTYPE_RESULT`, `FAILURE`, `MILESTONE`, `TASK_COMPLETE`, `GATE`, `VERIFICATION`, `WAIVER`, `PAUSE`, `SESSION_START`.

`DECISION` events are the most structurally constrained (see ARTIFACT-R-004): they require `data.id`, `data.decision`, and `data.rationale`. The compile step (`journal compile`) merges same-id events using the `revises`/`supersedes` protocol (ARTIFACT-R-011).

## Spec Tree

`doc/specs/` contains EARS-pattern requirements organised by concept. Each concept has an `index.md` (ConceptIndexSchema), a `requirements/` folder (one file per requirement), and optionally a `design/` folder of atomic notes.

The spec tree is the durable contract for system behaviour. It is committed to the repository; it is not gitignored.

## Tickets

Tickets are markdown documents with a canonical seven-section shape (Question, Context, Evidence, Decision, Ruled out, Revisions, Links). They are the cross-session work object: where a slice tracks *what* is scheduled for *this* run, a ticket carries *why* the work exists and *what* was decided.

Tickets are linked to slices via `Slice.ticket` and to DECISION events via `Slice.decisions`.

## Related requirements

- [[../../requirements/artifact-r-001-ledger-records-slice-completion|R-001]] — ledger records slice completion
- [[../../requirements/artifact-r-004-journal-decision-events-require-structured-data-fields|R-004]] — journal DECISION structure
- [[../../requirements/artifact-r-007-ticket-is-the-durable-work-object|R-007]] — ticket shape
- [[../../requirements/artifact-r-008-no-delete-invariant-for-markdown-files|R-008]] — no-delete invariant
- [[../../requirements/artifact-r-011-decision-revises-field-merges-same-id-events|R-011]] — DECISION merge protocol
