---
id: pacing-r-010
type: requirement
concept: C-ENFORCEMENT
title: Milestone sign-off composes with awaiting_human; the two mechanisms must not conflict
status: open
verification: verified
criticality: must
design: "[[design/flows/stop-gate-decision-path]]"
---

## PACING-R-010 — Milestone sign-off composes with awaiting_human; the two mechanisms must not conflict {#pacing-r-010}

When the completion checkpoint gate is waiting for human sign-off (`pacing.milestone_signoff` absent or `gate.phases.completion` absent/non-APPROVE), the orchestrator **shall** be able to set `awaiting_human = true` (via `ledger await-human --token <write_token>`) to suppress the stop-gate nag while the human decides. The `awaiting_human` hold does not release the completion gate — it only suppresses the nagging. Clearing `awaiting_human` (via `--clear`) resumes normal enforcement. Setting the hold AND receiving `milestone_signoff.verdict = "APPROVE"` **shall** remain two separate write events to preserve auditability.

- **Why** — Without `awaiting_human` composition, the stop-gate would nag continuously while a milestone awaits human review. The `awaiting_human` field was introduced for this pattern (token-gated hold that pauses enforcement without bypassing it). The two-event separation preserves the audit trail: the ledger records both when the hold was set and when the sign-off arrived.
- **Fit criterion** — With `milestone_signoff` absent, setting `awaiting_human = true` causes the stop-gate to suppress the block nag. The completion gate still holds. Clearing `awaiting_human` restores normal stop-gate behavior. Receiving `milestone_signoff.verdict = "APPROVE"` releases the completion gate independently of `awaiting_human` state.
- **Verification**: verified — `test/hooks/pacing-milestone.test.ts` (`// @verifies PACING-R-010`, line 17; `describe` block at line 339) and `test/hooks/stop-gate-await-human.test.ts` (line 17) assert the composition behavior. Note: `status: open` preserved.
- **Criticality**: must
