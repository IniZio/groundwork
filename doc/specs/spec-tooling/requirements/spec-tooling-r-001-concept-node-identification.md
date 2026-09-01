---
id: SPEC-TOOLING-R-001
type: requirement
concept: C-SPEC-TOOLING
title: Concept Node Identification
summary: A concept node is any index.md or README.md carrying a frontmatter id field.
status: draft
verification: manual
criticality: must
---

## SPEC-TOOLING-R-001 — Concept Node Identification {#spec-tooling-r-001}

The spec tooling **shall** treat a file as a concept node if and only if its basename is `index.md` or `README.md` and its YAML frontmatter contains a non-blank `id` field; tooling that restricts concept node identification to `index.md` alone **shall not** be considered conformant.

- **Why** — The corpus root lives at `doc/specs/README.md` (id `C-GROUNDWORK`, type `concept`). Any tooling that checks only `index.md` will find zero roots, misreport the hierarchy as empty, and silently pass hierarchy lint. This is the defect that caused `spec tree` to render one node while looking healthy.
- **Fit criterion** — Running `./bin/spec tree` on an unmodified corpus shows `C-GROUNDWORK` as the root of the tree. Running `./bin/spec lint` on a corpus whose only concept node is a `README.md` exits 0.
- **Verification**: manual — inspect `hooks/lib/spec-io.mjs` `buildIndexData` and `walkSpecFiles`; confirm both `index.md` and `README.md` are matched as concept nodes.
- **Criticality**: must
