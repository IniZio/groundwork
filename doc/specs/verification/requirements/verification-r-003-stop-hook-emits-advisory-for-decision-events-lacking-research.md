---
id: "verification-r-003"
title: "Stop hook emits non-blocking advisory for DECISION events lacking research"
concept: "[[verification/index]]"
criticality: should
verification: manual
ears_pattern: IF-THEN
verification_method: Inspection
status: open
source: "groundwork-development#D-13"
---

## Statement

If the Stop hook fires and any journal DECISION event for the current motive carries `data.blast` of `"high"` or `"medium"` (case-insensitive) and no `data.research` field, then the Stop hook **shall** append a non-blocking advisory message naming the ids of those DECISION events.

## Why

High-blast decisions without documented research findings leave future reviewers unable to assess whether the choice was informed. Surfacing the gap as a non-blocking advisory at session-end gives the orchestrator the option to add research before closing, without preventing completion of sessions where research is intentionally deferred.

## Fit criterion

With a DECISION event carrying `data.blast: "high"` and no `data.research`, the Stop hook output contains an advisory line naming the decision id and the session is permitted to end (the gate is not blocked). When `data.research` is present on all high/medium-blast DECISION events, no advisory is emitted.

## Verification procedure

**Manual**

1. Create a journal DECISION event with `data.blast: "high"` and no `data.research` field.
2. Invoke the Stop hook. Confirm the output contains an advisory naming the decision id.
3. Confirm the hook does not block (exits zero or equivalent allow).
4. Add `data.research` to that event. Re-invoke the Stop hook. Confirm no advisory is emitted.
