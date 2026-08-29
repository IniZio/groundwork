---
id: "motive-dag-r-006"
title: "Field-level losslessness invariant"
concept: "[[motive-dag/index]]"
criticality: must
verification: manual
ears_pattern: Ubiquitous
verification_method: Inspection
design: "[[design/flows/fold-event-flow]]"
status: open
source: "codify-motive-dag#D-8"
verifies: "S2, S5"
---

## Statement

For every event type in `VALID_TYPES`, the fold **shall** map every field present in that event's payload to a corresponding attribute, node, or edge in the folded graph, with no field silently dropped via `default:` fallthrough or ignored fallback; during the tracer phase, the set of fields consumed by the fold **shall** be a superset of the fields populated by the existing journal corpus, converging to equality as unmapped fields are resolved.

## Why

A fold that silently drops payload fields produces a graph that cannot reconstruct the original event stream from the graph state alone. This violates the audit guarantee of D-5 (the current graph must be a deterministic fold over the revision log, implying lossless round-trip) and would cause the backward-compat equivalence harness (S5) to pass while masking information loss.

## Fit criterion

For each of the 5 existing motive corpora, `assembleGraphFold` is run and the resulting graph's total attribute field count (summed across all nodes) is compared against the total populated-field count across all events. No field that appears in any event payload maps to a `default:` fallback in the fold. A static analysis step or unit test asserts that every branch in the fold's event handlers terminates with an explicit field assignment, not an empty fallthrough.

## Verification procedure

Enumerate all event payload fields in the 5 corpora and trace each to an explicit graph attribute. Assert no `default:` fallthrough exists in the fold's role-dispatch switch. Verify totals converge to equality in the final tracer run.
