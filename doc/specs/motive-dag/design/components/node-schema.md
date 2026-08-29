# Node and Edge Schema — Anatomy

This page describes the anatomy of a graph node and a graph edge as produced by `assembleGraphFold`. It is the design-system reference for the canonical typed schema (R-001).

---

## Node anatomy

```
Node {
  id:    string                       // stable, human-readable identifier
  type:  NodeType                     // must be a member of the declared node-kinds set
  attrs: Record<string, unknown>      // all payload fields from the originating event(s)
}
```

### Legal `type` values

| type | Source | attrs (key fields) |
|------|--------|--------------------|
| `objective` | `OBJECTIVE` event | `title`, `statement`, `ts` |
| `decision` | `DECISION` event | `id`, `title`, `statement`, `ts`, `supersedes?` |
| `open-item` | `OPEN_ITEM` / `TBD` / `TBR` event | `id`, `label`, `kind`, `ts` |
| `ticket` | Ticket file ingestion | `id`, `title`, `status`, `ts` |
| `acceptance-criterion` | `AC_COVERAGE` event or charter | `id`, `title`, `ts?` |
| `slice` | Ledger slice | `id`, `status`, `wave?`, `desc?`, `ts` |
| `spec-requirement` | `doc/specs/` recursive scan | `id`, `title`, `concept`, `criticality` |
| `baseline` | `BASELINE` event (D-8) | `name`, `ts`, `sealRef` |

### Invariants

1. Every node's `type` must be a member of the declared node-kinds set — supplying an undeclared kind causes `assembleGraphFold` to throw (R-001).
2. Every node carries `id`, `type`, and `attrs` — none may be omitted.
3. `id` values are stable across folds given the same event stream (determinism guarantee, R-004).

---

## Edge anatomy

```
Edge {
  kind: EdgeKind     // must be a member of EDGE_KINDS
  from: string       // source node id
  to:   string       // target node id
}
```

### Legal `kind` values (`EDGE_KINDS`)

| kind | from type | to type | drives_layering | render | direction |
|------|-----------|---------|----------------|--------|-----------|
| `anchors` | `objective` | `decision` | true | primary | down |
| `resolved_by` | `open-item` | `decision` | false | muted | lateral |
| `graduated_to` | `open-item` | `decision` | false | muted | lateral |
| `blocked_by` | `slice` | `slice` | true | primary | down |
| `covers_ac` | `slice` | `acceptance-criterion` | false | muted | lateral |
| `slice_decision` | `slice` | `decision` | false | hidden | lateral |
| `spec_xref` | any | `spec-requirement` | false | hidden | lateral |

### Invariants

1. Every edge's `kind` must be a member of `EDGE_KINDS` — undeclared kinds cause a typed error (R-001).
2. Every edge carries `kind`, `from`, and `to` — none may be omitted.
3. `from` and `to` must be `id` values of nodes present in the same graph document.

---

## Retirement semantics

Nodes and edges are never deleted. Retirement is expressed by appending a new immutable revision event (e.g. `node.retire(id, by)`) — the original node/edge remains in the graph with a `retired: true` attr set. Consumers that render active state should filter `attrs.retired !== true`.
