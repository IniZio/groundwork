---
id: checkpoint-r-005
type: requirement
concept: C-ENFORCEMENT
title: Stop-gate blocks fail-closed when seal is invalid or seal key is missing
status: active
verification: unverified
criticality: must
origin_decision_ref: phase-checkpoint-gate#D-2
---

## CHECKPOINT-R-005 — Stop-gate blocks fail-closed when seal is invalid or seal key is missing {#checkpoint-r-005}

When `checkpoint_hold` is set and the HMAC seal does not verify (tampered ledger or missing key), the Stop hook **shall** block session end (exit 1) regardless of the phase verdicts in `gate.phases`. The stop-gate **shall** never release based on unverified state.

- **Why** — If the stop-gate released on a tampered ledger, writing a fake APPROVE verdict to the JSON file would bypass the checkpoint gate entirely. Blocking on seal failure is the same fail-closed principle that protects `awaiting_human` and the advisor gate. A missing seal key is indistinguishable from tampering from the gate's perspective.
- **Fit criterion** — A ledger with `checkpoint_hold = "completion"` and a forged `gate.phases.completion.verdict = "APPROVE"` (seal invalid) causes the Stop hook to exit 1 and report a seal failure, not a release. A ledger with no seal key on disk and `checkpoint_hold` set also blocks.
- **Verification**: unverified — backing tests in `test/hooks/stop-gate-checkpoint.test.ts`; `// @verifies` annotation pending test-file update.
- **Criticality**: must
