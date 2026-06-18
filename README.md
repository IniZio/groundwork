# Groundwork

Workflow plugin for AI coding agents providing structured development practices: PRD-driven development, advisor gates, BDD implementation, parallel background tasks, and context management.

## Supports

- **OpenCode** — Install via `opencode.json`
- **Pi** — Install via `pi install git:github.com/IniZio/groundwork`

## Install

### OpenCode

Add to `opencode.json`:

```json
{
  "plugin": [
    "opencode-pty",
    "groundwork@git+https://github.com/IniZio/groundwork.git"
  ]
}
```

### Pi

```bash
pi install git:github.com/IniZio/groundwork
```

Restart your agent. Skills auto-discover.

Note: pi-subagents is bundled as a dependency, enabling agent spawning functionality automatically.

## Tools

| Tool | Purpose |
|------|---------|
| `handoff_session` | Create focused continuation prompt |
| `set_goal` | Manage active session goal |

## Skills

| Skill | Trigger |
|-------|---------|
| `use-groundwork` | Every session start — core rules, issue-type routing |
| `interview` | Before PRD creation; standalone for small changes |
| `diagnose` | Bugs and regressions |
| `create-prd` | After interviewing for features (≥1 day) |
| `advisor-gate` | Before declaring done |
| `bdd-implement` | After PRD approval or interviewing |
| `prototype` | Design exploration |
| `goal` | Persistent project goal |

## Agents (Pi)

When using Pi with `pi-subagents`, the following agent types are auto-configured:

| Agent | Purpose |
|-------|---------|
| `general-purpose` | Orchestrator — main workflow coordinator |
| `advisor` | Strategic decisions, architecture, code review |
| `coder` | Fast implementation, tests, build verification |
| `designer` | UI/UX, styling, responsive design |
| `explorer` | Codebase exploration (read-only) |

## Rules

1. Issue-type routing: bug → diagnose, small change → interview + bdd-implement, feature → interview + create-prd + bdd-implement
2. Advisor gate before declaring done
3. No PRD commits to git
4. Interview before PRD — understanding before synthesis

## Dev

```bash
pnpm install
pnpm test        # run tests
pnpm run check   # typecheck
```

## Architecture

- `src/` — TypeScript source
- `src/pi.ts` — Pi extension entry point
- `.opencode/plugins/groundwork.js` — OpenCode plugin entry point
- `.pi/skills/` — Pi skill definitions
- `.pi/agents/` — Agent definitions (auto-installed on session start)
