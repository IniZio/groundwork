---
id: checkpoint-r-004
type: requirement
concept: C-ENFORCEMENT
title: Stop-gate blocks session end when checkpoint_hold names a BLOCKS-tier phase without APPROVE
status: active
verification: unverified
criticality: must
origin_decision_ref: phase-checkpoint-gate#D-4
---

## CHECKPOINT-R-004 — Stop-gate blocks session end when `checkpoint_hold` names a BLOCKS-tier phase without APPROVE {#checkpoint-r-004}

When the Stop hook fires and the active ledger carries `checkpoint_hold` naming a phase whose `gate.phases` entry has `tier: "BLOCKS"` and no `verdict: "APPROVE"`, the Stop hook **shall** exit 1 (block the session) and emit a message naming the outstanding phase and its declared deliverable. The stop-gate **shall** be fail-closed: an absent, unknown, or malformed tier value **shall** block, not release.

- **Why** — Blocking by default when the tier is unrecognised prevents a malformed ledger from silently releasing a gate that the operator intended to hold. Naming the phase and deliverable in the block message gives the operator the information needed to act without inspecting the ledger JSON.
- **Fit criterion** — With `checkpoint_hold = "plan"` and `gate.phases.plan = {tier:"BLOCKS", verdict:"REJECT"}`, the Stop hook exits 1 and names "plan" and its deliverable. With `tier: "UNKNOWN"` the Stop hook also exits 1 (fail-closed). With `tier: "AUTO_ADVANCES"` the Stop hook exits 0.
- **Verification**: unverified — backing tests in `test/hooks/stop-gate-checkpoint.test.ts`; `// @verifies` annotation pending test-file update.
- **Criticality**: must
