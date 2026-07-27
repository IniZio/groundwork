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

An RFC is the time-stamped record of WHY — it captures motivation, alternatives considered, and the design decisions behind a change. It does not authorize spec writes; the spec tree is always freely editable. Write an RFC when you are making a significant design decision that future engineers will want to trace back; skip it for small fixes or obvious changes. The `origin_rfc` field on every requirement is the traceability link from the WHAT (the requirement) back to the WHY (the decision record).

## Session journal

`.groundwork/journal/` — append-only event log sharded per session. Events are written by `hooks/journal.mjs` and carry a type from the valid set: `DECISION`, `SPEC_CHANGE`, `LINT_DRIFT`, `PROTOTYPE_RESULT`, `FAILURE`, `MILESTONE`, `TASK_COMPLETE`, `GATE`, `VERIFICATION`, `WAIVER`, `HANDOFF`, `SESSION_START`.

## Spec tree

`doc/specs/` — EARS requirements indexed by `hooks/spec.mjs` and read by the SessionStart renderer to assemble the context injection.

The spec is the durable, testable statement of WHAT the system must do. Each requirement is falsifiable and `@verifies`-backed when automated. Requirements are always written in present tense and represent current agreed behavior — not aspirations or plans. The spec tree is the source of truth for "what's expected."

## Workflow

1. Decide whether the change is significant enough to warrant a decision record. If yes, write an RFC first to capture the WHY. If not, proceed directly.
2. Edit the spec freely — no RFC authorization is required. Every new requirement should cite an `origin_rfc` tracing back to the motivating decision record.
3. Implement the change.
4. Validate with the advisor: invoke `advisor()` (the native tool, or `groundwork:advisor` if the native tool is unavailable) to verify that the work is genuinely complete — tests ran against real infrastructure, CI passed and was watched to completion, design matches spec, no obvious gaps.
