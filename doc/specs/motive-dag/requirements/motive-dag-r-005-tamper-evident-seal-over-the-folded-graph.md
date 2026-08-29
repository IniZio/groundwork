---
id: "motive-dag-r-005"
title: "Tamper-evident seal over the folded graph"
concept: "[[motive-dag/index]]"
criticality: must
verification: manual
ears_pattern: Ubiquitous
verification_method: Test
design: "[[design/components/graph-seal]]"
status: open
source: "codify-motive-dag#D-5"
verifies: "S4"
---

## Statement

The graph seal module `hooks/lib/graph-seal.mjs` **shall** compute and verify a tamper-evident seal over the folded graph by (1) serializing the current graph to a deterministic canonical form — nodes sorted by `id`, edges sorted by (`kind`, `from`, `to`), attributes with sorted keys — and (2) computing `HMAC-SHA256` over that canonical representation using a per-project key stored as a `.seal.key` sibling file, mirroring the pattern of `hooks/lib/gate-seal.mjs`; verification **shall** use a timing-safe comparison.

## Why

Without a tamper-evident seal, a graph store that records audit history (D-5) cannot prove that history was not retroactively altered. The HMAC binds the graph's current state to a secret key, so any undetected edit to historical nodes or edges produces a seal mismatch — extending the sealed-gate pattern from the stop-gate ledger to the motive graph.

## Fit criterion

Given a graph `g`, `computeSeal(canonicalGraphState(g), key)` returns a hex string. Mutating any node, edge, or attribute in `g` and recomputing produces a different hex string. `verifySeal(state, key, seal)` returns `true` for the original and `false` for the mutated state. The comparison uses `timingSafeEqual` (Node.js `node:crypto`) rather than `===`.

## Verification procedure

Unit test: compute seal, mutate one node attr, recompute, assert inequality. Unit test: verify timing-safe path by inspecting that `timingSafeEqual` is called. Inspect `.seal.key` sibling pattern matches `gate-seal.mjs`.
