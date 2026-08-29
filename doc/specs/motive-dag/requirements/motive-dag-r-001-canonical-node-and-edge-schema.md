---
id: "motive-dag-r-001"
title: "Canonical node and edge schema"
concept: "[[motive-dag/index]]"
criticality: must
verification: manual
ears_pattern: Ubiquitous
verification_method: Inspection
design: "[[design/components/node-schema]]"
status: open
source: "codify-motive-dag#D-4"
verifies: "S1, S2"
---

## Statement

The motive DAG model **shall** define a typed node schema whose legal `type` values are exactly the node kinds enumerated in `hooks/lib/motive-graph.mjs` plus the `baseline` kind (named revision pointer, introduced by D-8), and a typed edge schema whose legal `kind` values are exactly the members of `EDGE_KINDS` exported by `hooks/lib/motive-graph.mjs`, such that every node carries `id`, `type`, and `attrs`, and every edge carries `kind`, `from`, and `to`.

## Why

If the schema admits unknown node or edge kinds, the fold's reconciliation mapping (D-8) cannot be total over the event vocabulary; events that produce undeclared kinds silently insert untyped graph noise, breaking typed queries and causing the equivalence harness to miss structural divergence between the fold and the ground-truth store.

## Fit criterion

`assembleGraphFold` applied to the event corpus of all 5 existing motives produces a graph where every node's `type` is a member of the declared node-kinds set and every edge's `kind` is a member of `EDGE_KINDS`; supplying an event that would produce an undeclared kind causes `assembleGraphFold` to throw a typed error rather than silently inserting an untyped node or edge.

## Verification procedure

Inspect `assembleGraphFold` output against the declared node-kinds and `EDGE_KINDS` registry. Negative test: feed a synthetic event with undeclared kind and assert error is thrown.
