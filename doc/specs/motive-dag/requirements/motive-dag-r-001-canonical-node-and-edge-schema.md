---
id: motive-dag-r-001
type: requirement
concept: C-MOTIVE-DAG
title: Canonical node and edge schema
status: open
verification: manual
criticality: must
design: "[[design/components/node-schema]]"
---

## MOTIVE-DAG-R-001 — Canonical node and edge schema {#motive-dag-r-001}

The motive DAG model **shall** define a typed node schema whose legal `type` values are exactly the node kinds enumerated in `hooks/lib/motive-graph.mjs` plus the `baseline` kind (named revision pointer, introduced by D-8), and a typed edge schema whose legal `kind` values are exactly the members of `EDGE_KINDS` exported by `hooks/lib/motive-graph.mjs`, such that every node carries `id`, `type`, and `attrs`, and every edge carries `kind`, `from`, and `to`.

- **Why** — If the schema admits unknown node or edge kinds, the fold's reconciliation mapping (D-8) cannot be total over the event vocabulary; events that produce undeclared kinds silently insert untyped graph noise, breaking typed queries and causing the equivalence harness to miss structural divergence between the fold and the ground-truth store.
- **Fit criterion** — `assembleGraphFold` applied to the event corpus of all 5 existing motives produces a graph where every node's `type` is a member of the declared node-kinds set and every edge's `kind` is a member of `EDGE_KINDS`; supplying an event that would produce an undeclared kind causes `assembleGraphFold` to throw a typed error rather than silently inserting an untyped node or edge.
- **Verification**: manual — Inspect `assembleGraphFold` output against the declared node-kinds and `EDGE_KINDS` registry. Negative test: feed a synthetic event with undeclared kind and assert error is thrown.
- **Criticality**: must
