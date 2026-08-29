# Hook Architecture

> **Type:** concept (explanation)
> **Related requirements:** [[../../requirements/enforcement-r-001-impl-guard-blocks-orchestrator-direct-edits|ENFORCEMENT-R-001]], [[../../requirements/seal-r-001-accepted-residual-ace-same-os-user|SEAL-R-001]]

## Overview

Enforcement hooks are Node.js `.mjs` scripts registered in `.claude/settings.json` under `hooks`. They execute on the Claude Code PreToolUse and Stop event bus without requiring model cooperation — the model cannot opt out of a registered hook.

## Registration model

Hooks are declared in `hooks/hooks.json` (the canonical registry) and referenced from `.claude/settings.json`. Each hook entry specifies:
- **event type** — `PreToolUse` or `Stop`
- **matcher** — a pipe-separated list of tool names (e.g. `Edit|Write|MultiEdit`) or empty for Stop hooks
- **command** — the script path

Hook scripts receive event data on stdin (JSON) and write their response to stdout. An exit code of `0` with a `{"decision": "block", ...}` body denies the tool call; exit `0` with no block permits it. Exit `1` is treated as an operational error.

## Identity detection

The orchestrator identity is detected via three signals, checked in order:

1. `agent_type` field in the tool call context
2. `agent_id` field
3. `transcript_path` basename starting with `agent-`

If ANY of these signals is present, the caller is treated as a subagent and the impl-guard passes through. If NONE are present, the caller is treated as the orchestrator.

## Enforcement modes

| Mode | Behavior | Used by |
|------|----------|---------|
| **Hard-block** | Exit 0 + `{"decision": "block", "reason": "..."}` — denies the tool call before the model sees it | orchestrator-impl-guard.mjs |
| **Fail-open** | If detection signal is absent, emit a warning and permit — liveness over strictness | nesting-guard.mjs, deslop-guard.mjs, agent-model-guard.mjs |

The orchestrator impl-guard is the only hard-block hook. All others fail-open when their input signal is absent, so misconfiguration degrades to advisory rather than lockout.

## Seal mechanism and its limit

`hooks/lib/gate-seal.mjs` implements an HMAC-based seal over the ledger's release state. The seal provides tamper-evidence against CLI misuse and direct file mutation, but not against a process running as the same OS user (which can read the key from disk). See [[../../requirements/seal-r-001-accepted-residual-ace-same-os-user|SEAL-R-001]] for the documented residual.

## Hook files in `hooks/`

| File | Event | Matcher | Mode |
|------|-------|---------|------|
| `orchestrator-impl-guard.mjs` | PreToolUse | `Edit\|Write\|MultiEdit` | Hard-block |
| `nesting-guard.mjs` | PreToolUse | `Agent\|Task\|TaskCreate` | Fail-open |
| `stop-gate.mjs` | Stop | (none) | Hard-block / release |
| `deslop-guard.mjs` | PreToolUse | `Edit\|Write\|MultiEdit` | Fail-open |
| `agent-model-guard.mjs` | PreToolUse | `Agent\|Task\|TaskCreate` | Fail-open |
