---
id: "agents-skills-r-003"
type: requirement
title: "Model assignment via model-registry.json"
concept: C-AGENTS-SKILLS
criticality: must
verification: unverified
status: open
---

## AGENTS-SKILLS-R-003 — Model assignment via model-registry.json {#agents-skills-r-003}

**When** a `Task` or `Agent` dispatch is made without an explicit `model:` field, **then** the `agent-model-guard` PreToolUse hook **shall** inject the model tier recorded in `model-registry.json` for that agent type, preventing silent inheritance of the session's opus model. The `model-registry.json` file **shall** be the single source of truth for claude-code model tier assignments; agent source files in `agents-src/` **shall** remain model-neutral.

- **Why** — Omitting `model:` causes a background `Task` to inherit the orchestrator's opus session model. Opus is the most expensive tier; silently billing it for every haiku-appropriate `explore` or `git-master` task multiplies token cost without any visible indication. The guard makes the default safe rather than expensive.
- **Fit criterion** — Send a PreToolUse input with `tool_name: "Task"` and `tool_input.subagent_type: "groundwork:explore"` with no `model:` field. The `agent-model-guard` hook **shall** emit a log line confirming injection of `model: "haiku"` (the `model-registry.json` entry for `explore`). Send the same input with `model: "sonnet"` explicitly set; the guard **shall** not override it.
- **Verification**: automated — `agent-model-guard` PreToolUse hook runs on every Agent/Task/TaskCreate call; injection and passthrough paths are exercised by unit tests under `test/`.
- **Criticality**: must
