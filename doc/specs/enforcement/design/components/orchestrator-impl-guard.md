# Orchestrator Impl-Guard

> **Type:** component
> **Source:** `src/gw/hook/orchestrator-impl-guard.ts` (invoked via `bin/gw-hook hook orchestrator-impl-guard`, registered in `hooks/hooks.json`)
> **Related requirements:** [[../../requirements/enforcement-r-001-impl-guard-blocks-orchestrator-direct-edits|ENFORCEMENT-R-001]]

## Purpose

The orchestrator impl-guard (`src/gw/hook/orchestrator-impl-guard.ts`) is the primary enforcement point preventing the orchestrator from writing files directly. It runs as a PreToolUse hook on `Edit|Write|MultiEdit`.

## Permit path

The ONE permitted path shape for orchestrator writes:

```
~/.claude/projects/<hash>/memory/**
```

This covers session/project memory files (including `MEMORY.md` and topic sidecars) that the orchestrator must compose in-context. Everything else triggers an advisory warning — the hook emits a delegation reminder via `additionalContext` and the edit proceeds. The orchestrator delegation obligation remains a MUST; the hook enforces it through a visible reminder, not a hard block.

## Advisory warning structure

When the hook detects an orchestrator write outside the permitted path, it emits an advisory warning and allows the edit to proceed:

```json
{
  "hookSpecificOutput": {
    "additionalContext": "Orchestrator direct edit on <path>: this path should be delegated to a subagent. Delegation obligation is a MUST — this warning is advisory only and the edit will proceed."
  }
}
```

Exit code: `0`, no `permissionDecision` — the edit proceeds. The hook issues no block decision; enforcement is through the visible delegation reminder, not a hard block.

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
  ├── Is caller a subagent? ──Yes──> PERMIT (silent)
  │
  └── No (orchestrator identity)
        │
        ├── Is path under ~/.claude/projects/*/memory/? ──Yes──> PERMIT (silent)
        │
        └── No ──> ADVISORY WARNING via additionalContext
                    (edit proceeds; exit 0; no permissionDecision)
```

## Fail-open cases

This hook does NOT fail-open. If the caller's identity cannot be determined (no subagent signals present) the caller is treated as the orchestrator and the path check applies. Absence of signals = orchestrator assumption.
