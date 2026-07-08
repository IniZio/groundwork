# Agent Selection & Model Configuration Reference

## Agent Roster

| Agent | Best for |
|-------|----------|
| `explore` | Codebase search, pattern discovery, locating files/symbols |
| `general-purpose` | Bounded implementation, tests, build verification, debugging |
| `designer` | UI/UX, styling, responsive design, visual polish |
| `qa` | Live verification — browser/TUI/CLI exploratory + scripted testing, running env for eyeball-check |
| `advisor` | Architecture, trade-offs, completion gate (APPROVE/REVISE/REJECT), evidence-based completion checks, code quality review, SOLID audit |
| `test-engineer` | Test strategy, integration/e2e coverage, flaky test hardening |
| `git-master` | Atomic commits, rebasing, history management |
| `planner` | Strategic planning, actionable work plans before non-trivial features |

All agents use the `groundwork:` prefix: `task(subagent_type="groundwork:advisor", ...)`.

## Model Recommendations

| Agent | Model recommendation | Temperature | Notes |
|-------|---------------------|-------------|-------|
| `advisor` | `openai/gpt-5.4` | 0.1 | Strong reasoning for architecture and gates |
| `general-purpose` | `glm-5.2` | 0.2 | High reasoning, bounded implementation |
| `explore` | `opencode-go/deepseek-v4-flash` | 0.1 | Fast, cheap for discovery |
| `designer` | `cursor-agent/claude-sonnet-4-6` | 0.7 | Visual taste, UI polish |

**Configure per-agent models in `opencode.json`:**
```json
{
  "agent": {
    "advisor": { "model": "openai/gpt-5.4" },
    "general-purpose": { "model": "glm-5.2" },
    "explore": { "model": "opencode-go/deepseek-v4-flash" },
    "designer": { "model": "cursor-agent/claude-sonnet-4-6" }
  }
}
```

Temperature defaults are set automatically by the plugin. Override in `opencode.json` if needed.

## Why Delegation Matters

1. **Velocity**: Fan out aggressively — launch 5-15 parallel general-purpose tasks. Parallelism = faster delivery. Sequential work is the #1 time waste.
2. **Quality**: Each agent is specialized — general-purpose writes better code, explore maps faster, advisor thinks deeper, designer has visual taste.
3. **Context**: You preserve your context window for orchestration decisions instead of filling it with code details.
4. **Model diversity**: Different agents use different models matched to their domain.
