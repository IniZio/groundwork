---
tags: [reference, orchestration, ledger, cli]
source: hooks/ledger.mjs (HELP constant), src/gw/hook/stop-gate.ts, hooks/session-reminder.mjs
---

# Ledger CLI Reference

> **Reference table.** Look up any ledger command, the fields it touches, whether it requires a write token, and which hook reads those fields. Not a tutorial — for step-by-step guidance see [[../recipes/add-slice-with-acceptance-criteria]] or [[../recipes/release-stop-gate-after-advisor-approve]].

---

## Command reference

_Derived from the `HELP` constant in `hooks/ledger.mjs` and the enforcement logic in `src/gw/hook/stop-gate.ts`._

| Command | Fields written / read | write_token required? | Notes |
|---------|----------------------|----------------------|-------|
| `bin/ledger init` | `session_id`, `active`, `slices=[]`, `gate.phases`, `write_token` | — | Seeds empty `gate.phases` for per-phase checkpoint tracking. |
| `gw ledger init --motive <slug>` | same as `bin/ledger init` | — | Guarded: requires non-empty `--motive` slug; refuses to overwrite an existing active run without explicit confirmation. |
| `gw ledger add --motive <slug> <id>` | `slices[].{id, wave, kind, status=pending, desc, blocked_by, acceptance, ticket, covers_ac, decisions}` | No | `kind` defaults to `impl` |
| `gw ledger fog --motive <slug> <id>` | `slices[].{id, kind=fog, status=pending, question}` | No | No `acceptance`; excluded from frontier |
| `gw ledger claim --motive <slug> <id>` | `slices[].{status=in_progress, claimed_by, claimed_at}` | No | Blocked by `blocked_by` |
| `gw ledger set --motive <slug> <id>` | Any slice field | **Yes** for terminal status | Token required for terminal status changes |
| `gw ledger complete --motive <slug> <id>` | `slices[].{status=complete, completed_at, session_id}` | **Yes** | Never blocked at claim time; gate enforces at session end |
| `gw ledger gate --motive <slug> advisor APPROVE` | `gate.advisor` | **Yes** | Triggers `reSeal()`; `APPROVE` is the only terminal verdict |
| `gw ledger checkpoint --motive <slug> <phase> <verdict>` | `gate.phases[phase].{verdict, verifier, verified_at}` | **Yes** | Records per-phase human checkpoint verdict; triggers `reSeal()` |
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
| `checkpoint_hold` | `stop-gate.ts` | Auto-advancing tier → allow with DIRECTIVE; blocking tier → hold fail-closed |
| `gate.phases` | `stop-gate.ts` | Per-phase checkpoint verdicts read by phase-tier dispatch |
| `reinforcements` | `stop-gate.ts` | Counter ≥ cap (12) → release stuck session |
| `progressSig` | `stop-gate.ts` | Hash of enforcement state; reset detection |
| `slices[]` (all) | `session-reminder.mjs` | SessionStart injection — active run status summary |
| `write_token` | `stop-gate.ts`, `ledger.mjs` | Required for terminal mutations; never logged |
| `gate.seal` | `lib/gate-seal.mjs` | Cryptographic integrity on release paths |

---

## Phase tiers

| Phase | Tier | Stop-gate behaviour |
|-------|------|-------------------|
| `plan` | Blocking | Gate holds fail-closed until checkpoint verdict recorded |
| `design` | Blocking | Gate holds fail-closed until checkpoint verdict recorded |
| `wave` | Auto-advances | Gate releases with a directive when `checkpoint_hold === "wave"` |
| `completion` | Blocking | Gate holds fail-closed until checkpoint verdict recorded |

---

## Related requirements

## Related notes

- [[../components/run-ledger-slice]] — field-level spec for slice fields
- [[../components/gate-note]] — field-level spec for gate fields
- [[../concepts/stop-gate]] — what reads these fields and why
- [[../flows/stop-gate-decision-path]] — decision path that reads them
