# Glossary — Motive DAG Model

Terms used throughout the motive-dag concept spec and design notes.

---

**DAG** (Directed Acyclic Graph)  
A graph where edges have a direction (from → to) and there are no cycles. The motive graph is a DAG: the hierarchy flows from objective down to decisions, slices, and ACs, with lateral cross-links that do not create cycles.

---

**node**  
The primary graph unit. Every node carries three required fields: `id` (stable identifier), `type` (one of the legal node kinds), and `attrs` (a record of payload fields mapped from the originating journal event). Legal types: `objective`, `decision`, `open-item`, `ticket`, `acceptance-criterion`, `slice`, `spec-requirement`, `baseline`.

---

**edge**  
A typed directed relationship between two nodes. Every edge carries `kind` (one of the legal edge kinds from `EDGE_KINDS`), `from` (source node id), and `to` (target node id). Edges may `drives_layering` (contributing to the vertical hierarchy) or be lateral cross-links.

---

**fold**  
The operation that produces a `GraphDocument` from an ordered stream of journal events. `assembleGraphFold(orderedEvents, opts)` is the fold function. It is a pure function: same inputs → same output. The fold applies the D-8 reconciliation table to map each `VALID_TYPE` to one of three roles and the five fold primitives.

---

**event sourcing**  
An architectural pattern where state is derived by replaying an immutable ordered log of events rather than maintaining a mutable document. In the motive DAG, the O\_APPEND journal stream is the revision log and the graph is always a fold over it. No graph state is written independently of the journal.

---

**tamper-evident seal**  
An HMAC-SHA256 digest computed over the canonical graph state (nodes sorted by `id`, edges sorted by `kind`/`from`/`to`, attrs with sorted keys) using a per-project secret key stored in `.seal.key`. Any retroactive mutation of a node or edge produces a different digest, making the tampering detectable. Implemented in `hooks/lib/graph-seal.mjs`.

---

**losslessness**  
The property that every field in every journal event's payload is mapped to a corresponding attribute, node, or edge in the folded graph — nothing is silently dropped via `default:` fallthrough or ignored fallback. Losslessness is required for the fold to serve as an audit-complete reconstruction of motive history.

---

**DECISION event**  
A journal event of type `DECISION` that records a named architectural or process decision (D-n) for a motive. In the fold, a `DECISION` event is node-creating: it upserts a `decision` node and asserts an `anchors` edge from the motive objective. The set of `decision` nodes in the canonical fold is the authoritative valid set for the `decisions` field on ledger slices.

---

**motive slug**  
The short, stable, kebab-cased identifier for a motive (e.g. `codify-motive-dag`, `sealed-gate`). Used as the directory name under `.groundwork/motives/<slug>/` and as the journal shard prefix. `assembleMotiveGraph({ projectDir, slug })` uses the slug to locate the event stream.

---

**O\_APPEND**  
The journal's ordered-append write mode: events are always written to the tail of a shard file, never inserted or modified. Guarantees append-only integrity for the revision log.

---

**reconciliation table** (D-8)  
The mapping from every `VALID_TYPE` to one of three fold roles (node-creating, edge-creating, attribute-mutating). Total: every type is mapped. Disjoint: no type appears in more than one role. Implemented as a switch in `hooks/lib/motive-graph-fold.mjs`. Adding a `VALID_TYPE` without updating this table causes the R-002 enumeration test to fail.

---

**canonical fold**  
The `GraphDocument` produced by calling `assembleGraphFold` over the full ordered event corpus of a motive, with no `opts.at` cutoff. The canonical fold is the authoritative source of truth for decision nodes (valid set for `decisions` references) and AC nodes (one component of the valid set for `covers_ac` references).
