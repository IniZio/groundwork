---
id: "C-MOTIVE-DAG"
type: "moc"
title: "Motive DAG Model"
summary: "Typed node/edge DAG as canonical primary store for motive state, built by deterministic fold over an event-sourced journal mutation log."
status: "draft"
parent: "C-GROUNDWORK"
origin_decision_ref: "codify-motive-dag#D-4"
---

# Motive DAG Model

> This index covers the foundational layer of the motive DAG: the typed node/edge schema, event-sourced mutation vocabulary, deterministic fold semantics, tamper-seal integrity, field-level losslessness, and backward-compatible replay contract. The live-surface cutover (where `journal compile`, `resume`, MAP, and ledger read through the graph) is deferred to follow-on motives. Start at [[design/_MOC]] for the design reading path.

---

## Quick links

- [Design overview](design/_MOC.md)
- [Glossary](glossary.md)
- [Requirements](#requirements)

---

## Scope

This concept covers the foundational layer delivered by motive `codify-motive-dag`: the node/edge schema, event-sourced mutation vocabulary, deterministic fold semantics, tamper-seal integrity, field-level losslessness invariant, and backward-compat replay contract. The live-surface cutover — where `journal compile`, `resume`, MAP, and ledger read through the graph — is deferred to follow-on motives.

---

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

---

## Requirements

| Id | Title | Criticality | Status |
|----|-------|-------------|--------|
| [[requirements/motive-dag-r-001-canonical-node-and-edge-schema\|R-001]] | Canonical node and edge schema | must | open |
| [[requirements/motive-dag-r-002-reconciliation-completeness-over-all-event-types\|R-002]] | Reconciliation completeness over all event types | must | open |
| [[requirements/motive-dag-r-003-event-sourced-mutation-vocabulary\|R-003]] | Event-sourced mutation vocabulary | must | open |
| [[requirements/motive-dag-r-004-deterministic-fold-semantics\|R-004]] | Deterministic fold semantics | must | open |
| [[requirements/motive-dag-r-005-tamper-evident-seal-over-the-folded-graph\|R-005]] | Tamper-evident seal over the folded graph | must | open |
| [[requirements/motive-dag-r-006-field-level-losslessness-invariant\|R-006]] | Field-level losslessness invariant | must | open |
| [[requirements/motive-dag-r-007-lossless-backward-compatible-replay\|R-007]] | Lossless backward-compatible replay across all existing motives | must | open |
| [[requirements/motive-dag-r-008-consumer-side-ledger-reference-validation\|R-008]] | Consumer-side ledger reference validation | must | open |
