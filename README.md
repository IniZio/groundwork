# Groundwork

Workflow plugin for AI coding agents providing structured development practices: interview-driven planning, vertical-slice fan-out enforced by a run ledger and Stop-gate hook, advisor gates, and context management.

## Supports

- **Pi** — Install via `pi install git:github.com/IniZio/groundwork`
- **Claude Code** — Install via `/plugin` (`.claude-plugin/plugin.json`)
- **omp (Oh My Pi)** — Install via `omp plugin link` / `omp plugin install`
- **Codex** — Install from the Codex plugin directory (`.codex-plugin/plugin.json`)

## Install

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

omp recognizes the `pi.extensions` manifest in `package.json` and loads `pi/pi.ts`, which injects the orchestrator identity at session start. Link a local checkout (symlink, live-updates) or install a copy:

```bash
omp plugin link ./path/to/groundwork      # dev: symlink, tracks source
omp plugin install ./path/to/groundwork   # release: copy
```

Verify: `omp plugin list` should show `groundwork@<version>`.

### Codex

Groundwork follows the native Codex plugin layout used by plugins such as
Superpowers: `.codex-plugin/plugin.json` at the repository root and one skill
directory per workflow directly under `skills/`. Open Codex's plugin directory
(`/plugins`), search for `Groundwork`, and install it from the marketplace.

The direct Codex skill directories are generated from the canonical
`skills/groundwork/` tree by `pnpm run generate:agents`.

Restart your agent. Skills auto-discover.

## Runtime capabilities

Groundwork skills provide workflow instructions; they do not automatically add
runtime tools to the host agent. The available runtime surface depends on the
host platform.

| Capability | Groundwork support |
|------|---------|
| Handoff | File-only Markdown continuation artifact via the `handoff` skill |
| Goals | Workflow guidance; persistent goal tooling depends on the host |
| Fan-out | Workflow guidance; parallel delegation depends on the host |

For Codex specifically, installing this plugin makes the skills discoverable,
but does not automatically install fan-out tools, handoff orchestration, or
enforcement hooks. Codex handoff is intentionally file-only: the skill writes
an artifact the user can review and provide to a later session.

## Skills

| Skill | Trigger |
|-------|---------|
| `use-groundwork` | Every session start — core rules, issue-type routing |
| `interview` | Plan a feature (captures intent into a motive charter); standalone for small changes |
| `vertical-slice` | Decompose into conflict-free parallel slices; writes the run ledger |
| `ultrawork` | Max fan-out mode — slice → ledger → dispatch all slices in parallel |
| `implement` | Orchestrate implementation after a plan/interview |
| `diagnose` | Bugs and regressions |
| `advisor-gate` | Before declaring done |
| `prototype` | Design exploration |
| `goal` | Persistent project goal |

## Rules

1. Issue-type routing: bug → diagnose, small change → interview + implement, feature → interview → vertical-slice (writes the run ledger) → fan out junior-orchestrator (or general-purpose for leaf slices satisfying all four carve-out conditions) → advisor gate
2. Advisor gate before declaring done; recorded in the run ledger and enforced by the Stop-gate hook
3. Intent lives in a motive charter at `.groundwork/motives/<slug>/motive.md` with a compiled Decision Log; charters are runtime state and are not committed
4. Interview before slicing — understanding before synthesis

## Motive MAP — human entry point

Each motive maintains a human-readable MAP at `.groundwork/motives/<slug>/MAP.md`. It is auto-regenerated and shows the motive's slices and progress in prose form. Open this file to review progress without running any CLI commands.

The ledger and journal CLIs (`bin/ledger`, `bin/journal`) are the implementation detail behind the MAP — they mutate run state; the MAP surfaces it for humans.

## Run ledger (`.groundwork/runs/<session_id>.json`)

Non-trivial runs are tracked in a per-session ledger the Stop-gate hook (`hooks/stop-gate.mjs`) enforces. Legacy `.groundwork/run.json` is still honored for in-flight runs. Key fields:

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

## Agents (Pi)

When using Pi with `pi-subagents`, the following agent types are auto-configured:

| Agent | Purpose |
|-------|---------|
| `orchestrator` | Main workflow coordinator |
| `junior-orchestrator` | Sub-domain orchestrator; default target for non-trivial implementation |
| `advisor` | Strategic decisions, architecture, code review |
| `general-purpose` | Leaf implementation for slices meeting all four carve-out conditions |
| `designer` | UI/UX, styling, responsive design |
| `explore` | Codebase exploration (read-only) |

## Architecture

- `src/` — shared TypeScript source (`src/lib/`, `src/runtime.ts`)
- `pi/pi.ts` — Pi extension entry point (compiled-TS; the one platform that is source, not a static `.<platform>-plugin/` manifest)
- `pi/pi-commands/`, `pi/pi-tools/` — Pi-only commands and tools
- `.pi/skills/` — Pi skill definitions
- `.codex-plugin/plugin.json` — Codex plugin manifest
