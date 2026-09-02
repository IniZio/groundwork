# Enforcement Hooks Reference

> **Type:** reference table
> **Source:** `hooks/README.md`, `hooks/hooks.json`, `hooks/orchestrator-impl-guard.mjs`, `hooks/nesting-guard.mjs`, `hooks/stop-gate.mjs`, `hooks/deslop-guard.mjs`, `hooks/agent-model-guard.mjs`

## All enforcement hooks

| Hook | Event | Matcher | Mode | Gated action | Requirements |
|------|-------|---------|------|-------------|--------------|
| `orchestrator-impl-guard.mjs` | PreToolUse | `Edit\|Write\|MultiEdit` | Advisory (exit 0, no block) | Orchestrator direct edits outside memory/ permit path — emits delegation reminder via `additionalContext`, edit proceeds | [[../../requirements/enforcement-r-001-impl-guard-blocks-orchestrator-direct-edits\|ENFORCEMENT-R-001]] |
| `nesting-guard.mjs` | PreToolUse | `Agent\|Task\|TaskCreate` | Fail-open | Depth-1 subagents dispatching `general-purpose` or `orchestrator` | (advisory) |
| `stop-gate.mjs` | Stop | (none) | Hard-block / release | Session end while incomplete slices or absent advisor APPROVE remain | [[../../requirements/pacing-r-005-pacing-exhaustion-stop-gate-release-directive-handoff\|PACING-R-005]] |
| `deslop-guard.mjs` | PreToolUse | `Edit\|Write\|MultiEdit` | Fail-open | Quality constraints on written content | (advisory) |
| `agent-model-guard.mjs` | PreToolUse | `Agent\|Task\|TaskCreate` | Fail-open | Agent dispatches missing explicit `model:` field | (advisory) |

## Pacing enforcement surface

The pacing module (`hooks/lib/pacing.mjs`) gates `ledger claim` and `ledger set --status in_progress` — not a hook event, but a CLI check inside the ledger. The following requirements govern pacing enforcement:

| Requirement | CLI command affected | Mode |
|------------|---------------------|------|
| [[../../requirements/pacing-r-001-wave-default-pace-policy\|PACING-R-001]] | `ledger init` | default stamp |
| [[../../requirements/pacing-r-002-start-time-hard-block-with-exact-reason-messaging\|PACING-R-002]] | `ledger claim`, `ledger set --status in_progress` | Hard-block (exit 1) |
| [[../../requirements/pacing-r-003-ledger-complete-never-blocked-by-pacing\|PACING-R-003]] | `ledger complete` | Always ungated |
| [[../../requirements/pacing-r-004-autopilot-grant-token-gated-recorded-run-scoped\|PACING-R-004]] | `ledger autopilot` | Grant write |
| [[../../requirements/pacing-r-005-pacing-exhaustion-stop-gate-release-directive-handoff\|PACING-R-005]] | Stop hook | Release with directive |
| [[../../requirements/pacing-r-006-autopilot-grant-requires-nonempty-reason\|PACING-R-006]] | `ledger autopilot`, Stop hook | HITL enforcement |

## Milestone enforcement (S7, not yet implemented)

| Requirement | CLI command affected | Mode |
|------------|---------------------|------|
| [[../../requirements/pacing-r-007-milestone-policy-gates-on-human-verified-shippable\|PACING-R-007]] | `ledger claim` (milestone policy) | Hard-block until sign-off |
| [[../../requirements/pacing-r-008-milestone-signoff-requires-write-token-authority\|PACING-R-008]] | `ledger milestone-signoff` | Token-gated write |
| [[../../requirements/pacing-r-009-milestone-artifacts-hook-validatable-staleness\|PACING-R-009]] | `ledger claim --build-hash` | Freshness check |
| [[../../requirements/pacing-r-010-milestone-signoff-composes-with-awaiting-human\|PACING-R-010]] | `ledger await-human`, Stop hook | Composition |

## Security surface

| Requirement | Scope |
|------------|-------|
| [[../../requirements/pacing-r-011-evidence-artifacts-under-groundwork-never-committed\|PACING-R-011]] | `.groundwork/` never committed — HAR files carry credentials |
| [[../../requirements/seal-r-001-accepted-residual-ace-same-os-user\|SEAL-R-001]] | Sealed gate does not protect against same-OS-user ACE |

## Fail-open vs. fail-closed summary

| Hook / module | On missing signal | Rationale |
|---------------|-------------------|-----------|
| `orchestrator-impl-guard.mjs` | Assumes orchestrator (fail-closed) | Absence of subagent signals = orchestrator |
| `nesting-guard.mjs` | Warn + permit (fail-open) | Advisory; liveness over strictness |
| `agent-model-guard.mjs` | Warn + permit (fail-open) | Advisory |
| `deslop-guard.mjs` | Warn + permit (fail-open) | Advisory |
| Pacing (PACING-R-001) | Pacing disabled when no `pacing` field | Backward compatibility |
| Pacing (PACING-R-009 / V9) | Fail-closed when `--build-hash` absent | Security: inability to verify = stale |
