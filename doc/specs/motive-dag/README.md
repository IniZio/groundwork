---
id: C-MOTIVE-DAG
type: concept
title: Motive DAG Model
summary: "Typed node/edge DAG as canonical primary store for motive state, built by deterministic fold over an event-sourced journal mutation log."
parent: C-GROUNDWORK
origin_decision_ref: codify-motive-dag#D-4
---

# Motive DAG Model

The motive DAG model defines the canonical typed node/edge graph that serves as the primary store for motive state. Rather than a read-only projection derived at export time, the DAG is the write-side source of truth: all motive state is expressed as mutations to an event-sourced journal stream, and the current graph is reconstructed at any point by a deterministic fold over that ordered revision log.

## Scope

This concept covers the foundational layer delivered by motive `codify-motive-dag`: the node/edge schema, event-sourced mutation vocabulary, deterministic fold semantics, tamper-seal integrity, field-level losslessness invariant, and backward-compat replay contract. The live-surface cutover — where `journal compile`, `resume`, MAP, and ledger read through the graph — is deferred to follow-on motives.

## Key Design Decisions

| Decision | Statement |
|---|---|
| D-4 | Typed DAG is the canonical primary store; this motive delivers foundation + tracer bullet only (live cutover deferred) |
| D-5 | Auditability = event-sourced: every mutation is an immutable ordered revision; current graph = deterministic fold over revision log |
| D-6 | SUPERSEDE Obsidian-Canvas as authoring surface; authoring = CLI/event mutations only, not free-form node editing |
| D-7 | Backward-compat bar = lossless deterministic replay across all 5 existing motives; zero consumer-output divergence |
| D-8 | Reconciliation map: every `VALID_TYPE` folds into exactly one of three roles (node-creating / edge-creating / attribute-mutating); adds `baseline` node kind and decision-lifecycle edges |
| D-9 | Mutation vocabulary = 5 fold primitives (`node.assert` / `node.retire` / `edge.assert` / `edge.retire` / `attr.set`); journal stream IS the revision log (no new store) |
| D-10 | Pure `assembleGraphFold` module + separate impure `graph-seal.mjs` (HMAC-SHA256 over `canonicalGraphState`) |

## Requirement → Slice → Decision Mapping

| Requirement | Covering Slices | Decision Refs |
|---|---|---|
| [MOTIVE-DAG-R-001](#motive-dag-r-001) | S1, S2 | D-4, D-8 |
| [MOTIVE-DAG-R-002](#motive-dag-r-002) | S2 | D-4, D-8 |
| [MOTIVE-DAG-R-003](#motive-dag-r-003) | S3 | D-5, D-9 |
| [MOTIVE-DAG-R-004](#motive-dag-r-004) | S1 | D-9, D-10 |
| [MOTIVE-DAG-R-005](#motive-dag-r-005) | S4 | D-5, D-10 |
| [MOTIVE-DAG-R-006](#motive-dag-r-006) | S2, S5 | D-7, D-8 |
| [MOTIVE-DAG-R-007](#motive-dag-r-007) | S5 | D-7 |
