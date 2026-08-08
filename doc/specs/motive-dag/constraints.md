---
type: constraints
id: C-MOTIVE-DAG
---

# Motive DAG Model — Normative Constraints

## MOTIVE-DAG-R-001 — Canonical node and edge schema {#motive-dag-r-001}

The motive DAG model **shall** define a typed node schema whose legal `type` values are exactly the node kinds enumerated in `hooks/lib/motive-graph.mjs` plus the `baseline` kind (named revision pointer, introduced by D-8), and a typed edge schema whose legal `kind` values are exactly the members of `EDGE_KINDS` exported by `hooks/lib/motive-graph.mjs`, such that every node carries `id`, `type`, and `attrs`, and every edge carries `kind`, `from`, and `to`.

- **Why** — if the schema admits unknown node or edge kinds, the fold's reconciliation mapping (D-8) cannot be total over the event vocabulary; events that produce undeclared kinds silently insert untyped graph noise, breaking typed queries and causing the equivalence harness to miss structural divergence between the fold and the ground-truth store.
- **Fit criterion** — `assembleGraphFold` applied to the event corpus of all 5 existing motives produces a graph where every node's `type` is a member of the declared node-kinds set and every edge's `kind` is a member of `EDGE_KINDS`; supplying an event that would produce an undeclared kind causes `assembleGraphFold` to throw a typed error rather than silently inserting an untyped node or edge.
- **Verification**: manual — inspect `assembleGraphFold` output against the declared node-kinds and `EDGE_KINDS` registry; negative test: feed a synthetic event with undeclared kind and assert error
- **Criticality**: must
- **Source** codify-motive-dag#D-4 · **Slices** S1, S2

## MOTIVE-DAG-R-002 — Reconciliation completeness over all event types {#motive-dag-r-002}

The motive DAG fold **shall** map every event type in `VALID_TYPES` (exported by `hooks/lib/journal-io.mjs`) to exactly one of three roles — node-creating, edge-creating, or attribute-mutating — with no event type left unmapped (total function), and no event type assigned to more than one role (disjoint partition).

- **Why** — an unmapped event type is a silent data-loss vector: journal events of that type would pass through the fold without contributing any graph state, making the resulting graph an incomplete projection of motive history rather than a lossless reconstruction; a multiply-mapped type produces non-deterministic output on replay order change.
- **Fit criterion** — the D-8 reconciliation table, as implemented, covers every member of the current `VALID_TYPES` array; a unit test enumerates `VALID_TYPES` and asserts each member appears exactly once in the role table; adding a new `VALID_TYPE` without updating the role table causes the test to fail.
- **Verification**: manual — review D-8 reconciliation table against `VALID_TYPES`; run enumeration check asserting every type appears exactly once
- **Criticality**: must
- **Source** codify-motive-dag#D-8 · **Slices** S2

## MOTIVE-DAG-R-003 — Event-sourced mutation vocabulary {#motive-dag-r-003}

The graph write surface **shall** consist of exactly five reducer primitives — `node.assert(kind, id, attrs)`, `node.retire(id, by)`, `edge.assert(kind, from, to)`, `edge.retire(kind, from, to)`, and `attr.set(nodeId, key, value)` — persisted as events to the existing O\_APPEND journal stream (no new file format, no second store), with every `VALID_TYPE` mapping to one or more of these primitives per the D-8 reconciliation table, and with `node.retire` / `edge.retire` implemented as new immutable revisions (never deleting prior events).

- **Why** — a vocabulary narrower than these five primitives cannot express every mutation a journal event implies (e.g., attribute updates require `attr.set`, retirement requires `node.retire` distinct from deletion); persisting to a second store would create a two-store drift seam (the green-slices/broken-seam failure mode) and forfeit the append-only auditability guaranteed by D-5.
- **Fit criterion** — every write-path code path in the motive DAG layer calls only these five primitives; grep of `hooks/lib/motive-graph-fold.mjs` finds no direct file I/O (no `node:fs` imports); a journal event stream replayed through `assembleGraphFold` produces the same graph as one produced by replaying the primitives in order.
- **Verification**: manual — grep `hooks/lib/motive-graph-fold.mjs` for `node:fs` (expect zero hits); review that all five primitives are present and no additional write operations appear; inspect that retire operations append new events rather than mutating existing ones
- **Criticality**: must
- **Source** codify-motive-dag#D-9 · **Slices** S3

