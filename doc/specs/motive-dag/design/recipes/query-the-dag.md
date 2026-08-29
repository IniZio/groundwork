# How to query the motive DAG

This recipe shows how to call `assembleMotiveGraph` and traverse the resulting `GraphDocument` for common tasks.

---

## Prerequisites

```js
import { assembleMotiveGraph } from './hooks/lib/motive-graph.mjs'
```

`assembleMotiveGraph({ projectDir, slug })` assembles the full graph for a motive slug. It calls `assembleGraphFold` internally and augments with tickets and spec-requirement cross-references.

---

## Recipe 1: Get all decisions for a motive

```js
const graph = await assembleMotiveGraph({ projectDir, slug: 'codify-motive-dag' })

const decisions = graph.nodes.filter(n => n.type === 'decision')
for (const d of decisions) {
  console.log(d.id, d.attrs.title)
}
```

---

## Recipe 2: Find slices that cover a specific AC

```js
const graph = await assembleMotiveGraph({ projectDir, slug })

const coverEdges = graph.edges.filter(
  e => e.kind === 'covers_ac' && e.to === 'AC-1'
)
const sliceIds = coverEdges.map(e => e.from)
const slices = graph.nodes.filter(n => sliceIds.includes(n.id))
```

---

## Recipe 3: Time-travel to graph state at a past timestamp

Use the lower-level `assembleGraphFold` directly:

```js
import { assembleGraphFold } from './hooks/lib/motive-graph-fold.mjs'
import { readOrderedEvents } from './hooks/lib/journal-order.mjs'
import { readCharter } from './hooks/lib/motive-charter.mjs'

const events = await readOrderedEvents({ projectDir, slug })
const charter = await readCharter({ projectDir, slug })

// Get graph as it was at a specific timestamp
const pastGraph = assembleGraphFold(events, { at: 1700000000000, charter })
```

---

## Recipe 4: Find open (non-retired) nodes of a given type

```js
const openItems = graph.nodes.filter(
  n => n.type === 'open-item' && !n.attrs.retired
)
```

---

## Recipe 5: Traverse the anchors hierarchy (objective → decisions)

```js
const objective = graph.nodes.find(n => n.type === 'objective')
const anchorEdges = graph.edges.filter(
  e => e.kind === 'anchors' && e.from === objective.id
)
const topDecisions = anchorEdges.map(e =>
  graph.nodes.find(n => n.id === e.to)
)
```

---

## Notes

- All node `id` values are stable given the same event stream — safe to persist as references.
- Filter `attrs.retired !== true` to exclude retired nodes from active-state queries.
- The graph is immutable after assembly — mutate the journal, not the graph object.
