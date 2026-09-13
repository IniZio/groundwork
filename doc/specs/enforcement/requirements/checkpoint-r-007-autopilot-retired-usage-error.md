---
id: checkpoint-r-007
type: requirement
concept: C-ENFORCEMENT
title: gw ledger autopilot returns a usage error naming ledger checkpoint as its replacement
status: active
verification: unverified
criticality: must
origin_decision_ref: phase-checkpoint-gate#D-5
---

## CHECKPOINT-R-007 — `gw ledger autopilot` returns a usage error naming `ledger checkpoint` as its replacement {#checkpoint-r-007}

When `ledger autopilot` is invoked with any arguments, both CLI implementations **shall** exit 2 with a message stating that `autopilot` is retired and naming `ledger checkpoint` as the replacement command. The exit code **shall** be 2 (usage error), not 1 (operational failure) and not the unknown-subcommand error path.

- **Why** — A silent unknown-subcommand error (404-style exit) reads as a broken install to anyone with `autopilot` in muscle memory or a script. An explicit usage error with the replacement name gives the operator an actionable message. Exit code 2 distinguishes usage errors from operational failures in automated pipelines.
- **Fit criterion** — `ledger autopilot --range 2 --token <t> --reason "x"` exits 2 and the output contains "retired" and "checkpoint". Both `hooks/ledger.mjs` and `src/gw/cli/commands/ledger.ts` produce this behavior.
- **Verification**: unverified — backing tests in `test/hooks/guard-parity.test.ts`; `// @verifies` annotation pending test-file update.
- **Criticality**: must
