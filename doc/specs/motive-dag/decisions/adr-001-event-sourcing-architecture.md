# ADR-001: Event-sourcing architecture for the motive DAG

**Status:** Accepted  
**Date:** 2026-08-29  
**Deciders:** Newman Chow  
**Origin:** codify-motive-dag#D-5, codify-motive-dag#D-9, codify-motive-dag#D-10

---

## Context and problem statement

The motive DAG needs a mutation model: how are nodes and edges created, updated, and retired? Two broad options exist:

1. **Mutable document store** — write the graph directly to a JSON file; updates overwrite fields in place.
2. **Event-sourced fold** — write immutable events to the existing O\_APPEND journal stream; the graph is always a deterministic fold over the full event history.

The choice affects auditability, testability, replay correctness, and drift risk.

---

## Decision drivers

- **Auditability** — every mutation to a motive's state must be traceable to a specific journal event.
- **Append-only integrity** — existing journal shards must never be modified retroactively.
- **Two-store drift risk** — a second persistent store can drift from the journal over time (the green-slices/broken-seam failure mode).
- **Testability** — the fold should be unit-testable without filesystem setup.
- **Time-travel** — the ability to reconstruct motive state at any past timestamp.

---

## Considered options

### Option A: Mutable graph document

Write a `graph.json` alongside the journal. Mutations update the file in place. A background watcher keeps it in sync with the journal.

**Pros:** Simple reads; no fold overhead on each access.  
**Cons:** Two-store drift risk (graph.json can diverge from the journal); retroactive edits are undetectable without a separate seal; watcher adds complexity and failure modes; no clean time-travel story.

### Option B: Event-sourced fold (chosen)

The journal stream IS the revision log. `assembleGraphFold` is a pure function that folds the ordered event stream into a `GraphDocument`. The fold is called on demand; no separate graph file is persisted (except an optional HMAC seal for tamper-evidence).

**Pros:** Single source of truth; append-only integrity guaranteed by journal's O\_APPEND; retroactive mutations detected by seal mismatch; pure fold is trivially unit-testable; time-travel via `opts.at`; no drift seam.  
**Cons:** Fold must be run on each access (mitigated by caching at the call site); pure function constraint requires all I/O to be injected.

---

## Decision outcome

**Chosen option: Option B — event-sourced fold.**

The journal stream IS the revision log (D-9). `assembleGraphFold` is a pure function (D-10). The only mutation vocabulary is the five fold primitives (`node.assert`, `node.retire`, `edge.assert`, `edge.retire`, `attr.set`). A tamper-evident HMAC-SHA256 seal (`graph-seal.mjs`) detects retroactive edits (D-5).

---

## Consequences

- **Good:** No drift seam between graph state and journal history. Auditability is structural, not procedural.
- **Good:** Pure fold is unit-testable with a synthetic event array; no filesystem setup required.
- **Good:** Time-travel to any past state via `opts.at` without snapshots.
- **Neutral:** Fold is O(n) in event count. For the expected corpus size (hundreds to low thousands of events per motive) this is negligible; caching at the call site handles hot paths.
- **Bad (accepted):** All I/O must be injected by callers — `assembleGraphFold` cannot call `readFile` itself. This is by design (purity constraint, R-004) and is offset by the testability benefit.
