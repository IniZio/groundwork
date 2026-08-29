---
tags: [moc, motive-dag, design]
---

# Motive DAG Model — Design

Map of Content for the **Motive DAG** design folder. Start here; follow the reading path below.

---

## Start here: reading path

```
1. concepts/dag-model           — what the motive DAG is: nodes, edges, event sourcing
2. concepts/event-sourcing      — how the journal stream IS the revision log
3. flows/fold-event-flow        — how a DECISION event (or any event) mutates the graph step-by-step
4. components/node-schema       — the anatomy of a node and an edge (fields, types, invariants)
5. recipes/query-the-dag        — how to read and query the folded graph
6. reference/event-type-reference — every VALID_TYPE and its fold role
```

---

## Concepts — explanations (Diátaxis: understanding)

| Note | What it explains |
|------|-----------------|
| [[concepts/dag-model]] | What the motive DAG is — typed nodes, typed edges, the graph document schema |
| [[concepts/event-sourcing]] | How O_APPEND journal events are the revision log; append-only immutability; the five fold primitives |

---

## Flows — decision paths and state machines

| Note | What it traces |
|------|---------------|
| [[flows/fold-event-flow]] | Step-by-step: how a journal event enters `assembleGraphFold` and produces graph mutations |

---

## Components — design-system pages for concrete artefacts

| Note | What it describes |
|------|------------------|
| [[components/node-schema]] | Anatomy of a graph node (id, type, attrs) and edge (kind, from, to); legal type and kind values; invariants |

---

## Recipes — how-to guides (Diátaxis: task)

| Note | Goal |
|------|------|
| [[recipes/query-the-dag]] | How to call `assembleMotiveGraph` and traverse the result for common tasks |
| [[recipes/validate-ac-references]] | How ledger validates `covers_ac` and `decisions` references against the canonical fold |

---

## Reference

| Note | What it covers |
|------|---------------|
| [[reference/event-type-reference]] | Every `VALID_TYPE`, its fold role (node-creating / edge-creating / attribute-mutating), and resulting graph element |

---

## Requirements (out-of-folder, same concept)

| Id | Title |
|----|-------|
| [[../requirements/motive-dag-r-001-canonical-node-and-edge-schema\|R-001]] | Canonical node and edge schema |
| [[../requirements/motive-dag-r-002-reconciliation-completeness-over-all-event-types\|R-002]] | Reconciliation completeness over all event types |
| [[../requirements/motive-dag-r-003-event-sourced-mutation-vocabulary\|R-003]] | Event-sourced mutation vocabulary |
| [[../requirements/motive-dag-r-004-deterministic-fold-semantics\|R-004]] | Deterministic fold semantics |
| [[../requirements/motive-dag-r-005-tamper-evident-seal-over-the-folded-graph\|R-005]] | Tamper-evident seal over the folded graph |
| [[../requirements/motive-dag-r-006-field-level-losslessness-invariant\|R-006]] | Field-level losslessness invariant |
| [[../requirements/motive-dag-r-007-lossless-backward-compatible-replay\|R-007]] | Lossless backward-compatible replay |
| [[../requirements/motive-dag-r-008-consumer-side-ledger-reference-validation\|R-008]] | Consumer-side ledger reference validation |