## MOTIVE-DAG-R-004 — Deterministic fold semantics {#motive-dag-r-004}

The fold function `assembleGraphFold(orderedEvents, { at?, charter?, groundTruth? })` **shall** be a pure function: given the same ordered event array and options, it **shall** always return the same graph; it **shall not** import `node:fs`, `node:child_process`, `Date`, `Math.random`, or `process.env`; all I/O dependencies (charter data, ground-truth comparison target) **shall** be injected by callers.

- **Why** — impurity breaks time-travel (`opts.at` slicing), reproducible equivalence diffs, and unit testability without filesystem setup; a fold that reads clock time or the filesystem on each call cannot be run twice over the same events and guaranteed to produce the same result.
- **Fit criterion** — a grep of `hooks/lib/motive-graph-fold.mjs` finds zero imports of `node:fs`, `node:child_process`, `Date.now`, `new Date`, `Math.random`, and `process.env`; calling `assembleGraphFold` twice with the same arguments returns structurally identical graphs (deep-equal); `opts.at` slicing returns the graph state as of that timestamp when the event stream contains events before and after the cutoff.
- **Verification**: manual — grep `hooks/lib/motive-graph-fold.mjs` for banned imports (expect zero); assert double-call deep-equal; assert `opts.at` cutoff slicing on a synthetic stream with timestamps straddling the cutoff
- **Criticality**: must
- **Source** codify-motive-dag#D-10 · **Slices** S1

## MOTIVE-DAG-R-005 — Tamper-evident seal over the folded graph {#motive-dag-r-005}

The graph seal module `hooks/lib/graph-seal.mjs` **shall** compute and verify a tamper-evident seal over the folded graph by (1) serializing the current graph to a deterministic canonical form — nodes sorted by `id`, edges sorted by (`kind`, `from`, `to`), attributes with sorted keys — and (2) computing `HMAC-SHA256` over that canonical representation using a per-project key stored as a `.seal.key` sibling file, mirroring the pattern of `hooks/lib/gate-seal.mjs`; verification **shall** use a timing-safe comparison.

- **Why** — without a tamper-evident seal, a graph store that records audit history (D-5) cannot prove that history was not retroactively altered; the HMAC binds the graph's current state to a secret key, so any undetected edit to historical nodes or edges produces a seal mismatch — extending the sealed-gate pattern from the stop-gate ledger to the motive graph.
- **Fit criterion** — given a graph `g`, `computeSeal(canonicalGraphState(g), key)` returns a hex string; mutating any node, edge, or attribute in `g` and recomputing produces a different hex string; `verifySeal(state, key, seal)` returns `true` for the original and `false` for the mutated state; the comparison uses `timingSafeEqual` (Node.js `node:crypto`) rather than `===`.
- **Verification**: manual — unit test: compute seal, mutate one node attr, recompute, assert inequality; unit test: verify timing-safe path by inspecting that `timingSafeEqual` is called; inspect `.seal.key` sibling pattern matches `gate-seal.mjs`
- **Criticality**: must
- **Source** codify-motive-dag#D-5 · **Slices** S4

## MOTIVE-DAG-R-006 — Field-level losslessness invariant {#motive-dag-r-006}

For every event type in `VALID_TYPES`, the fold **shall** map every field present in that event's payload to a corresponding attribute, node, or edge in the folded graph, with no field silently dropped via `default:` fallthrough or ignored fallback; during the tracer phase, the set of fields consumed by the fold **shall** be a superset of the fields populated by the existing journal corpus, converging to equality as unmapped fields are resolved.

