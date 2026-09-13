---
id: checkpoint-r-003
type: requirement
concept: C-ENFORCEMENT
title: HMAC seal folds gate.phases and checkpoint_hold; tampered verdicts invalidate the seal
status: active
verification: verified
criticality: must
origin_decision_ref: phase-checkpoint-gate#D-2
---

## CHECKPOINT-R-003 — HMAC seal folds `gate.phases` and `checkpoint_hold`; tampered verdicts invalidate the seal {#checkpoint-r-003}

The canonical HMAC state string computed by `hooks/lib/gate-seal.mjs` **shall** include `gate.phases` and `checkpoint_hold` alongside the existing fields (`gate.advisor`, `awaiting_human`, `pacing.milestone_signoff`). A phase verdict written directly to the ledger file without the write token **shall** produce a seal mismatch at the next seal-check, causing the stop-gate to block fail-closed.

- **Why** — Without seal coverage, an agent could write a fake APPROVE verdict directly to the JSON file and bypass the token gate. Folding both fields into the existing HMAC model extends the integrity guarantee to phase verdicts with no new cryptographic mechanism. Retaining `pacing.milestone_signoff` in the fold preserves back-compat for in-flight ledgers that carry only that field.
- **Fit criterion** — A ledger where `gate.phases.plan.verdict` is modified after sealing fails the seal check (exit 1 or blocked stop-gate). A ledger sealed with only `pacing.milestone_signoff` and no `gate.phases` still verifies against its original seal without re-sealing.
- **Verification**: verified — `test/hooks/gate-seal.test.ts` (checkpoint_hold in canonical string; tampered checkpoint_hold breaks verifySeal; back-compat back-fold) and `test/hooks/sealed-gate-vectors.test.ts` (AC-3); `// @verifies CHECKPOINT-R-003` annotated in both.
- **Criticality**: must
