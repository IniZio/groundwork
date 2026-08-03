---
id: C-ARTIFACT
type: concept
title: Artifact Model
summary: "The three groundwork artifact types—run ledger, session journal, and spec tree—are file-backed records that persist across sessions."
parent: C-GROUNDWORK
origin_decision_ref: plugin-cleanup#D-5
---

# Artifact Model

The artifact model covers the durable, file-backed records that groundwork creates and maintains across sessions. Three artifact types make up the model: the run ledger, the session journal, and the spec tree.

## Run ledger

`.groundwork/runs/<session_id>.json` — machine-authoritative record of a wave run. Written by the `vertical-slice` / `ultrawork` skills and updated via `hooks/ledger.mjs`. Tracks slice ids, wave assignments, completion status, and the advisor gate verdict. The Stop hook reads the ledger to gate session end.

## Session journal

`.groundwork/journal/` — append-only event log sharded per session. Events are written by `hooks/journal.mjs` and carry a type from the valid set: `DECISION`, `SPEC_CHANGE`, `LINT_DRIFT`, `PROTOTYPE_RESULT`, `FAILURE`, `MILESTONE`, `TASK_COMPLETE`, `GATE`, `VERIFICATION`, `WAIVER`, `HANDOFF`, `SESSION_START`.

## Spec tree

`doc/specs/` — EARS requirements indexed by `hooks/spec.mjs` and read by the SessionStart renderer to assemble the context injection.

The spec is the durable, testable statement of WHAT the system must do. Each requirement is falsifiable and `@verifies`-backed when automated. Requirements are always written in present tense and represent current agreed behavior — not aspirations or plans. The spec tree is the source of truth for "what's expected."

## Workflow

1. Decide whether the change is significant enough to warrant a decision record. If yes, record a decision entry in the motive's decision log to capture the WHY. If not, proceed directly.
2. Edit the spec freely. Every new requirement may cite an `origin_decision_ref` (in the form `<motive-slug>#D-<n>`) tracing back to the motivating decision.
3. Implement the change.
4. Validate with the advisor: invoke `advisor()` (the native tool, or `groundwork:advisor` if the native tool is unavailable) to verify that the work is genuinely complete — tests ran against real infrastructure, CI passed and was watched to completion, design matches spec, no obvious gaps.
