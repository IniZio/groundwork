# Event Type Reference

Every `VALID_TYPE` (exported by `hooks/lib/journal-io.mjs`) and its fold role in the D-8 reconciliation table. Each type maps to **exactly one** role (total, disjoint partition — R-002).

---

## Role legend

| Role | Primitives | Produces |
|------|-----------|---------|
| **N** Node-creating | `node.assert` (+ optional `edge.assert`) | A new node in the graph |
| **E** Edge-creating | `edge.assert` | A new edge between existing nodes |
| **A** Attribute-mutating | `attr.set` | Updated attrs on an existing node |

---

## Reconciliation table

| VALID_TYPE | Role | Node type produced | Edge kind produced | Key attrs mapped |
|------------|------|-------------------|--------------------|-----------------|
| `OBJECTIVE` | N | `objective` | — | `title`, `statement`, `ts` |
| `DECISION` | N | `decision` | `anchors` (objective→decision) | `id`, `title`, `statement`, `ts` |
| `DECISION` supersedes variant | N | `decision` | `supersedes` | `id`, `supersedes`, `ts` |
| `OPEN_ITEM` / `TBD` / `TBR` | N | `open-item` | — | `id`, `label`, `kind`, `ts` |
| `GRADUATED` | A | — (mutates open-item) | `graduated_to` | `retired`, `graduatedTo`, `ts` |
| `RESOLVED` | A | — (mutates open-item) | `resolved_by` | `retired`, `resolvedBy`, `ts` |
| `AC_COVERAGE` | E | `acceptance-criterion` (if absent) | `covers_ac` (slice→AC) | `ac`, `slice`, `ts` |
| `SLICE_DECISION` | E | — | `slice_decision` (slice→decision) | `slice`, `decision`, `ts` |
| `STATUS_UPDATE` | A | — (mutates slice or decision) | — | `status`, `ts` |
| `BASELINE` | N | `baseline` | — | `name`, `sealRef`, `ts` |
| `SPEC_XREF` | E | — | `spec_xref` (node→spec-requirement) | `nodeId`, `reqId`, `ts` |

> **Note:** This table reflects the D-8 design intent. The authoritative enumeration is `VALID_TYPES` in `hooks/lib/journal-io.mjs` and the reconciliation switch in `hooks/lib/motive-graph-fold.mjs`. When those diverge from this table, the source code is the authority and this table should be updated.

---

## Adding a new VALID_TYPE

1. Add the type string to `VALID_TYPES` in `hooks/lib/journal-io.mjs`.
2. Add a handler branch in `hooks/lib/motive-graph-fold.mjs` assigning it to exactly one role.
3. Update this reference table.
4. Run the R-002 enumeration test — it will fail if step 2 is missing.
