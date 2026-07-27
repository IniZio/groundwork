---
id: C-ORCHESTRATION
type: concept
title: Orchestration Model
summary: "The orchestrator classifies and delegates all implementation to specialist subagents and never writes code or edits files itself."
parent: C-GROUNDWORK
origin_rfc: R-20260726-K4M2QX
---

# Orchestration Model

The orchestration model defines how groundwork splits reasoning from execution. A single orchestrator agent classifies tasks, delegates to specialist subagents, and reviews outcomes — but never writes code or edits files itself. Subagents receive self-contained briefs and return evidence; the orchestrator synthesises results and advances the run.

## Delegation rules

- `groundwork:general-purpose` — all implementation, debugging, and code editing
- `groundwork:explore` — read-only codebase discovery and summarisation
- `groundwork:advisor` — plan validation and completion gate
- `groundwork:designer`, `groundwork:test-engineer`, `groundwork:qa` — specialist domains

## Wave and fan-out model

The `vertical-slice` skill decomposes a feature into conflict-free parallel slices. The orchestrator dispatches all Wave 1 slices simultaneously via `Task(..., background=true)`. Each wave's results are reviewed before Wave 2 launches. The run ledger tracks slice status and gates session end via the Stop hook.

## Depth-1 constraint

A subagent at depth ≥ 1 may not dispatch `general-purpose` or `orchestrator`. The `nesting-guard.mjs` PreToolUse hook enforces this mechanically; the prose rule in CLAUDE.md is advisory only.

