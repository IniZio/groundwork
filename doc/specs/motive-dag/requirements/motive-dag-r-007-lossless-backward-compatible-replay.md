---
id: motive-dag-r-007
type: requirement
concept: C-MOTIVE-DAG
title: Lossless backward-compatible replay across all existing motives
status: open
verification: manual
criticality: must
design: "[[design/flows/fold-event-flow]]"
---

## MOTIVE-DAG-R-007 — Lossless backward-compatible replay across all existing motives {#motive-dag-r-007}

**When** the tracer bullet replays the event corpus of each of the 5 existing motives (codify-motive-dag, graph-authoring, graph-pilot, groundwork-development, sealed-gate) through `assembleGraphFold`, the `journal compile`, `resume`, and MAP consumer outputs computed from the folded graph **shall** be byte-for-byte equivalent to the outputs computed from the original journal-compile path, with zero divergence and with no hand-editing of existing event streams required.

- **Why** — A lossless bar is the only bar consistent with the event-sourced auditability decision (D-5): if replay can drop events or alter their meaning, auditability-by-construction is hollow. Furthermore, any consumer-output divergence would mean the new graph model silently changes the motive's observable state, breaking user-visible continuity across sessions.
- **Fit criterion** — The equivalence harness (S5) runs both paths (journal-compile and fold-then-compile) for each of the 5 motives and produces a diff. The diff is empty for all 5 motives. The harness is run without any modification to existing `.jsonl` shard files or ticket/charter content. A non-empty diff for any motive causes the slice to be marked incomplete.
- **Verification**: manual — Run the equivalence harness over all 5 motive corpora. Inspect diff output. Confirm zero divergence lines. Re-run after any fold change to detect regressions.
- **Criticality**: must
