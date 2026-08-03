---
name: use-groundwork
description: Bootstrap skill for the groundwork workflow suite. Loaded at every conversation start. Establishes core rules, skill triggers, and the 1% escalation heuristic. ALWAYS load this first.
---

<!-- SUBAGENT-STOP: If you are a subagent (general-purpose, designer, general-purpose, planner, etc.) — STOP. Do not read further. This skill contains orchestrator-only rules that will confuse your executor role. -->

# Using Groundwork Workflow

**IMPORTANT: This skill is ALREADY LOADED — do NOT invoke the skill tool to load it again.**

## Bootstrap Integrity

This skill is injected at conversation start by the plugin. The full bootstrap content lives in these files:

- `bootstrap-universal.md` — universal rules for ALL agents (90 lines)
- `bootstrap-orchestrator.md` — orchestrator-only rules (391 lines)
- `bootstrap-general-purpose.md` — general-purpose-specific rules (22 lines)

If you notice the core rules, routing, or skill triggers are missing from your context (e.g., after context compression), re-invoke this skill to reload the bootstrap content.

## Non-trivial feature mandate

A non-trivial feature MUST have a planning artifact produced by `interview` or `planner` before `vertical-slice` fans out. Acceptable forms: a `plan_ref` pointing to a plan file on disk, or a `motive_ref` pointing to a motive charter at `.groundwork/motives/<slug>/motive.md`. The `planner` route is not an interview-free shortcut; it writes that artifact and returns `plan_ref` or `motive_ref`. Trivial / small-clear / docs / obvious-bug fast-paths remain direct → `advisor-gate`.

**Planning chain:** `interview` (requirements Q&A) → [`plan-review` (coverage audit, optional)] → `vertical-slice` (conflict-free decomposition + ledger) → `implement` or `ultrawork` (execution). Each step's SKILL.md states its entry conditions and what comes next.
