---
id: SPEC-TOOLING-R-009
type: requirement
concept: C-SPEC-TOOLING
title: Coverage Model
summary: Coverage is declared by verifies-scan annotations in test files; the verifies frontmatter field is slice linkage only.
status: draft
verification: manual
criticality: must
---

## SPEC-TOOLING-R-009 — Coverage Model {#spec-tooling-r-009}

The spec tooling **shall** determine test coverage of a requirement solely by scanning `test/` and `tests/` directories for `// @verifies <REQ-ID>` annotations (via `hooks/lib/verifies-scan.mjs`); the `verifies:` frontmatter field on a requirement node **shall not** be read for coverage purposes — it is slice linkage metadata only.

- **Why** — Conflating `verifies:` frontmatter (a human-authored link to a ledger slice) with `// @verifies` test annotations overstates coverage: a requirement marked `verifies: [SLICE-1]` would appear covered even if no test file carries the annotation. The `automated-unverified` lint rule fires only when `verification: automated` and no test annotation exists; frontmatter `verifies:` never satisfies it.
- **Fit criterion** — A requirement node with `verification: automated` and no `// @verifies <ID>` line in any test file triggers `automated-unverified` from `./bin/spec lint`, even when the requirement's frontmatter carries a `verifies:` field pointing to a ledger slice.
- **Verification**: manual — inspect `hooks/spec-lint.mjs` for the `automated-unverified` check; confirm it calls `verifiedIds()` from `hooks/lib/verifies-scan.mjs` and does not read the `verifies:` frontmatter field for coverage determination.
- **Criticality**: must
