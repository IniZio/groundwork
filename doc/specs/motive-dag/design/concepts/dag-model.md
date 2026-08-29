# Motive DAG Model — What it is

The motive DAG is a **typed node/edge graph** that serves as the canonical primary store for a motive's state. Every observable fact about a motive — its objective, decisions, open items, acceptance criteria, slices, and spec-requirement cross-references — is represented as a node or edge in this graph.

---

## Graph document schema

```
GraphDocument {
  schema_version: 1
  motive: string           // motive slug
  nodes: Node[]
  edges: Edge[]
}
```

### Node

```
Node {
  id:    string            // stable identifier (e.g. "D-4", "AC-1", "slice-s1")
  type:  NodeType          // one of the legal node kinds (see below)
  attrs: Record<string, unknown>  // event-payload fields mapped here by the fold
}
```

**Legal `type` values** (enumerated in `hooks/lib/motive-graph.mjs` + `baseline` from D-8):

| type | Meaning |
|------|---------|
| `objective` | The motive's root goal node |
| `decision` | A recorded DECISION event (D-n) |
| `open-item` | A TBD/TBR open question |
| `ticket` | A work ticket document |
| `acceptance-criterion` | An AC declared in the charter or emitted by `AC_COVERAGE` |
| `slice` | A ledger slice |
| `spec-requirement` | A cross-referenced spec requirement |
| `baseline` | A named revision pointer (D-8) |

### Edge

```
Edge {
  kind: EdgeKind           // one of the legal edge kinds (see below)
  from: string             // source node id
  to:   string             // target node id
}
```

**Legal `kind` values** (`EDGE_KINDS` from `hooks/lib/motive-graph.mjs`):

| kind | Direction | Meaning |
|------|-----------|---------|
| `anchors` | objective → decision | Top of the hierarchy; drives layering |
| `resolved_by` | open-item → decision | Cross-link: which decision resolved an open item |
| `graduated_to` | open-item → decision | Cross-link: open item graduated to a decision |
| `blocked_by` | slice → slice | Dependency edge between ledger slices |
| `covers_ac` | slice → acceptance-criterion | Slice covers an AC |
| `slice_decision` | slice → decision | Slice implements a decision |
| `spec_xref` | node → spec-requirement | Cross-reference to a spec requirement |

---

## Why a DAG?

A DAG (directed acyclic graph) is the natural structure for motive state because:

1. **Hierarchy is inherent** — objectives anchor decisions, which resolve open items, which feed slices. The parent→child layering is a tree at the top and a partial order at the leaf level.
2. **Cross-links are first-class** — `resolved_by`, `spec_xref`, and `covers_ac` are lateral edges that don't create cycles (the acyclicity invariant is preserved by the fold).
3. **Typed queries are cheap** — knowing every node's `type` and every edge's `kind` means consumers can filter the graph by structure rather than scanning raw text.

---

## The graph is built by fold, not by direct write

The graph is **never written directly**. It is the output of `assembleGraphFold` — a pure function that takes an ordered stream of journal events and returns a `GraphDocument`. See [[event-sourcing]] for how the fold primitives work and [[../flows/fold-event-flow]] for the step-by-step mutation path.
