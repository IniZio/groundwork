# Spec Index

_Generated: 2026-07-27T13:21:34.080Z_

## Artifact Model

### [ARTIFACT-R-001 — Ledger records slice completion](../artifact/requirements.md#artifact-r-001)

**When** a vertical slice is marked complete via the ledger CLI, `hooks/ledger.mjs` **shall** persist the slice id, completion timestamp, and session id to `.groundwork/runs/<session_id>.json`.

### [ARTIFACT-R-002 — RFC reference field in ledger](../artifact/requirements.md#artifact-r-002)

**Where** `--rfc <dir>` is passed at ledger init, the ledger **shall** record `rfc_ref` as an optional advisory field containing the RFC directory path.

### [ARTIFACT-R-003 — Stop hook incomplete-slice guard](../artifact/requirements.md#artifact-r-003)

**If** the Stop hook fires and the active run ledger contains any slice not marked complete, **then** the Stop hook **shall** block session end.

## Enforcement Hooks

### [ENFORCEMENT-R-001 — Impl-guard blocks orchestrator direct edits outside permitted paths](../enforcement/requirements.md#enforcement-r-001)

If an Edit or Write call is received from the orchestrator identity on a path that is not a permitted memory file or handoff document, then the enforcement hook **shall** return a deny block.

## Orchestration Model

### [ORCHESTRATION-R-001 — Orchestrator delegates non-trivial implementation](../orchestration/requirements.md#orchestration-r-001)

**When** the orchestrator classifies a task as non-trivial, the orchestrator **shall** delegate implementation to a `groundwork:general-purpose` subagent.

## Verification

### [VERIFICATION-R-001 — Stop hook blocks unverified session end](../verification/requirements.md#verification-r-001)

If the Stop hook fires and the active run ledger does not carry an advisor APPROVE verdict, then the Stop hook **shall** block session end.

### [VERIFICATION-R-002 — Orchestrator obtains advisor approval](../verification/requirements.md#verification-r-002)

When a non-trivial task is complete, the orchestrator **shall** obtain an APPROVE verdict from the advisor agent.
