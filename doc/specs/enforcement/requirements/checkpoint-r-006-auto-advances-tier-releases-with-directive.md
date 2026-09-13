---
id: checkpoint-r-006
type: requirement
concept: C-ENFORCEMENT
title: AUTO_ADVANCES-tier phase transition permits session end and emits a directive naming incomplete slices
status: active
verification: verified
criticality: must
origin_decision_ref: phase-checkpoint-gate#D-4
---

## CHECKPOINT-R-006 — `AUTO_ADVANCES`-tier phase transition permits session end and emits a directive naming incomplete slices {#checkpoint-r-006}

When `checkpoint_hold` names a phase whose key matches `/^wave-\d+$/` (the stop-gate derives `AUTO_ADVANCES` from the key, not from the stored `tier` field — see CHECKPOINT-R-004), the Stop hook **shall** allow the session to end (exit 0) and **shall** emit a directive (not an advisory) naming: the recorded deliverable reference and the exact ids of all incomplete slices in the ledger. The phase is automatically advanced without requiring a human to issue `ledger checkpoint`.

- **Why** — The implementation wave phase is `AUTO_ADVANCES` by default: a completed wave transitions without human sign-off, but the operator still receives a directive that lists outstanding work. This replicates the semantic of the retired PACING-R-005 exhaustion release — session ends, directive emitted, no deadlock — but anchored to the checkpoint model rather than the wave budget.
- **Fit criterion** — With `checkpoint_hold = "wave-1"` (key matches `/^wave-\d+$/`) and two incomplete slices, the Stop hook exits 0 and its output contains a directive line naming the deliverable and both incomplete slice ids. A stored `tier: "BLOCKS"` in `gate.phases.wave-1` does not change this outcome — the key drives the decision.
- **Verification**: verified — `test/hooks/stop-gate-checkpoint.test.ts` (AC-9: AUTO_ADVANCES allows + directive); `// @verifies CHECKPOINT-R-006` annotated.
- **Criticality**: must
