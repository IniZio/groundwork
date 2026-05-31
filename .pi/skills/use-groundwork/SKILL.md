---
name: use-groundwork
description: Bootstrap skill for the groundwork workflow suite. Loaded at every conversation start. Establishes core rules, skill triggers, and the 1% escalation heuristic. ALWAYS load this first.
---

# Using Groundwork Workflow

**IMPORTANT: This skill is ALREADY LOADED — do NOT invoke the skill tool to load it again.**

## Bootstrap Integrity

This skill is injected at conversation start by the plugin. The full bootstrap content lives in these files:

- `bootstrap-universal.md` — universal rules for ALL agents (90 lines)
- `bootstrap-orchestrator.md` — orchestrator-only rules (391 lines)
- `bootstrap-coder.md` — coder-specific rules (22 lines)

If you notice the core rules, routing, or skill triggers are missing from your context (e.g., after context compression), re-invoke this skill to reload the bootstrap content.