- **Why** — a fold that silently drops payload fields produces a graph that cannot reconstruct the original event stream from the graph state alone; this violates the audit guarantee of D-5 (the current graph must be a deterministic fold over the revision log, implying lossless round-trip) and would cause the backward-compat equivalence harness (S5) to pass while masking information loss.
- **Fit criterion** — for each of the 5 existing motive corpora, `assembleGraphFold` is run and the resulting graph's total attribute field count (summed across all nodes) is compared against the total populated-field count across all events; no field that appears in any event payload maps to a `default:` fallback in the fold; a static analysis step or unit test asserts that every branch in the fold's event handlers terminates with an explicit field assignment, not an empty fallthrough.
- **Verification**: manual — enumerate all event payload fields in the 5 corpora and trace each to an explicit graph attribute; assert no `default:` fallthrough exists in the fold's role-dispatch switch; verify totals converge to equality in the final tracer run
- **Criticality**: must
- **Source** codify-motive-dag#D-8 · **Slices** S2, S5

## MOTIVE-DAG-R-007 — Lossless backward-compatible replay across all existing motives {#motive-dag-r-007}

**When** the tracer bullet replays the event corpus of each of the 5 existing motives (codify-motive-dag, graph-authoring, graph-pilot, groundwork-development, sealed-gate) through `assembleGraphFold`, the `journal compile`, `resume`, and MAP consumer outputs computed from the folded graph **shall** be byte-for-byte equivalent to the outputs computed from the original journal-compile path, with zero divergence and with no hand-editing of existing event streams required.

- **Why** — a lossless bar is the only bar consistent with the event-sourced auditability decision (D-5): if replay can drop events or alter their meaning, auditability-by-construction is hollow; furthermore, any consumer-output divergence would mean the new graph model silently changes the motive's observable state, breaking user-visible continuity across sessions.
- **Fit criterion** — the equivalence harness (S5) runs both paths (journal-compile and fold-then-compile) for each of the 5 motives and produces a diff; the diff is empty for all 5 motives; the harness is run without any modification to existing `.jsonl` shard files or ticket/charter content; a non-empty diff for any motive causes the slice to be marked incomplete.
- **Verification**: manual — run equivalence harness over all 5 motive corpora; inspect diff output; confirm zero divergence lines; re-run after any fold change to detect regressions
- **Criticality**: must
- **Source** codify-motive-dag#D-7 · **Slices** S5

## MOTIVE-DAG-R-008 — Consumer-side ledger reference validation against the canonical fold {#motive-dag-r-008}

**When** a ledger operation writes or validates `covers_ac` or `decisions` fields on a slice, the ledger **shall** resolve each referenced id against the canonical event-sourced fold — confirming that every AC id and every decision id exists as a node in the current folded graph — and **shall** emit a named diagnostic identifying the field (`covers_ac` or `decisions`) and the unknown id, then exit with a nonzero status, for any dangling reference rather than silently accepting it.

- **Why** — a dangling `covers_ac` reference reports false coverage for an AC that does not exist in the canonical graph, undermining the coverage guarantee that drives release decisions; a dangling `decisions` reference breaks the rationale audit chain (the link from implementation slice back to the recorded decision), violating the audit guarantee of D-5. The canonical fold (per [MOTIVE-DAG-R-001](#motive-dag-r-001)) is the single source of truth for which AC and decision nodes exist; any consumer that bypasses it creates a consistency gap between the ledger and the graph that cannot be detected by inspecting either alone.
- **Fit criterion** — given a motive whose canonical fold contains AC node `AC-1` and decision node `D-1`, calling `ledger set <slice-id> --covers-ac "AC-999"` exits nonzero and prints a diagnostic naming `covers_ac` and `AC-999`; calling `ledger set <slice-id> --decisions "D-999"` exits nonzero and prints a diagnostic naming `decisions` and `D-999`; calling `ledger set <slice-id> --covers-ac "AC-1" --decisions "D-1"` exits zero and writes the fields; the diagnostic message is machine-readable enough for a human to identify which id is unknown and in which field.
- **Verification**: automated — unit test: construct a synthetic fold with known node ids; assert that an unknown AC id causes exit code 1 with a diagnostic naming the field and the id; assert that an unknown decision id causes exit code 1 with a diagnostic naming the field and the id; assert that valid ids in both fields cause exit code 0.
- **Criticality**: must
- **Source** live-surface-cutover#AC-4
