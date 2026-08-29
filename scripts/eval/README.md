# Eval Suite — Spec Comprehension

This directory contains evaluation cases for testing that an agent can correctly answer questions from the enforcement spec.

## Running evals

```bash
claude plugin eval evals/spec-comprehension/ --ablation none
```

Use `--ablation none` — the default `with-without` ablation makes `tool_used: Skill` an unscored indicator, which breaks trigger-rate suites.

## A/B Answer Location

The table below maps each eval case to the requirement it tests and the migrated requirement file that contains the canonical answer.

| Case | Req ID | Migrated file path | Key text that answers the question |
|------|--------|--------------------|-------------------------------------|
| `case-01-pacing-budget` | PACING-R-001 | `doc/specs/enforcement/requirements/pacing-r-001-wave-default-pace-policy.md` | "stamp `pacing` as `{policy:"wave", budget:1, exempt_kinds:["plan","diagnose","design","fog"]}`" — default budget is 1 wave; exempt kinds are plan, diagnose, design, fog |
| `case-02-gate-release` | PACING-R-005 | `doc/specs/enforcement/requirements/pacing-r-005-pacing-exhaustion-stop-gate-release-directive-handoff.md` | "the Stop hook **shall** allow the session to end and **shall** emit a directive (not an advisory) instructing the operator to run the handoff skill and open a new session, naming the motive MAP.md path and the exact ids of all remaining incomplete slices" |
| `case-03-complete-unblocked` | PACING-R-003 | `doc/specs/enforcement/requirements/pacing-r-003-ledger-complete-never-blocked-by-pacing.md` | "the ledger CLI **shall** record the completion without restriction, regardless of pacing state or budget exhaustion" — blocking complete would falsify the ledger (P-B) |
| `case-04-absent-pacing` | PACING-R-001 | `doc/specs/enforcement/requirements/pacing-r-001-wave-default-pace-policy.md` | "When a run ledger carries no `pacing` field, the pacing module **shall** treat pacing as disabled and impose no start-time restrictions on any slice" |
| `case-05-seal-residual` | SEAL-R-001 | `doc/specs/enforcement/requirements/seal-r-001-accepted-residual-ace-same-os-user.md` | "a subagent with arbitrary code execution running as the same OS user…can read the seal key from disk and write a correctly re-sealed ledger via `computeSeal(…)`" |
| `case-06-autopilot-token` | PACING-R-004 | `doc/specs/enforcement/requirements/pacing-r-004-autopilot-grant-token-gated-recorded-run-scoped.md` | "write `pacing.grant = {range: N, granted_at: <ISO-8601 timestamp>, granted_by: <session-id…>, reason: <reason string>}` to the active run ledger and emit a MILESTONE journal event" |

## Notes

- Cases 01 and 04 both test PACING-R-001 — different aspects: 01 tests the default budget/exempt-kinds, 04 tests the absent-pacing-disables-enforcement clause.
- The migrated files are in `doc/specs/enforcement/requirements/` — the canonical answer text lives in the `## Statement` and `## Why` sections of each file.
- The `graders` in each `case.yaml` specify exactly which sentences must appear in a passing answer — check those for full scoring criteria.
