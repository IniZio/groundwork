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

## PACING-R-007 — Milestone gate releases on human-verified shippable deliverables, not wave count {#pacing-r-007}

The completion checkpoint gate **shall** hold until a human sign-off is recorded. A sign-off is written by `ledger milestone-signoff --verdict APPROVE` (which sets `pacing.milestone_signoff`) or by `ledger checkpoint --phase completion --verdict APPROVE` (which writes directly to `gate.phases.completion`). When `pacing.milestone_signoff` is present and `gate.phases.completion` is absent, `cmdCheckpoint` migrates the sign-off on read into `gate.phases.completion` so the stop-gate can evaluate a single authoritative location. A declared set of evidence artifacts (`pacing.milestone_artifacts`) must satisfy the artifact-staleness check (PACING-R-009) before the gate releases.

- **Why** — Wave/slice count pacing is a proxy for delivery checkpoints. The milestone/completion gate replaces the proxy with a direct human-verified shippable increment: the gate releases only when a named human has confirmed the named artifacts. This aligns the model with the motive definition ("a shippable increment with named artifacts that a human signs off on").
- **Fit criterion** — With `milestone_artifacts` declared and `milestone_signoff` absent (or `verdict: "REJECT"`), the stop-gate blocks session end and names the outstanding completion checkpoint. With `milestone_signoff.verdict = "APPROVE"` (or `gate.phases.completion.verdict = "APPROVE"`) present and artifacts fresh, the stop-gate releases.
- **Verification**: automated — covered by `test/hooks/pacing-milestone.test.ts` (pure-function milestone enforcement) and `test/hooks/ledger-claim-milestone-deployed.test.ts` (deployed path). Note: this requirement's full enforcement (stop-gate + claim gate) remains partially tested; `status: open` is preserved.
- **Criticality**: must
