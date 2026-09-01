---
id: pacing-r-008
type: requirement
concept: C-ENFORCEMENT
title: Milestone sign-off requires write_token authority; subagents must not self-sign
status: open
verification: unverified
criticality: must
design: "[[design/reference/enforcement-hooks-reference]]"
---

## PACING-R-008 — Milestone sign-off requires write_token authority; subagents must not self-sign {#pacing-r-008}

When S7 records a `milestone_signoff` object in the ledger, the CLI command that writes it **shall** require the orchestrator `write_token` (the same token that gates `ledger gate` and `ledger complete`). Invoking the sign-off command without a valid `write_token` **shall** exit 1 with a message naming the missing authority. A subagent that cannot present the `write_token` cannot record a sign-off — preventing a subagent from approving its own work.

- **Why** — The milestone sign-off is the human verification event that releases the pacing gate. If a subagent can write it without token authority, the human-in-the-loop guarantee is defeated: any subagent can self-certify completion. The write_token is the existing credential that denotes orchestrator-level authority; requiring it here extends the same trust boundary that already protects `ledger gate advisor APPROVE`. The token is never passed to subagents (CLAUDE.md: "MUST NOT pass it to subagents"), so requiring it structurally excludes them.
- **Fit criterion** — Invoking the sign-off command without `--token <write_token>` exits 1 with an error citing missing token authority. Invoking it with a valid token succeeds and writes `milestone_signoff` to the ledger.
- **Verification**: unverified — S7 test suite covers both token-absent (exit 1) and token-present (exit 0 + ledger updated) cases.
- **Criticality**: must
