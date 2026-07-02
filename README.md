# Groundwork

Workflow plugin for AI coding agents providing structured development practices: interview-driven planning, vertical-slice fan-out enforced by a run ledger and Stop-gate hook, advisor gates, and context management.

## Supports

- **OpenCode** — Install via `opencode.json`
- **Pi** — Install via `pi install git:github.com/IniZio/groundwork`
- **Claude Code** — Install via `/plugin` (`.claude-plugin/plugin.json`)
- **omp (Oh My Pi)** — Install via `omp plugin link` / `omp plugin install`

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

### Claude Code

Groundwork ships a `.claude-plugin/plugin.json` manifest (skills, agents, and the orchestrator `CLAUDE.md` via `claudeMd`). Add the marketplace and install:

```
/plugin marketplace add IniZio/groundwork
/plugin install groundwork@groundwork
```

### omp (Oh My Pi)

omp recognizes the `pi.extensions` manifest in `package.json` and loads `src/pi.ts`, which injects the orchestrator identity at session start. Link a local checkout (symlink, live-updates) or install a copy:

```bash
omp plugin link ./path/to/groundwork      # dev: symlink, tracks source
omp plugin install ./path/to/groundwork   # release: copy
```

Verify: `omp plugin list` should show `groundwork@<version>`.

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
| `interview` | Plan a feature (defers to project planning conventions); standalone for small changes |
| `vertical-slice` | Decompose into conflict-free parallel slices; writes the `.groundwork/run.json` ledger |
| `ultrawork` | Max fan-out mode — slice → ledger → dispatch all slices in parallel |
| `implement` | Orchestrate implementation after a plan/interview |
| `diagnose` | Bugs and regressions |
| `advisor-gate` | Before declaring done |
| `prototype` | Design exploration |
| `goal` | Persistent project goal |

## Agents (Pi)

When using Pi with `pi-subagents`, the following agent types are auto-configured:

| Agent | Purpose |
|-------|---------|
| `general-purpose` | Orchestrator — main workflow coordinator |
| `advisor` | Strategic decisions, architecture, code review |
| `general-purpose` | Fast implementation, tests, build verification |
| `designer` | UI/UX, styling, responsive design |
| `explorer` | Codebase exploration (read-only) |

## Rules

1. Issue-type routing: bug → diagnose, small change → interview + implement, feature → interview → vertical-slice (writes the run ledger) → fan out general-purpose agents → advisor gate
2. Advisor gate before declaring done; recorded in `.groundwork/run.json` and enforced by the Stop-gate hook
3. Plans defer to the project's planning convention; groundwork's `.groundwork/plans/` is the fallback and is not committed
4. Interview before slicing — understanding before synthesis

## Run ledger (`.groundwork/run.json`)

Non-trivial runs are tracked in a ledger the Stop-gate hook (`hooks/stop-gate.mjs`) enforces. Key fields:

- `slices[].blocked_by` — canonical wave-ordering dependency (`depends_on` is a legacy alias); a slice can't be marked `complete` until its blockers are.
- `slices[].acceptance` — `string[]` of checkbox-style, verifiable done-conditions; the Stop-gate surfaces unmet counts.
- `gate.advisor` — accepts the legacy string (`APPROVE`/`REVISE`/`REJECT`) **or** an object `{ verdict, rubric, axes: { correctness, completeness, over_engineering }, citation }` (axes scored 0–3). The run is approved when the string or `verdict` is `APPROVE`.

The advisor gate scores correctness / completeness / over-engineering as independent axes, requires a concrete `citation` on any non-approval, and self-tests before recording a verdict.

**Rejection KB** — `.groundwork/out-of-scope/<concept-slug>.md`: one durable file per rejected concept (reasoning + a *Prior requests* list), scanned at triage to dedup repeat asks by concept rather than re-litigating a settled "no".

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
