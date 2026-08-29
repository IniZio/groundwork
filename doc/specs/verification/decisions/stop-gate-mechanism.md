# MADR: Stop-Gate Mechanism

**Status:** Accepted  
**Date:** 2026-08-29  
**Concept:** [[verification/index]]

## Context and problem statement

The orchestrator is an LLM. Without mechanical enforcement, it can rationalize ending a session before all delegated slices have landed, leaving work unfinished and no audit trail. How should groundwork enforce that a session does not end prematurely?

## Decision drivers

- LLMs ignore advisory prompts under time pressure; enforcement must be mechanical, not advisory
- The hook must never permanently block a user's session (fail-open requirement)
- The enforcement point must fire on every session-end attempt, not just on explicit orchestrator actions
- The mechanism must distinguish genuine progress (orchestrator yielding to await agents) from stalling

## Considered options

1. **Stop hook (chosen)** — a Claude Code Stop hook fires on every session-end attempt; it reads the ledger and blocks or allows
2. **PreToolUse hook on session-close tool** — intercept a specific tool call; relies on the session using a predictable close sequence
3. **Advisory injection at SessionStart** — re-inject fan-out rules at session start; relies on the LLM to comply
4. **Post-session script** — an external watcher that checks after the session ends; cannot actually block the stop

## Decision outcome

**Chosen: Stop hook.**

The Stop hook is the only option that fires unconditionally on every session-end attempt without requiring the LLM to perform a specific action. It runs outside the model's context and has final say over whether the session ends.

## Consequences

- **Positive:** Mechanical enforcement; cannot be bypassed by LLM rationalization
- **Positive:** Fail-open design means stuck sessions eventually release (bounded reinforcement counter)
- **Positive:** Yield-aware design prevents misfiring when the orchestrator legitimately yields to await background agents
- **Negative:** The hook can only read the ledger, not write it; the orchestrator must record progress explicitly via `bin/ledger`
- **Negative:** A garbled or missing ledger causes fail-open, which means the gate may release prematurely if the ledger is corrupted
