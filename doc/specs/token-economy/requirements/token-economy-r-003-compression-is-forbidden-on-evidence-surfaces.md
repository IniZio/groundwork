---
id: token-economy-r-003
type: requirement
concept: C-TOKEN-ECONOMY
title: "Compression is forbidden on evidence surfaces"
criticality: must
verification: manual
status: open
---

## TOKEN-ECONOMY-R-003 — Compression is forbidden on evidence surfaces {#token-economy-r-003}

Compression **shall not** alter any of the following evidence surfaces: advisor citations; ledger entries; gate evidence; test output; `file:line` references; error text; code blocks. These surfaces must be quoted or reproduced exactly as they appear in their source.

- **Why** — Terse summaries that collapse "tests appear to pass" to "tests pass" manufacture false APPROVEs. This is a documented recurring failure in this repo (see memory entry `implementer-self-report-reliability.md`). Evidence surfaces are the ground truth against which gate verdicts are issued; any compression of them introduces distortion at the point where distortion is most costly.
- **Fit criterion** — No diff changes any advisor citation, ledger entry, gate evidence block, test output snippet, `file:line` reference, error message, or code block by removing words, shortening phrases, or substituting synonyms. The text either appears verbatim or is absent entirely.
- **Verification**: manual — reviewer checks every evidence surface in the diff against the original source; a summary of the diff is not sufficient.

  1. Identify all evidence surfaces in the diff: advisor citations, ledger JSON entries, gate evidence blocks, test output excerpts, `file:line` references, error messages, and fenced code blocks.
  2. For each, locate the original source (session transcript, ledger file, test runner output, source file).
  3. Confirm the text is reproduced verbatim or removed entirely — no words dropped, no phrases shortened, no synonyms substituted.
  4. Flag any surface where the reproduced text differs from the source, even if the difference appears minor.

- **Criticality**: must
