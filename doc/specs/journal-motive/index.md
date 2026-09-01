---
id: "C-JOURNAL-MOTIVE"
type: "moc"
title: "Journal and Motive Lifecycle"
summary: "Journal CLI surface, motive on-disk layout, DECISION authoring contract, ticket durability, and MAP.md as the ambient human read path."
parent: "C-GROUNDWORK"
status: "draft"
---

# Journal and Motive Lifecycle

> This concept covers the operational layer that sits **above** the DAG store: the journal CLI command surface, the on-disk motive directory structure, the DECISION event authoring contract (including known divergences), ticket durability rules, MAP.md as the ambient human read path, archive gating, and the last_pause derivation seam. The underlying typed DAG model and fold semantics are specified in [[motive-dag/index]] and are not restated here.

---

## Boundary with C-MOTIVE-DAG

[`C-MOTIVE-DAG`](../motive-dag/index.md) specifies the internal representation: the node/edge schema, fold primitives, tamper-seal, and lossless replay contract. This concept (`C-JOURNAL-MOTIVE`) specifies the **CLI and filesystem contract** that operators and agents interact with: what commands exist, what they accept, what they write to disk, and where they diverge from their intended invariants.

Do not look here for DAG schema or fold semantics. Do not look at `C-MOTIVE-DAG` for CLI surface, ticket durability, or archive gating.

---

## Scope

- Journal CLI top-level command surface (which commands exist and which do not)
- Motive on-disk directory structure (`.groundwork/motives/<slug>/`)
- DECISION event authoring contract (required fields, id-collision behavior, append/compile seam)
- Ticket durability and `migrate-tickets` behavior
- MAP.md as an ambient, auto-regenerated file
- Archive gating: event-based resolution overlay, `--force` escape hatch
- `last_pause` derivation: motive-map.mjs event-ordering contract

**Out of scope:** DAG fold semantics, tamper-seal, HMAC integrity — see [`C-MOTIVE-DAG`](../motive-dag/index.md).

---

## Requirements

| Id | Title | Criticality | Status |
|----|-------|-------------|--------|
| [[requirements/journal-motive-r-001-journal-cli-command-surface\|R-001]] | Journal CLI command surface | must | open |
| [[requirements/journal-motive-r-002-motive-directory-structure\|R-002]] | Motive on-disk directory structure | must | open |
| [[requirements/journal-motive-r-003-decision-event-required-fields\|R-003]] | DECISION event required fields | must | open |
| [[requirements/journal-motive-r-004-decision-id-collision-behavior\|R-004]] | DECISION id-collision behavior | should | open |
| [[requirements/journal-motive-r-005-append-compile-title-seam\|R-005]] | append/compile title vs decision seam | should | open |
| [[requirements/journal-motive-r-006-ticket-durability\|R-006]] | Ticket durability and migrate-tickets | must | open |
| [[requirements/journal-motive-r-007-map-md-ambient-file\|R-007]] | MAP.md as ambient auto-regenerated file | must | open |
| [[requirements/journal-motive-r-008-archive-gating\|R-008]] | Archive gating with event-based resolution | must | open |
| [[requirements/journal-motive-r-009-last-pause-derivation\|R-009]] | last_pause derivation event ordering | should | open |
