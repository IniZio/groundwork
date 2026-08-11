# Agent Selection & Model Configuration Reference

## Codex Scope

The roster and model table are shared planning metadata. Codex model guidance
comes from the registry, but specialist names are not automatically callable
agents. Use a host-provided delegation surface when available; otherwise keep
the role boundaries in the plan and execute locally.

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
| `debugger` | Read-write structured root-cause debugging (observe→hypothesize→isolate→fix); use for real bugs needing disciplined diagnosis, not code-and-guess |
| `researcher` | Read-only deep investigation of open questions, prior-art, external docs, cross-system tradeoffs; the tier above `explore` (which only locates code) |
| `junior-orchestrator` | **EXPERIMENTAL** (behind `GROUNDWORK_DEPTH2_EXPERIMENT` flag, off by default) depth-2 tier; a `general-purpose` may delegate one further sub-orchestration level to it |

All agents use the `groundwork:` prefix: `task(subagent_type="groundwork:advisor", ...)`.

## Model Recommendations

| Agent | Model | Notes |
|-------|-------|-------|
| `advisor` | `opus` | Strong reasoning for architecture and gates |
| `general-purpose` | `sonnet` | High reasoning, bounded implementation |
| `explore` | `haiku` | Fast, cheap for discovery |
| `designer` | `sonnet` | Visual taste, UI polish |

Per-agent models are configured in `model-registry.json` at the project root. The `model:` parameter on each `Task` call selects the model — see the dispatch table in `CLAUDE.md`.

## Why Delegation Matters

1. **Velocity**: Fan out aggressively — launch 5-15 parallel general-purpose tasks. Parallelism = faster delivery. Sequential work is the #1 time waste.
2. **Quality**: Each agent is specialized — general-purpose writes better code, explore maps faster, advisor thinks deeper, designer has visual taste.
3. **Context**: You preserve your context window for orchestration decisions instead of filling it with code details.
4. **Model diversity**: Different agents use different models matched to their domain.
