---
tags: [reference, orchestration, ledger, cli]
realizes: "[[../../requirements/orchestration-r-004-every-decision-event-carries-a-structured-data-id|R-004]]"
source: hooks/ledger.mjs (HELP constant), hooks/stop-gate.mjs, hooks/session-reminder.mjs
---

# Ledger CLI Reference

> **Reference table.** Look up any ledger command, the fields it touches, whether it requires a write token, and which hook reads those fields. Not a tutorial — for step-by-step guidance see [[../recipes/add-slice-with-acceptance-criteria]] or [[../recipes/release-stop-gate-after-advisor-approve]].

---

## Command reference

_Derived from the `HELP` constant in `hooks/ledger.mjs` and the enforcement logic in `hooks/stop-gate.mjs`._

| Command | Fields written / read | write_token required? | Notes |
|---------|----------------------|----------------------|-------|
| `ledger init` | `session_id`, `active`, `slices=[]`, `pacing`, `write_token` | — | Seeds default pacing: `policy=wave`, `budget=1`, `exempt_kinds=[plan,diagnose,design,fog]` |
| `ledger add <id>` | `slices[].{id, wave, kind, status=pending, desc, blocked_by, acceptance, ticket, covers_ac, decisions}` | No | `kind` defaults to `impl` |
| `ledger fog <id>` | `slices[].{id, kind=fog, status=pending, question}` | No | No `acceptance`; excluded from frontier |
| `ledger claim <id>` | `slices[].{status=in_progress, claimed_by, claimed_at}` | No | Blocked by pacing gate and `blocked_by` |
| `ledger set <id>` | Any slice field | **Yes** for terminal status | Pacing check on `in_progress` transition |
| `ledger complete <id>` | `slices[].{status=complete, completed_at, session_id}` | **Yes** | Never blocked by pacing (PACING-R-003) |
| `ledger gate advisor APPROVE` | `gate.advisor` | **Yes** | Triggers `reSeal()`; `APPROVE` is the only terminal verdict |
| `ledger autopilot --range N` | `pacing.grant.{range, granted_at, granted_by, reason}` | **Yes** | Emits `MILESTONE` journal event; requires non-empty `--reason` |
| `ledger await-human` | `awaiting_human = true / false` | **Yes** | Silences stop-gate nag; does not release completion gate |
| `ledger abandon` | `active = false` | No | Triggers `reSeal()`; releases stop-gate |
| `ledger frontier` | — (read only) | — | Excludes `fog` and `complete`/`skipped` slices |
| `ledger view` | — (read only) | — | Summary of run state; token is redacted in output |
| `ledger show <id>` | — (read only) | — | Full detail for one slice |
| `ledger status` | — (read only) | — | Cheap progress check (N/M complete) |
| `ledger scope-token <scope>` | `scoped_tokens[]` | **Yes** | Issues a subagent scope token (not the master write_token) |
| `ledger help [<cmd>]` | — | — | Print usage; also `-h` or bare `ledger` |

---

## Which hook reads which field

| Field | Hook | How used |
|-------|------|---------|
| `active` | `stop-gate.mjs` | `false` → allow (abandoned run) |
| `session_id` | `stop-gate.mjs` | Mismatch → allow (foreign session) |
| `awaiting_human` | `stop-gate.mjs` | `true` → allow (session correctly paused) |
| `slices[].status` | `stop-gate.mjs` | Non-terminal statuses counted as incomplete |
| `gate.advisor` | `stop-gate.mjs` | `APPROVE` (string or object) → gate satisfied |
| `pacing` | `stop-gate.mjs`, `lib/pacing.mjs` | Exhausted budget → allow with DIRECTIVE |
| `reinforcements` | `stop-gate.mjs` | Counter ≥ cap (12) → release stuck session |
| `progressSig` | `stop-gate.mjs` | Hash of enforcement state; reset detection |
| `slices[]` (all) | `session-reminder.mjs` | SessionStart injection — status overlay on MAP |
| `write_token` | `stop-gate.mjs`, `ledger.mjs` | Required for terminal mutations; never logged |
| `gate.seal` | `lib/gate-seal.mjs` | Cryptographic integrity on release paths |

---

## Pacing exempt kinds

These slice kinds are always claimable regardless of the pacing budget:

`plan`, `diagnose`, `design`, `fog`

Only `impl` slices consume the wave budget. Change with `ledger init` options (not derivable from HELP; source: schema `exempt_kinds` field).

---

## Related requirements

- [[../../requirements/orchestration-r-004-every-decision-event-carries-a-structured-data-id|R-004]] — DECISION events cross-reference journal.mjs alongside this table

## Related notes

- [[../components/run-ledger-slice]] — field-level spec for slice fields
- [[../components/gate-note]] — field-level spec for gate fields
- [[../concepts/stop-gate]] — what reads these fields and why
- [[../flows/stop-gate-decision-path]] — decision path that reads them
