---
id: pacing-r-008
type: requirement
concept: C-ENFORCEMENT
title: Milestone sign-off requires write_token authority; subagents must not self-sign
status: open
verification: automated
criticality: must
design: "[[design/reference/enforcement-hooks-reference]]"
---

## PACING-R-008 — Milestone sign-off requires write_token authority; subagents must not self-sign {#pacing-r-008}

Both `ledger milestone-signoff` (which writes `pacing.milestone_signoff`) and `ledger checkpoint` (which writes `gate.phases.<phase>`) **shall** require the orchestrator `write_token`. Invoking either command without a valid `write_token` **shall** exit 1 with a message naming the missing authority. A subagent that cannot present the `write_token` cannot record a sign-off or phase verdict — preventing a subagent from approving its own work.

- **Why** — The milestone sign-off and phase checkpoint verdict are human verification events that release the completion gate. If a subagent can write either without token authority, the human-in-the-loop guarantee is defeated. The write_token denotes orchestrator-level authority; requiring it extends the same trust boundary that already protects `ledger gate advisor APPROVE`. The token is never passed to subagents (CLAUDE.md: "MUST NOT pass it to subagents"), so requiring it structurally excludes them.
- **Fit criterion** — `ledger milestone-signoff --verdict APPROVE` without `--token <write_token>` exits 1. `ledger checkpoint --phase completion --verdict APPROVE` without `--token` exits 1. Each exits 0 with a valid token and updates the ledger.
- **Verification**: automated — `test/hooks/milestone-signoff-authority.test.ts` covers `milestone-signoff` token enforcement; `test/hooks/checkpoint.test.ts` covers `checkpoint` token enforcement. Note: `status: open` preserved — full stop-gate release coverage partially tested.
- **Criticality**: must
