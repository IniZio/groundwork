---
id: SPEC-TOOLING-R-007
type: requirement
concept: C-SPEC-TOOLING
title: Summary Length
summary: The summary field on any spec node must be twenty-five words or fewer.
status: draft
verification: manual
criticality: should
---

## SPEC-TOOLING-R-007 — Summary Length {#spec-tooling-r-007}

The `summary` field on any spec node **shall** be at most 25 words; a summary of exactly 25 words passes, a summary of 26 or more words triggers a `summary-length` violation.

- **Why** — The summary is a one-line retrieval gloss used in index cards, search results, and the `spec tree` output. A gloss that exceeds 25 words is not a gloss — it is prose that belongs in the body. Enforcing the limit keeps the index scannable.
- **Fit criterion** — `./bin/spec lint` exits 0 for a node whose summary is exactly 25 words and exits 1 for a node whose summary is 26 words, with stdout containing `summary-length`.
- **Verification**: manual — inspect `hooks/spec-lint.mjs` for the `summary-length` invariant; confirm the word count threshold is 25 inclusive.
- **Criticality**: should
