---
id: "artifact-r-003"
title: "Stop hook incomplete-slice guard"
concept: "[[artifact/index]]"
criticality: must
verification: unverified
ears_pattern: IF-THEN
verification_method: Test
design: "[[design/flows/slice-lifecycle]]"
status: open
---

## Statement

If the Stop hook fires and the active run ledger contains any slice not marked complete, then the Stop hook shall block session end and emit a message citing the id of each incomplete slice.

## Why

The Stop hook is the final check preventing incomplete work from being left behind; if a slice is in `"pending"` or `"in_progress"` state, the session must not terminate, because the run ledger is the orchestrator's ground truth for what work remains. This guard is independent of and in addition to the advisor gate guard; both must be satisfied.

## Fit criterion

Run the Stop hook against a run ledger with one incomplete slice and confirm it emits a block citing the incomplete slice id. Complete the slice via `ledger complete <id>` and re-run the Stop hook; confirm it no longer blocks.

## Verification procedure

Automated — the Stop hook enforces this mechanically on every session-end attempt.

See also: [ARTIFACT-R-001](artifact-r-001-ledger-records-slice-completion.md)
