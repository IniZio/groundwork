---
id: SPEC-TOOLING-R-004
type: requirement
concept: C-SPEC-TOOLING
title: Cycle Prohibition
summary: Following parent links from any concept node must terminate at the root; cycles are a lint violation.
status: draft
verification: manual
criticality: must
---

## SPEC-TOOLING-R-004 — Cycle Prohibition {#spec-tooling-r-004}

`spec lint` **shall** emit a `no-cycles` violation and exit 1 when following `parent` links from any concept node enters a cycle that does not terminate at the root.

- **Why** — A cycle in the parent chain causes infinite traversal in any tree renderer, linter, or coverage aggregator that walks parent links to the root. It also makes it impossible to determine depth, ancestry, or root reachability for any node in the cycle.
- **Fit criterion** — Given a corpus copy where concept A has `parent: B` and concept B has `parent: A`, `./bin/spec lint` exits 1 and stdout contains `no-cycles`.
- **Verification**: manual — copy the spec tree to a temp dir, create a two-node cycle, run `./bin/spec lint`, confirm exit 1 and the violation keyword.
- **Criticality**: must
