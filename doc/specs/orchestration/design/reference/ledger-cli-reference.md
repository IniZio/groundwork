---
tags: [reference, orchestration, ledger, cli]
realizes: "[[../../requirements/orchestration-r-004-every-decision-event-carries-a-structured-data-id|R-004]]"
source: hooks/ledger.mjs (HELP constant), src/gw/hook/stop-gate.ts, hooks/session-reminder.mjs
---

# Ledger CLI Reference

> **Reference table.** Look up any ledger command, the fields it touches, whether it requires a write token, and which hook reads those fields. Not a tutorial — for step-by-step guidance see [[../recipes/add-slice-with-acceptance-criteria]] or [[../recipes/release-stop-gate-after-advisor-approve]].

---

## Command reference

_Derived from the `HELP` constant in `hooks/ledger.mjs` and the enforcement logic in `src/gw/hook/stop-gate.ts`._

| Command | Fields written / read | write_token required? | Notes |
|---------|----------------------|----------------------|-------|
| `bin/ledger init` | `session_id`, `active`, `slices=[]`, `pacing`, `write_token` | — | Seeds default pacing: `policy=wave`, `budget=1`, `exempt_kinds=[plan,diagnose,design,fog]`. Not available in `gw ledger`. |
| `gw ledger add --motive <slug> <id>` | `slices[].{id, wave, kind, status=pending, desc, blocked_by, acceptance, ticket, covers_ac, decisions}` | No | `kind` defaults to `impl` |
| `gw ledger fog --motive <slug> <id>` | `slices[].{id, kind=fog, status=pending, question}` | No | No `acceptance`; excluded from frontier |
| `gw ledger claim --motive <slug> <id>` | `slices[].{status=in_progress, claimed_by, claimed_at}` | No | Blocked by pacing gate and `blocked_by` |
| `gw ledger set --motive <slug> <id>` | Any slice field | **Yes** for terminal status | Pacing check on `in_progress` transition |
| `gw ledger complete --motive <slug> <id>` | `slices[].{status=complete, completed_at, session_id}` | **Yes** | Never blocked by pacing (PACING-R-003) |
| `gw ledger gate --motive <slug> advisor APPROVE` | `gate.advisor` | **Yes** | Triggers `reSeal()`; `APPROVE` is the only terminal verdict |
| `gw ledger autopilot --motive <slug> --range N` | `pacing.grant.{range, granted_at, granted_by, reason}` | **Yes** | Emits `MILESTONE` journal event; requires non-empty `--reason` |
| `gw ledger await-human --motive <slug>` | `awaiting_human = true / false` | **Yes** | Silences stop-gate nag; does not release completion gate |
| `gw ledger abandon --motive <slug>` | `active = false` | No | Triggers `reSeal()`; releases stop-gate |
| `gw ledger frontier --motive <slug>` | — (read only) | — | Excludes `fog` and `complete`/`skipped` slices |
| `gw ledger view --motive <slug>` | — (read only) | — | Summary of run state; token is redacted in output |
| `gw ledger show --motive <slug> <id>` | — (read only) | — | Full detail for one slice |
| `gw ledger status --motive <slug>` | — (read only) | — | Cheap progress check (N/M complete) |
| `gw ledger scope-token --motive <slug> <scope>` | `scoped_tokens[]` | **Yes** | Issues a subagent scope token (not the master write_token) |
| `bin/ledger help [<cmd>]` | — | — | Print usage; also `-h` or bare `bin/ledger`. No `help` subcommand in `gw ledger`. |

---

## Which hook reads which field

| Field | Hook | How used |
|-------|------|---------|
| `active` | `stop-gate.ts` | `false` → allow (abandoned run) |
| `session_id` | `stop-gate.ts` | Mismatch → allow (foreign session) |
| `awaiting_human` | `stop-gate.ts` | `true` → allow (session correctly paused) |
| `slices[].status` | `stop-gate.ts` | Non-terminal statuses counted as incomplete |
| `gate.advisor` | `stop-gate.ts` | `APPROVE` (string or object) → gate satisfied |
| `pacing` | `stop-gate.ts`, `lib/pacing.mjs` | Exhausted budget → allow with DIRECTIVE |
| `reinforcements` | `stop-gate.ts` | Counter ≥ cap (12) → release stuck session |
| `progressSig` | `stop-gate.ts` | Hash of enforcement state; reset detection |
| `slices[]` (all) | `session-reminder.mjs` | SessionStart injection — status overlay on MAP |
| `write_token` | `stop-gate.ts`, `ledger.mjs` | Required for terminal mutations; never logged |
| `gate.seal` | `lib/gate-seal.mjs` | Cryptographic integrity on release paths |

---

## Pacing exempt kinds

These slice kinds are always claimable regardless of the pacing budget:

`plan`, `diagnose`, `design`, `fog`

Only `impl` slices consume the wave budget. Change with `bin/ledger init` options (not derivable from HELP; source: schema `exempt_kinds` field).

---

## Related requirements

- [[../../requirements/orchestration-r-004-every-decision-event-carries-a-structured-data-id|R-004]] — DECISION events cross-reference journal.mjs alongside this table

## Related notes

- [[../components/run-ledger-slice]] — field-level spec for slice fields
- [[../components/gate-note]] — field-level spec for gate fields
- [[../concepts/stop-gate]] — what reads these fields and why
- [[../flows/stop-gate-decision-path]] — decision path that reads them
