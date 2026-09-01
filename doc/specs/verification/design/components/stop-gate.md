# Stop Gate — Component

Anatomy of `hooks/stop-gate.mjs` as a system component.

## Inputs

| Input | Source | Description |
|-------|--------|-------------|
| Stop payload | Claude Code harness | JSON blob; includes `background_tasks` (authoritative in-flight count) and `transcript` (last N turns) |
| Run ledger | `.groundwork/runs/<session_id>.json` (or legacy `.groundwork/run.json`) | Active run's slice list and gate verdicts |
| Journal shards | `.groundwork/journal/` | DECISION events for the current motive (advisory checks) |
| Session id | `CLAUDE_SESSION_ID` env var | Used to scope the ledger check |

## Outputs

| Condition | Exit code | Stdout |
|-----------|-----------|--------|
| ALLOW (no active run / fail-open / yield / bounded cap) | 0 | — |
| ALLOW with advisory | 0 | Advisory message naming DECISION event ids |
| BLOCK (incomplete slices) | non-zero | Block message listing pending/in-progress slice ids |
| BLOCK (advisor gate not APPROVE) | non-zero | Block message asking orchestrator to invoke advisor |

## Decision criteria (ordered)

1. Fail-open: error → allow
2. Session scope: wrong session_id → allow
3. Yield-aware: background tasks in flight or transcript markers → allow
4. Slice check: any `pending` or `in_progress` → block
5. Gate check: `gate.advisor ≠ "APPROVE"` → block
6. Bounded cap: reinforcement count ≥ cap → allow
7. Research advisory: high/medium-blast DECISION with no `data.research` → advisory (non-blocking)
8. Alternatives advisory: empty alternatives or unmarked id collision → advisory (non-blocking)
9. Allow

## State it reads (never writes)

The hook is read-only with respect to the ledger. It cannot mark slices complete or record gate verdicts — only the orchestrator (via `gw ledger`) can do that.
