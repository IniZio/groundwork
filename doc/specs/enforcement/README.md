---
id: C-ENFORCEMENT
type: concept
title: Enforcement Hooks
summary: "Enforcement hooks mechanically bind CLAUDE.md prose rules as PreToolUse gates, blocking orchestrators and subagents from violating delegation constraints."
parent: C-GROUNDWORK
origin_decision_ref: plugin-cleanup#D-5
---

# Enforcement Hooks

Enforcement hooks translate prose rules from CLAUDE.md into mechanically binding constraints. They are registered in `.claude/settings.json` under `hooks` and execute on the Claude Code event bus without requiring model cooperation.

## orchestrator-impl-guard.mjs

PreToolUse on `Edit|Write|MultiEdit`. Blocks the orchestrator from writing files directly, except for two narrow permit paths: session/project memory files under `~/.claude/projects/<hash>/memory/` and handoff documents at `<any>/.groundwork/handoffs/handoff-*.md`. Subagents are identified by the presence of `agent_type`, `agent_id`, or a `transcript_path` basename starting with `agent-`; they are not blocked.

## nesting-guard.mjs

PreToolUse on `Agent|Task|TaskCreate`. Blocks any subagent at depth ≥ 1 from dispatching `general-purpose` or `orchestrator`. Uses the same three-signal subagent detection as orchestrator-impl-guard. Fail-open: if the caller's depth cannot be determined, the call is allowed.

## stop-gate.mjs

Stop hook (no matcher). Blocks session end while the active run ledger has incomplete slices or an absent advisor APPROVE. Yield-aware: allows stop when background tasks are in flight or the orchestrator is waiting for user input.

## deslop-guard.mjs

PreToolUse on `Edit|Write|MultiEdit`. Enforces quality constraints on written content (details in hooks/deslop-guard.mjs).

## agent-model-guard.mjs

PreToolUse on `Agent|Task|TaskCreate`. Enforces that every dispatched agent carries an explicit `model:` field to prevent silent inheritance of the expensive orchestrator model.

