# Fold Event Flow — How a journal event mutates the graph

This flow traces one event from journal append through `assembleGraphFold` to the resulting graph mutation. The DECISION event is used as the running example because it exercises the most fields.

---

## Step-by-step: DECISION event through the fold

```
1. Journal append
   └─ Hook or CLI writes {"type":"DECISION","ts":T,"data":{"id":"D-4","title":"...","statement":"..."}}
      to .groundwork/motives/<slug>/*.jsonl via O_APPEND.

2. Caller assembles the ordered event stream
   └─ readOrderedEvents(slug) → Event[]  (sorted by ts, then shard order)
      Caller may pass opts.at = T to slice at a timestamp.

3. assembleGraphFold(events, { at?, charter?, groundTruth? })
   ├─ Pure function — no I/O imports.
   ├─ For each event (in order):
   │   a. Look up event.type in the D-8 reconciliation table → role
   │   b. Dispatch to the role handler:
   │       DECISION → node-creating role
   │       handler calls: node.assert("decision", "D-4", { title, statement, ... })
   │   c. node.assert upserts the node:
   │       if node "D-4" absent → create { id: "D-4", type: "decision", attrs: {...} }
   │       if node "D-4" present → merge attrs (later event wins per field)
   │   d. handler also calls: edge.assert("anchors", objectiveNodeId, "D-4")
   │       upserts the anchors edge from the motive objective to this decision
   └─ Returns GraphDocument { schema_version: 1, motive, nodes, edges }

4. Downstream consumers
   ├─ projectFoldGraph(graph) → projected view for journal compile / MAP
   └─ graph-seal.mjs computes HMAC-SHA256 seal over canonicalGraphState(graph)
```

---

## DECISION event — field-to-attr mapping

| Event field | Fold primitive | Graph location |
|-------------|---------------|----------------|
| `data.id` | `node.assert` id param | `node.id` |
| `data.title` | `attr.set` | `node.attrs.title` |
| `data.statement` | `attr.set` | `node.attrs.statement` |
| `data.supersedes` | `edge.assert("supersedes", ...)` | edge |
| `ts` | `attr.set` | `node.attrs.ts` |

Every field is explicitly mapped — no `default:` fallthrough (R-006).

---

## opts.at — time-travel slicing

Passing `opts.at = T` causes the fold to process only events with `ts <= T`:

```
events = [e1(ts=100), e2(ts=200), e3(ts=300)]
assembleGraphFold(events, { at: 200 })
  → processes e1, e2 only
  → returns graph as it was at ts=200
```

This enables point-in-time graph inspection without replaying from an external snapshot.

---

## Determinism guarantee

The fold is a pure function: same inputs → same output, always. The banned import list (`node:fs`, `node:child_process`, `Date`, `Math.random`, `process.env`) is enforced by R-004. Double-calling with the same arguments must produce deep-equal graphs.
