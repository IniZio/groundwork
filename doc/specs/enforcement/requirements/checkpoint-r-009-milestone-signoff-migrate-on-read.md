---
id: checkpoint-r-009
type: requirement
concept: C-ENFORCEMENT
title: pacing.milestone_signoff is migrated on read into gate.phases.completion by ledger checkpoint
status: active
verification: unverified
criticality: must
origin_decision_ref: phase-checkpoint-gate#D-5
---

## CHECKPOINT-R-009 — `pacing.milestone_signoff` is migrated on read into `gate.phases.completion` by `ledger checkpoint` {#checkpoint-r-009}

When `ledger checkpoint` is invoked on a ledger that carries `pacing.milestone_signoff` but no `gate.phases.completion`, the command **shall** copy the milestone sign-off into `gate.phases.completion` (with `tier: "BLOCKS"`, `deliverable: "milestone"`, and the sign-off's `verdict`, `verified_by`, and `verified_at`) before writing the requested checkpoint. In-flight ledgers sealed before `gate.phases` existed **shall** still verify against their existing seal without re-sealing.

- **Why** — `pacing.milestone_signoff` and `pacing.milestone_artifacts` remain in the `pacing` ledger namespace for in-flight and historical runs; they are not migrated to `gate.phases` eagerly. The migrate-on-read ensures the stop-gate sees a consistent `gate.phases.completion` regardless of which write path recorded the original sign-off, without requiring a one-time migration of all existing ledgers. Back-compat seal preservation prevents wedged sessions when the seal was computed before `gate.phases` was introduced.
- **Fit criterion** — A ledger with `pacing.milestone_signoff = {verdict:"APPROVE", verified_by:"alice", verified_at:"..."}` and no `gate.phases.completion`, after `ledger checkpoint --phase design ...` is run, carries `gate.phases.completion = {tier:"BLOCKS", verdict:"APPROVE", verified_by:"alice", deliverable:"milestone"}`. A ledger sealed under the old scheme (no `gate.phases`) still passes seal verification without a new `ledger checkpoint` call.
- **Verification**: unverified — backing tests in `test/hooks/checkpoint.test.ts` and `test/hooks/sealed-gate-vectors.test.ts`; `// @verifies` annotation pending test-file update.
- **Criticality**: must
