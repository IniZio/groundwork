---
id: C-ARTIFACT
type: concept
title: Artifact Model
summary: "The four groundwork artifact types—run ledger, RFC documents, session journal, and spec tree—are file-backed records that persist across sessions."
parent: C-GROUNDWORK
origin_rfc: R-20260726-K4M2QX
---

# Artifact Model

The artifact model covers the durable, file-backed records that groundwork creates and maintains across sessions. Four artifact types make up the model: the run ledger, RFC documents, the session journal, and the spec tree.

## Run ledger

`.groundwork/runs/<session_id>.json` — machine-authoritative record of a wave run. Written by the `vertical-slice` / `ultrawork` skills and updated via `hooks/ledger.mjs`. Tracks slice ids, wave assignments, completion status, and the advisor gate verdict. The Stop hook reads the ledger to gate session end.

## RFC documents

`.groundwork/rfcs/<uid>.md` — durable decision records scoped to a named RFC identifier. Created by `hooks/rfc.mjs`. Each RFC carries a unique uid (e.g. `R-20260726-K4M2QX`) used as `origin_rfc` in requirements and journal events.

## Session journal

`.groundwork/journal/` — append-only event log sharded per session. Events are written by `hooks/journal.mjs` and carry a type from the valid set: `DECISION`, `SPEC_CHANGE`, `LINT_DRIFT`, `PROTOTYPE_RESULT`, `FAILURE`, `MILESTONE`, `TASK_COMPLETE`, `GATE`, `VERIFICATION`, `WAIVER`, `HANDOFF`, `SESSION_START`.

## Spec tree

`doc/specs/` — EARS requirements indexed by `hooks/spec.mjs` and read by the SessionStart renderer to assemble the context injection.
