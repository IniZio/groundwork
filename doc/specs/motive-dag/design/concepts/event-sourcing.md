# Event Sourcing in the Motive DAG

The motive DAG is **event-sourced**: the journal's O\_APPEND stream IS the revision log. The current graph state is always a deterministic fold over that stream — never a separately persisted document that can drift from history.

---

## The journal stream as revision log

Every mutable fact about a motive is written to `.groundwork/motives/<slug>/*.jsonl` shards via O\_APPEND (ordered append). Each line is a typed event:

```jsonl
{"type":"DECISION","ts":1700000000000,"data":{"id":"D-4","title":"...",...}}
{"type":"AC_COVERAGE","ts":1700000001000,"data":{"ac":"AC-1","slice":"s1",...}}
```

Events are **immutable once written** — the log is append-only. Retirement (archiving a node or edge) is expressed by appending a new event, not by deleting an old one.

---

## The five fold primitives

`assembleGraphFold` processes each event through a reconciliation table (D-8) that assigns every `VALID_TYPE` to one of three roles. Each role uses a subset of five fold primitives to mutate the in-memory graph:

| Primitive | Signature | Effect |
|-----------|-----------|--------|
| `node.assert` | `(kind, id, attrs)` | Upsert a node — create if absent, merge attrs if present |
| `node.retire` | `(id, by)` | Mark a node retired; append immutable revision (no deletion) |
| `edge.assert` | `(kind, from, to)` | Upsert an edge |
| `edge.retire` | `(kind, from, to)` | Mark an edge retired; append immutable revision |
| `attr.set` | `(nodeId, key, value)` | Set one attribute on an existing node |

No other write operation exists in the fold layer. This makes the mutation vocabulary closed and auditable.

---

## Three fold roles (D-8 reconciliation table)

| Role | Primitives used | Example VALID_TYPE |
|------|-----------------|--------------------|
| Node-creating | `node.assert` | `DECISION`, `OBJECTIVE`, `OPEN_ITEM` |
| Edge-creating | `edge.assert` | `AC_COVERAGE`, `SLICE_DECISION` |
| Attribute-mutating | `attr.set` | `STATUS_UPDATE`, `GRADUATED` |

Every `VALID_TYPE` is assigned to **exactly one** role (total, disjoint partition — see R-002).

---

## Purity constraint

`assembleGraphFold` is a pure function — given the same ordered event array and options, it always returns the same graph. It imports no I/O modules. All dependencies (charter data, ground-truth comparison target) are injected by callers. This enables:

- **Time-travel** — pass `opts.at` to get the graph state at any past timestamp.
- **Reproducible diffs** — run twice, get the same result, diff is empty.
- **Unit testing without filesystem setup** — pass a synthetic event array, assert the output.

---

## Tamper-evident seal

The impure complement to the pure fold is `hooks/lib/graph-seal.mjs`, which computes an HMAC-SHA256 seal over the canonical graph state (nodes sorted by `id`, edges sorted by `kind`/`from`/`to`, attrs with sorted keys). The seal is stored alongside the graph; any retroactive mutation of an historical node or edge produces a seal mismatch. See R-005 for the full invariant.
