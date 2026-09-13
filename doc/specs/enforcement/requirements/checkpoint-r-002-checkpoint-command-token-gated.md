---
id: checkpoint-r-002
type: requirement
concept: C-ENFORCEMENT
title: gw ledger checkpoint records phase verdict and is token-gated; token-less invocations rejected
status: active
verification: verified
criticality: must
origin_decision_ref: phase-checkpoint-gate#D-2
---

## CHECKPOINT-R-002 — `gw ledger checkpoint` records phase verdict and is token-gated; token-less invocations rejected {#checkpoint-r-002}

When `ledger checkpoint --phase <phase> --verdict APPROVE|REJECT --verified-by <name> --token <write_token>` is invoked, the ledger CLI **shall** write the phase entry into `gate.phases`, re-seal the ledger, and exit 0. When `--token` is absent or the token does not match, the CLI **shall** exit 1 with a message naming the missing authority. The command **shall** behave identically in `hooks/ledger.mjs` and `src/gw/cli/commands/ledger.ts`.

- **Why** — Requiring the write_token prevents a subagent from recording a phase verdict on its own behalf (same authority model as `ledger gate advisor APPROVE`). Parity between the two CLI implementations prevents the hook-based path from diverging in behavior from the TypeScript path.
- **Fit criterion** — `ledger checkpoint --phase plan --verdict APPROVE --verified-by alice` with no `--token` exits 1. The same invocation with a valid `--token` exits 0 and writes `gate.phases.plan`. Both `hooks/ledger.mjs` and `src/gw/cli/commands/ledger.ts` produce the same ledger mutation for identical inputs.
- **Verification**: verified — `test/hooks/ledger-checkpoint-parity.test.ts` exercises token-absent rejection and happy-path writes on both CLI surfaces; `// @verifies CHECKPOINT-R-002` annotated.
- **Criticality**: must
