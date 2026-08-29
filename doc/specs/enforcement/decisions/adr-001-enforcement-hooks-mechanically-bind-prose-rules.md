# ADR-001: Enforcement hooks mechanically bind prose rules from CLAUDE.md

**Date:** 2026-08-29
**Status:** Accepted
**Deciders:** Newman Chow
**Origin:** plugin-cleanup#D-5

---

## Context and Problem Statement

CLAUDE.md contains prose instructions telling the orchestrator to delegate implementation to subagents and not write files directly. Under real context pressure these advisory rules are routinely dropped: sessions were observed running 200+ direct Edit and Write calls on the orchestrator model despite correct fan-out machinery being available. ~88% of output-token load landed on the expensive opus model. Advisory text cannot reliably enforce role separation.

## Decision Drivers

- Role separation between orchestrator (classify/delegate/review) and subagents (implement) must be mechanically enforced, not advisory
- The enforcement must not require model cooperation — the model must not be able to opt out
- The mechanism must fail-closed for hard constraints (orchestrator impl-guard) and fail-open for advisory constraints (nesting, deslop, model-guard) to preserve liveness

## Considered Options

1. **Strengthen CLAUDE.md prose** — improve wording and add reminders
2. **Model fine-tuning** — train the orchestrator model to follow delegation rules
3. **PreToolUse hooks** — register enforcement scripts in `.claude/settings.json` that run before every tool call

## Decision

**Option 3: PreToolUse hooks.** Register enforcement scripts in `.claude/settings.json` under `hooks`. These execute on the Claude Code event bus before the tool call reaches the model. The model cannot suppress or override them.

The orchestrator impl-guard (`orchestrator-impl-guard.mjs`) is hard-closing: it blocks Edit/Write/MultiEdit calls from the orchestrator on paths outside the one permitted shape. Other hooks (nesting-guard, agent-model-guard, deslop-guard) are fail-open advisories that warn but permit when their detection signal is absent.

## Consequences

**Positive:**
- Mechanical enforcement; model cooperation not required
- Observable: every block is a deny event in the hook log
- Composable: new constraints can be added as additional hooks without modifying existing ones

**Negative:**
- Hook scripts add latency to every Edit/Write/Agent/Task call
- Identity detection via three heuristic signals (`agent_type`, `agent_id`, `transcript_path` basename) can be spoofed by a sufficiently motivated model — the hook is defense-in-depth, not a security boundary
- The sealed gate (stop-gate HMAC) cannot protect against a process running as the same OS user (see SEAL-R-001)

## Implementation

- `hooks/orchestrator-impl-guard.mjs` — hard-block
- `hooks/nesting-guard.mjs` — fail-open advisory
- `hooks/stop-gate.mjs` — Stop hook (hard-block / release)
- `hooks/deslop-guard.mjs` — fail-open advisory
- `hooks/agent-model-guard.mjs` — fail-open advisory
- Registration: `hooks/hooks.json` → `.claude/settings.json`
