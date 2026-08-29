---
id: "artifact-r-004"
title: "Journal DECISION events require structured data fields"
concept: "[[artifact/index]]"
criticality: must
verification: manual
ears_pattern: WHEN
verification_method: Inspection
design: "[[design/concepts/groundwork-artifacts]]"
status: open
source: "groundwork-development#D-26"
---

## Statement

When `journal append --type DECISION` is invoked, `hooks/journal.mjs` shall require `data.id`, `data.decision`, and `data.rationale` to be present in the `--data` JSON payload, default `data.alternatives` to `[]` when absent, and exit with code 2 naming the missing key when any required field is absent.

## Why

Unstructured DECISION events cannot be traced from MAP.md back to a specific decision id; a missing `id` makes the decision unaddressable in cross-references, a missing `decision` leaves the outcome undocumented, and a missing `rationale` prevents future reviewers from following the reasoning chain.

## Fit criterion

`journal append --type DECISION --motive x --msg m --data '{"id":"D-1","decision":"d","rationale":"r"}'` exits 0; omitting `id`, `decision`, or `rationale` individually exits 2 and names the missing key in the error message; a payload without `alternatives` is accepted and `alternatives` is defaulted to `[]` in the persisted event.

## Verification procedure

Manual inspection — verify that the journal CLI enforces field presence and exits 2 with the missing key named. Confirmed via code inspection of `hooks/journal.mjs` field-validation branch.
