---
id: pacing-r-007
type: requirement
concept: C-ENFORCEMENT
title: Milestone policy gates on human-verified shippable deliverables, not wave count
status: open
verification: automated
criticality: must
design: "[[design/reference/enforcement-hooks-reference]]"
---

## PACING-R-007 — Milestone policy gates on human-verified shippable deliverables, not wave count {#pacing-r-007}

When `pacing.policy` is `"milestone"`, the pacing unit is a named shippable increment rather than a wave or slice count. A milestone is defined by the set of evidence artifacts declared in `pacing.milestone_artifacts`. The pacing gate **shall** hold (block new units from starting beyond the current in-flight set) until a human sign-off is recorded in `pacing.milestone_signoff` with `verdict: "APPROVE"`. Until S7 implements milestone enforcement, the policy falls back to wave-unit counting (see `hooks/lib/pacing.mjs` S7 stub comment).

- **Why** — Wave/slice count pacing is a proxy for delivery checkpoints. Milestone pacing replaces the proxy with a direct human-verified shippable increment: the gate releases only when a named human has confirmed the named artifacts. This aligns the pacing model with the motive definition of a milestone ("a shippable increment with named artifacts that a human signs off on; pacing gate releases on human verification, not wave count").
- **Fit criterion** — With `pacing.policy = "milestone"` and `milestone_artifacts` declared but `milestone_signoff` absent (or `verdict: "REJECT"`), `ledger claim` for a slice in a new unit exits 1 and the block message names the outstanding milestone. With `milestone_signoff.verdict = "APPROVE"` present, `ledger claim` exits 0.
- **Verification**: automated — covered by tests in S7's test suite (milestone enforcement). S6 (this spec) is design-only; the fit criterion is not testable until S7 lands.
- **Criticality**: must
