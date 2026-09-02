---
id: pacing-r-001
type: requirement
concept: C-ENFORCEMENT
title: Wave-default pace policy initialised at ledger init; absent pacing disables enforcement
status: implemented
verification: automated
criticality: must
design: "[[design/reference/enforcement-hooks-reference]]"
---

## PACING-R-001 — Wave-default pace policy initialised at ledger init; absent pacing disables enforcement {#pacing-r-001}

When `ledger init` creates a new run and no `pacing` object is supplied, the ledger **shall** stamp `pacing` as `{policy:"wave", budget:1, exempt_kinds:["plan","diagnose","design","fog"]}`. When a run ledger carries no `pacing` field, the pacing module **shall** treat pacing as disabled and impose no start-time restrictions on any slice.

- **Why** — The default of one resolved wave per session enforces wayfinder-style one-checkpoint-per-session discipline while leaving intra-wave parallelism (unlimited subagent fan-out within the in-flight unit) untouched. Exempting `plan`, `diagnose`, `design`, and `fog` kind slices mirrors wayfinder exempting research tickets: these are orientation work, not delivery. The absent-means-disabled rule means every pre-existing ledger (without a `pacing` field) keeps working unchanged — no shim, no migration, full backward compatibility.
- **Fit criterion** — `ledger init` with no pacing arguments produces a ledger where `pacing.policy = "wave"`, `pacing.budget = 1`, and `pacing.exempt_kinds` equals `["plan","diagnose","design","fog"]`. A ledger file with no `pacing` field passes through `ledger claim` for any slice without a block or exit-code 1.
- **Verification**: automated — see `test/hooks/ledger-pacing.test.ts` → "stamps pacing defaults when input has no pacing field"; asserts `pacing.policy`, `pacing.budget`, and `pacing.exempt_kinds` strict equality against the default values. The pacing-absent path is covered by the `ledger claim` test cases that run against a ledger with no `pacing` field.
- **Criticality**: must
