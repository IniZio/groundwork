---
id: SPEC-TOOLING-R-008
type: requirement
concept: C-SPEC-TOOLING
title: Tree Completeness
summary: spec tree must render all concept nodes of type concept and type moc, not concept alone.
status: draft
verification: manual
criticality: must
---

## SPEC-TOOLING-R-008 — Tree Completeness {#spec-tooling-r-008}

`spec tree` **shall** include in its output all concept nodes whose `type` field is either `concept` or `moc`; a renderer that filters on `type: concept` alone **shall not** be considered conformant.

- **Why** — The corpus root declares `type: concept`; all child concepts declare `type: moc`. A renderer filtering only on `concept` renders one node (the root) and silently drops the entire child hierarchy, making the tree appear healthy while showing nothing useful. This was the defect fixed at `hooks/spec.mjs:675`.
- **Fit criterion** — `./bin/spec tree` on the current corpus outputs at least two nodes: `C-GROUNDWORK` and at least one child node of type `moc`. Adding a new concept node with `type: moc` and verifying it appears in `spec tree` output confirms the filter is inclusive.
- **Verification**: manual — run `./bin/spec tree` and confirm both the root (`type: concept`) and child concept nodes (`type: moc`) appear. Inspect `hooks/spec.mjs:675` to confirm the filter is `n.type === 'concept' || n.type === 'moc'`.
- **Criticality**: must
