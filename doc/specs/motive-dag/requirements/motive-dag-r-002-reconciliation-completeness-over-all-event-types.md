---
id: "motive-dag-r-002"
title: "Reconciliation completeness over all event types"
concept: "[[motive-dag/index]]"
criticality: must
verification: manual
ears_pattern: Ubiquitous
verification_method: Test
design: "[[design/flows/fold-event-flow]]"
status: open
source: "codify-motive-dag#D-8"
verifies: "S2"
---

## Statement

The motive DAG fold **shall** map every event type in `VALID_TYPES` (exported by `hooks/lib/journal-io.mjs`) to exactly one of three roles — node-creating, edge-creating, or attribute-mutating — with no event type left unmapped (total function), and no event type assigned to more than one role (disjoint partition).

## Why

An unmapped event type is a silent data-loss vector: journal events of that type would pass through the fold without contributing any graph state, making the resulting graph an incomplete projection of motive history rather than a lossless reconstruction. A multiply-mapped type produces non-deterministic output on replay order change.

## Fit criterion

The D-8 reconciliation table, as implemented, covers every member of the current `VALID_TYPES` array. A unit test enumerates `VALID_TYPES` and asserts each member appears exactly once in the role table. Adding a new `VALID_TYPE` without updating the role table causes the test to fail.

## Verification procedure

Review the D-8 reconciliation table against `VALID_TYPES`. Run the enumeration check asserting every type appears exactly once in the role table.
