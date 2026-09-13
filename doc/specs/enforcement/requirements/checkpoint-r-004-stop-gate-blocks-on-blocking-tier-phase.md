---
id: checkpoint-r-004
type: requirement
concept: C-ENFORCEMENT
title: Stop-gate blocks session end when checkpoint_hold names a BLOCKS-tier phase without APPROVE
status: active
verification: verified
criticality: must
origin_decision_ref: phase-checkpoint-gate#D-4
---

## CHECKPOINT-R-004 — Stop-gate blocks session end when `checkpoint_hold` names a BLOCKS-tier phase without APPROVE {#checkpoint-r-004}

When the Stop hook fires and the active ledger carries `checkpoint_hold`, the Stop hook **shall** re-derive the phase tier at gate-read time from the phase key: a key matching `/^wave-\d+$/` yields `AUTO_ADVANCES`; every other key yields `BLOCKS`. The stop-gate **shall not** read the stored `tier` field from `gate.phases` to make this determination — the stored field is an audit artifact only. When the derived tier is `BLOCKS` and no `verdict: "APPROVE"` is present in the phase entry, the Stop hook **shall** exit 1 and emit a message naming the outstanding phase and its declared deliverable. This closes the bypass where an orchestrator holding the write token could record `tier: "AUTO_ADVANCES"` for a non-wave-N phase to release a gate without a matching APPROVE verdict.

- **Why** — Re-deriving at read time ensures the enforcement rule cannot be subverted by writing an incorrect `tier` value into the ledger, even with a valid write token. The pattern `/^wave-\d+$/` is the single authoritative source of tier classification; the stored field exists solely so that audit consumers (MAP display, journal) can read the tier without re-applying the pattern.
- **Fit criterion** — With `checkpoint_hold = "plan"`, the Stop hook exits 1 regardless of the stored `tier` value in `gate.phases.plan`. With `checkpoint_hold = "wave-plan"` and a stored `tier: "AUTO_ADVANCES"`, the Stop hook also exits 1 (`wave-plan` does not match `/^wave-\d+$/`). With `checkpoint_hold = "wave-1"` the Stop hook exits 0 (AUTO_ADVANCES — key matches `/^wave-\d+$/`). These vectors are exercised by `test/hooks/stop-gate-checkpoint.test.ts` (AC-7 and the `wave-plan` block case).
- **Verification**: verified — `test/hooks/stop-gate-checkpoint.test.ts` (AC-7: BLOCKS-tier blocks; AC-10: `"blocks plan phase even when stored tier is AUTO_ADVANCES"` and `wave-plan` block despite stored AUTO_ADVANCES — re-derivation from key confirmed); `// @verifies CHECKPOINT-R-004` annotated. Source: `src/gw/hook/stop-gate.ts` line ~1057 (`const tier = /^wave-\d+$/.test(holdPhaseKey) ? 'AUTO_ADVANCES' : 'BLOCKS'`).
- **Criticality**: must
