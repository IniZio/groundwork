---
id: token-economy-r-005
type: requirement
concept: C-TOKEN-ECONOMY
title: "Modality is preserved"
criticality: must
verification: automated
status: open
---

## TOKEN-ECONOMY-R-005 — Modality is preserved {#token-economy-r-005}

Compression **shall not** upgrade a modal hedge (`may`, `could`, `sometimes`, `is likely to`, `might`, `appears to`) to a stronger claim (`will`, `does`, `always`, `is`) in any prose output.

- **Why** — Hedges (`may`, `could`, `sometimes`, `is likely to`) carry the author's confidence, and confidence is content. A shorter sentence that upgrades a hedge to a fact is not a simplification — it is a different claim. False precision introduced at a gate or in a summary propagates into downstream decisions.
- **Fit criterion** — A diff shows no sentence where a modal verb or hedge phrase was replaced with a stronger form. If a hedge is present in the original, the replacement either preserves the hedge or removes the sentence entirely.
- **Verification**: automated — `hooks/prose-modality-guard.mjs` (PreToolUse) intercepts Edit/Write/MultiEdit calls on prose files, uses sentence-similarity via `hooks/lib/prose-helpers.mjs` (Jaccard ≥ 0.4) to align old/new sentences, and fires an advisory when a modal hedge (`may`, `could`, `sometimes`, `is likely to`, `might`, `appears to`) is upgraded to a stronger form (`will`, `does`, `always`, `is`). Covered by `test/hooks/prose-guard-helpers-parity.test.ts` (`@verifies TOKEN-ECONOMY-R-005`), which runs the real guard entry point as a child process and asserts it fires on hedge upgrades in `.md` files and passes through code files and wholesale rewrites below the similarity threshold.
- **Criticality**: must
