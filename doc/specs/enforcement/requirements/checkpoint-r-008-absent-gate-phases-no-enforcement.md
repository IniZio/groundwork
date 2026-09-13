---
id: checkpoint-r-008
type: requirement
concept: C-ENFORCEMENT
title: Absent gate.phases disables checkpoint enforcement; all commands and stop-gate pass through without error
status: active
verification: unverified
criticality: must
origin_decision_ref: phase-checkpoint-gate#D-5
---

## CHECKPOINT-R-008 — Absent `gate.phases` disables checkpoint enforcement; all commands and stop-gate pass through without error {#checkpoint-r-008}

When a run ledger carries no `gate.phases` field and no `checkpoint_hold`, every `ledger` subcommand and the Stop hook **shall** pass through without checkpoint-related errors or blocks. No checkpoint enforcement is applied to pre-existing ledgers that were created before this feature was introduced.

- **Why** — Every pre-existing ledger lacks `gate.phases`. Blocking those sessions would break every in-flight run at the moment of deployment. The absent-means-disabled rule is the same pattern that PACING-R-001 established for the pacing field; it provides full backward compatibility without a migration step.
- **Fit criterion** — A ledger with no `gate.phases` and no `checkpoint_hold` field passes through `ledger claim`, `ledger complete`, and the Stop hook (with all other gates satisfied) without exit 1 and without checkpoint-related output.
- **Verification**: unverified — backing tests in `test/hooks/checkpoint.test.ts` and `test/hooks/stop-gate-checkpoint.test.ts`; `// @verifies` annotation pending test-file update.
- **Criticality**: must
