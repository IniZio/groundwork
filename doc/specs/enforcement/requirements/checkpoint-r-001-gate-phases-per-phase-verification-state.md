---
id: checkpoint-r-001
type: requirement
concept: C-ENFORCEMENT
title: gate.phases records per-phase verification state keyed by phase name
status: active
verification: unverified
criticality: must
origin_decision_ref: phase-checkpoint-gate#D-2
---

## CHECKPOINT-R-001 — `gate.phases` records per-phase verification state keyed by phase name {#checkpoint-r-001}

A run ledger **shall** carry `gate.phases` as a map from phase name to a phase-checkpoint object. Each entry **shall** include: `deliverable` (string reference), `tier` (`BLOCKS` or `AUTO_ADVANCES`), `verdict` (`APPROVE` or `REJECT`), `verified_by` (identity string), and `verified_at` (ISO-8601 timestamp). The top-level `checkpoint_hold` field **shall** name the phase currently blocking session end, or be absent when no phase is blocking.

- **Why** — A single per-phase record makes every verification event auditable and addressable by name, and lets the stop-gate evaluate one authoritative map rather than deriving state from multiple fields. `checkpoint_hold` provides a fast path for the stop-gate without requiring it to scan all phases.
- **Fit criterion** — A ledger produced by `ledger checkpoint --phase plan --verdict APPROVE --verified-by alice --deliverable charter-v1 --token <t>` carries `gate.phases.plan = {deliverable:"charter-v1", tier:"BLOCKS", verdict:"APPROVE", verified_by:"alice", verified_at:<ISO>}`. A ledger schema validation (`schemas/run-ledger.schema.json`) passes for a ledger carrying both `checkpoint_hold` and `gate.phases`.
- **Verification**: unverified — backing tests exist in `test/hooks/checkpoint.test.ts` and `test/hooks/guard-parity.test.ts`; `// @verifies` annotation linkage pending test-file update (outside T7 scope).
- **Criticality**: must
