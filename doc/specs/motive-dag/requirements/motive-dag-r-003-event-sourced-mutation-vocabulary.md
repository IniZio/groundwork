---
id: "motive-dag-r-003"
title: "Event-sourced mutation vocabulary"
concept: "[[motive-dag/index]]"
criticality: must
verification: manual
ears_pattern: Ubiquitous
verification_method: Inspection
design: "[[design/concepts/event-sourcing]]"
status: open
source: "codify-motive-dag#D-9"
verifies: "S3"
---

## Statement

The graph write surface **shall** consist of exactly five reducer primitives — `node.assert(kind, id, attrs)`, `node.retire(id, by)`, `edge.assert(kind, from, to)`, `edge.retire(kind, from, to)`, and `attr.set(nodeId, key, value)` — persisted as events to the existing O\_APPEND journal stream (no new file format, no second store), with every `VALID_TYPE` mapping to one or more of these primitives per the D-8 reconciliation table, and with `node.retire` / `edge.retire` implemented as new immutable revisions (never deleting prior events).

## Why

A vocabulary narrower than these five primitives cannot express every mutation a journal event implies (e.g., attribute updates require `attr.set`, retirement requires `node.retire` distinct from deletion). Persisting to a second store would create a two-store drift seam (the green-slices/broken-seam failure mode) and forfeit the append-only auditability guaranteed by D-5.

## Fit criterion

Every write-path code path in the motive DAG layer calls only these five primitives. A grep of `hooks/lib/motive-graph-fold.mjs` finds no direct file I/O (no `node:fs` imports). A journal event stream replayed through `assembleGraphFold` produces the same graph as one produced by replaying the primitives in order.

## Verification procedure

Grep `hooks/lib/motive-graph-fold.mjs` for `node:fs` (expect zero hits). Review that all five primitives are present and no additional write operations appear. Inspect that retire operations append new events rather than mutating existing ones.
