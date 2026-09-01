---
id: SPEC-TOOLING-R-002
type: requirement
concept: C-SPEC-TOOLING
title: Root Singularity
summary: Exactly one concept node may declare parent null; zero or more than one is a lint violation.
status: draft
verification: manual
criticality: must
---

## SPEC-TOOLING-R-002 — Root Singularity {#spec-tooling-r-002}

`spec lint` **shall** emit an `exactly-one-root` violation and exit 1 when the concept tree contains zero or more than one concept node that declares `parent: null` or omits the `parent` field entirely; it **shall** exit 0 when exactly one such root exists.

- **Why** — Multiple roots produce an ambiguous hierarchy; the tree renderer silently picks an arbitrary starting point and renders an incomplete or misleading structure. Zero roots produce an orphaned set of nodes with no navigation entry point.
- **Fit criterion** — Given a corpus copy containing two concept nodes both with `parent: null`, `./bin/spec lint` exits 1 and its stdout contains the string `exactly-one-root`.
- **Verification**: manual — copy the spec tree to a temp dir, add a second root concept, run `./bin/spec lint` against it, confirm exit 1 and the violation keyword.
- **Criticality**: must
