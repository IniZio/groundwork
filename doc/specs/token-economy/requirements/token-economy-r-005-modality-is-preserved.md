---
id: token-economy-r-005
type: requirement
concept: C-TOKEN-ECONOMY
title: "Modality is preserved"
criticality: must
verification: unverified
status: open
---

## TOKEN-ECONOMY-R-005 — Modality is preserved {#token-economy-r-005}

Compression **shall not** upgrade a modal hedge (`may`, `could`, `sometimes`, `is likely to`, `might`, `appears to`) to a stronger claim (`will`, `does`, `always`, `is`) in any prose output.

- **Why** — Hedges (`may`, `could`, `sometimes`, `is likely to`) carry the author's confidence, and confidence is content. A shorter sentence that upgrades a hedge to a fact is not a simplification — it is a different claim. False precision introduced at a gate or in a summary propagates into downstream decisions.
- **Fit criterion** — A diff shows no sentence where a modal verb or hedge phrase was replaced with a stronger form. If a hedge is present in the original, the replacement either preserves the hedge or removes the sentence entirely.
- **Verification**: unverified — a grep guard over changed files flags hunks that remove a modal hedge word and replace it with a stronger assertion in the same subject-predicate position.
- **Criticality**: must
