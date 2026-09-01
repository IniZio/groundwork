---
id: SPEC-TOOLING-R-003
type: requirement
concept: C-SPEC-TOOLING
title: Parent Resolution
summary: Every non-root concept's parent field must match a known concept id in the corpus.
status: draft
verification: manual
criticality: must
---

## SPEC-TOOLING-R-003 — Parent Resolution {#spec-tooling-r-003}

`spec lint` **shall** emit a `parent-resolves` violation and exit 1 when any non-root concept node's `parent` field does not match the `id` of an existing concept node in the corpus.

- **Why** — An unresolvable parent severs the concept from the navigable hierarchy. The node becomes an orphan that neither `spec tree` nor cross-reference tooling can reach from the root. Before this invariant existed, twelve prefix-mismatched requirement files were silently unreachable.
- **Fit criterion** — Given a corpus copy containing a concept node with `parent: C-NONEXISTENT`, `./bin/spec lint` exits 1 and stdout contains `parent-resolves`.
- **Verification**: manual — copy the spec tree to a temp dir, set one concept's `parent` to a nonexistent id, run `./bin/spec lint`, confirm exit 1 and the violation keyword.
- **Criticality**: must
