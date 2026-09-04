---
id: C-AGENTS-SKILLS
type: moc
title: Agents and Skills
summary: Agent roster, skill registries, model assignments, and delegation topology enforced by groundwork hooks.
parent: C-GROUNDWORK
status: draft
---

# Agents and Skills

> Groundwork routes work through a typed roster of agents and a three-tree skill registry. Routing rules, model assignments, and spawn-topology constraints are specified here so they can be verified rather than inferred from prose scattered across mirrored files.

## Quick links

- [model-registry.json](../../model-registry.json) — SSOT for claude-code model tiers per agent
- [agents-src/](../../agents-src/) — hand-edited agent source definitions
- [agents/](../../agents/) — generated agent definitions (never hand-edit)
- [skills/groundwork/](../../skills/groundwork/) — hand-edited skill authority tree
- [skills/](../../skills/) — generated Codex-facing skill copies (never hand-edit)
- [.pi/skills/](../../.pi/skills/) — independent Pi overlay (hand-edit; validated by `check:pi`)
- [src/gw/hook/nesting-guard.ts](../../src/gw/hook/nesting-guard.ts) — PreToolUse spawn-topology enforcer (invoked via `bin/gw-hook hook nesting-guard`)
- [src/gw/hook/agent-model-guard.ts](../../src/gw/hook/agent-model-guard.ts) — PreToolUse model injector / built-in shadow guard (invoked via `bin/gw-hook hook agent-model-guard`)

## Requirements

| Id | Title |
|----|-------|
| [[requirements/agents-skills-r-001-skill-three-tree-authority-model\|R-001]] | Skill three-tree authority model |
| [[requirements/agents-skills-r-002-agent-source-generated-tree-separation\|R-002]] | Agent source/generated tree separation |
| [[requirements/agents-skills-r-003-model-assignment-via-registry\|R-003]] | Model assignment via model-registry.json |
| [[requirements/agents-skills-r-004-delegation-topology-enforcement\|R-004]] | Delegation topology enforcement |
| [[requirements/agents-skills-r-005-enforcement-boundary\|R-005]] | Enforcement boundary — mechanical vs discipline-only |
| [[requirements/agents-skills-r-006-generated-agent-tree-consistency\|R-006]] | Generated agent tree consistency |
| [[requirements/agents-skills-r-007-pi-skills-drift-detection\|R-007]] | Pi skills drift detection |
| [[requirements/agents-skills-r-008-built-in-agent-shadow-prevention\|R-008]] | Built-in agent shadow prevention |
