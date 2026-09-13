---
id: checkpoint-r-010
type: requirement
concept: C-ENFORCEMENT
title: checkpoint present in MUTATING_LEDGER_CMD_RE and autopilot absent; subagents cannot set phase verdicts via Bash
status: active
verification: verified
criticality: must
origin_decision_ref: phase-checkpoint-gate#D-5
---

## CHECKPOINT-R-010 — `checkpoint` present in `MUTATING_LEDGER_CMD_RE` and `autopilot` absent; subagents cannot set phase verdicts via Bash {#checkpoint-r-010}

The `MUTATING_LEDGER_CMD_RE` pattern in `src/gw/hook/ledger-bash-guard.ts` **shall** include `checkpoint` and **shall** not include `autopilot`. A subagent Bash invocation of `ledger checkpoint ...` **shall** be blocked by the ledger-bash-guard hook. A subagent Bash invocation of `ledger autopilot ...` **shall** pass through the guard (because `autopilot` now only emits a usage error and cannot mutate the ledger).

- **Why** — `ledger checkpoint` is token-gated and writes phase verdicts. Excluding it from the Bash guard would let a subagent invoke it via Bash with a token it obtained by other means, bypassing the guard. `autopilot` is retired and cannot mutate state, so guarding it would only produce false positives on historical commands; removing it from the pattern is safe.
- **Fit criterion** — A Bash command matching `ledger checkpoint` fired by a subagent is blocked by the ledger-bash-guard (exit 1, message citing the guard). A Bash command matching `ledger autopilot` is not blocked by the ledger-bash-guard.
- **Verification**: verified — `test/hooks/ledger-guard.test.ts` (AC-15: subagent `ledger checkpoint` DENIED; subagent `ledger autopilot` not blocked; orchestrator `ledger checkpoint` ALLOWED); `// @verifies CHECKPOINT-R-010` annotated.
- **Criticality**: must
