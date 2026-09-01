---
id: pacing-r-010
type: requirement
concept: C-ENFORCEMENT
title: Milestone sign-off composes with awaiting_human; the two mechanisms must not conflict
status: open
verification: unverified
criticality: must
design: "[[design/flows/stop-gate-decision-path]]"
---

## PACING-R-010 — Milestone sign-off composes with awaiting_human; the two mechanisms must not conflict {#pacing-r-010}

When `pacing.policy = "milestone"` and the gate is waiting for human sign-off, the orchestrator **shall** be able to set `awaiting_human = true` (via `ledger await-human --token <write_token>`) to suppress the stop-gate nag while the human decides. The `awaiting_human` hold does not release the milestone gate — it only suppresses the nagging until the human either approves or rejects. Clearing `awaiting_human` (via `--clear`) resumes normal milestone enforcement. S7 MUST ensure that clearing the hold AND receiving `milestone_signoff.verdict = "APPROVE"` are two separate events — collapsing them into one write would lose auditability.

- **Why** — Without `awaiting_human` composition, the stop-gate would nag continuously while a milestone is awaiting human review — the nag is correct (work is incomplete) but disruptive during a legitimate wait. The `awaiting_human` field was introduced exactly for this pattern (token-gated hold that pauses enforcement without bypassing it). Milestone pacing is the most natural consumer. The two-event separation preserves the audit trail: the ledger records both when the hold was set and when the sign-off arrived, providing a complete timeline.
- **Fit criterion** — With `pacing.policy = "milestone"` and `milestone_signoff` absent, setting `awaiting_human = true` causes the stop-gate to suppress the block nag. The milestone gate itself still holds (no new units may be claimed). Clearing `awaiting_human` restores normal stop-gate behavior. Receiving `milestone_signoff.verdict = "APPROVE"` releases the milestone gate independently of the `awaiting_human` state.
- **Verification**: unverified — S7 test suite covers the interaction between `awaiting_human` and the milestone gate.
- **Criticality**: must
