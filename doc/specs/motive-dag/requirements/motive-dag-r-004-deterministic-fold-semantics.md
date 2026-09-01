---
id: motive-dag-r-004
type: requirement
concept: C-MOTIVE-DAG
title: Deterministic fold semantics
status: open
verification: manual
criticality: must
design: "[[design/flows/fold-event-flow]]"
---

## MOTIVE-DAG-R-004 — Deterministic fold semantics {#motive-dag-r-004}

The fold function `assembleGraphFold(orderedEvents, { at?, charter?, groundTruth? })` **shall** be a pure function: given the same ordered event array and options, it **shall** always return the same graph; it **shall not** import `node:fs`, `node:child_process`, `Date`, `Math.random`, or `process.env`; all I/O dependencies (charter data, ground-truth comparison target) **shall** be injected by callers.

- **Why** — Impurity breaks time-travel (`opts.at` slicing), reproducible equivalence diffs, and unit testability without filesystem setup. A fold that reads clock time or the filesystem on each call cannot be run twice over the same events and guaranteed to produce the same result.
- **Fit criterion** — A grep of `hooks/lib/motive-graph-fold.mjs` finds zero imports of `node:fs`, `node:child_process`, `Date.now`, `new Date`, `Math.random`, and `process.env`. Calling `assembleGraphFold` twice with the same arguments returns structurally identical graphs (deep-equal). `opts.at` slicing returns the graph state as of that timestamp when the event stream contains events before and after the cutoff.
- **Verification**: manual — Grep `hooks/lib/motive-graph-fold.mjs` for banned imports (expect zero). Assert double-call deep-equal. Assert `opts.at` cutoff slicing on a synthetic stream with timestamps straddling the cutoff.
- **Criticality**: must
