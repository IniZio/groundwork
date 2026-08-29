# Orchestrator Impl-Guard

> **Type:** component
> **Source:** `hooks/orchestrator-impl-guard.mjs`
> **Related requirements:** [[../../requirements/enforcement-r-001-impl-guard-blocks-orchestrator-direct-edits|ENFORCEMENT-R-001]]

## Purpose

The orchestrator impl-guard (`orchestrator-impl-guard.mjs`) is the primary enforcement point preventing the orchestrator from writing files directly. It runs as a PreToolUse hook on `Edit|Write|MultiEdit`.

## Permit path

The ONE permitted path shape for orchestrator writes:

```
~/.claude/projects/<hash>/memory/**
```

This covers session/project memory files (including `MEMORY.md` and topic sidecars) that the orchestrator must compose in-context. Any other path is blocked.

## Deny block structure

When the hook blocks a call, it returns:

```json
{
  "decision": "block",
  "reason": "Orchestrator direct edit blocked: <path> is not a permitted memory file. Delegate to a subagent."
}
```

Exit code: `0` with block decision (not exit 1 — the block is a valid response, not an error).

## Subagent pass-through

Subagents are identified by the presence of ANY of:
- `agent_type` in the tool call context
- `agent_id` in the tool call context
- `transcript_path` basename starting with `agent-`

If any signal is present, the call is passed through without inspection. Subagents may write to any path.

## Spoof path handling

Paths are resolved to canonical form before the permit check. A path like `~/.claude/projects/<hash>/memory/../../etc/passwd` resolves outside the permit shape and is blocked. The check is on the resolved path, not the raw string.

## Anatomy

```
PreToolUse event (Edit|Write|MultiEdit)
  │
  ├── Is caller a subagent? ──Yes──> PERMIT
  │
  └── No (orchestrator identity)
        │
        ├── Is path under ~/.claude/projects/*/memory/? ──Yes──> PERMIT
        │
        └── No ──> BLOCK (deny block with reason)
```

## Fail-open cases

This hook does NOT fail-open. If the caller's identity cannot be determined (no subagent signals present) the caller is treated as the orchestrator and the path check applies. Absence of signals = orchestrator assumption.
