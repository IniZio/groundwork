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
| `feature-interview` | Feature intent capture into a motive charter, then hands off to planner |
| `quick-interview` | Risky small-change intent capture, then hands off to general-purpose |
| `requirements` | Charter-only intent capture without triggering implementation |
| `vertical-slice` | Decompose into conflict-free parallel slices; writes the run ledger |
| `ultrawork` | Max fan-out mode — slice → ledger → dispatch all slices in parallel |
| `implement` | Orchestrate implementation after intent capture |
| `diagnose` | Bugs and regressions |
| `advisor-gate` | Before declaring done |
| `prototype` | Design exploration |
| `goal` | Persistent project goal |

## Rules

1. Issue-type routing: bug → diagnose, risky small change → quick-interview + implement, feature → feature-interview → vertical-slice (writes the run ledger) → fan out junior-orchestrator (or general-purpose for leaf slices satisfying all four carve-out conditions) → advisor gate
2. Advisor gate before declaring done; recorded in the run ledger and enforced by the Stop-gate hook
3. Intent lives in a motive charter at `.groundwork/motives/<slug>/motive.md` with a compiled Decision Log; charters are runtime state and are not committed
4. Intent capture before slicing — understanding before synthesis (`interview` is the underlying primitive; user-facing callers are `feature-interview`, `quick-interview`, and `requirements`)

## Motive MAP — human entry point

Each motive maintains a human-readable MAP at `.groundwork/motives/<slug>/MAP.md`. It is auto-regenerated and shows the motive's slices and progress in prose form. Open this file to review progress without running any CLI commands.

The ledger and journal CLIs (`bin/ledger`, `bin/journal`) are the implementation detail behind the MAP — they mutate run state; the MAP surfaces it for humans.

## Run ledger (`.groundwork/runs/<session_id>.json`)

Non-trivial runs are tracked in a per-session ledger the Stop-gate hook (`src/gw/hook/stop-gate.ts`, invoked via `bin/gw-hook hook stop-gate`) enforces. Legacy `.groundwork/run.json` is still honored for in-flight runs. Key fields:

- `slices[].blocked_by` — canonical wave-ordering dependency (`depends_on` is a legacy alias); a slice can't be marked `complete` until its blockers are.
- `slices[].acceptance` — `string[]` of checkbox-style, verifiable done-conditions; the Stop-gate surfaces unmet counts.
- `gate.advisor` — accepts the legacy string (`APPROVE`/`REVISE`/`REJECT`) **or** an object `{ verdict, rubric, axes: { correctness, completeness, over_engineering }, citation }` (axes scored 0–3). The run is approved when the string or `verdict` is `APPROVE`.

The advisor gate scores correctness / completeness / over-engineering as independent axes, requires a concrete `citation` on any non-approval, and self-tests before recording a verdict.

**Rejection KB** — `.groundwork/out-of-scope/<concept-slug>.md`: one durable file per rejected concept (reasoning + a *Prior requests* list), scanned at triage to dedup repeat asks by concept rather than re-litigating a settled "no".

## Dev

```bash
pnpm install     # also runs `prepare`, which sets git core.hooksPath → hooks/
pnpm test        # run tests
pnpm run check   # typecheck
```

`dist/gw.mjs` is a bun-target bundle and is not runnable under plain node (`node dist/gw.mjs` throws `TypeError: __require is not a function`); `bin/gw-hook` is the sanctioned entry point.

### Git hook enforcement

**Groundwork repo (this repo):** commit-message linting is active via `core.hooksPath = hooks`, set by `pnpm install` → `scripts/setup-hooks.mjs`. To wire manually: `git config --local core.hooksPath "$(pwd)/hooks"`.

**Any host repo you work in:** on each SessionStart, groundwork auto-installs a `commit-msg` hook into `.git/hooks/commit-msg` of the project you're working on. What the hook enforces depends on the repo:

- **Repo has a `.gitmessage` that groundwork can parse confidently** — groundwork derives THAT project's commit convention from the template's first non-blank line (the specimen) and any type or scope enumeration it contains, then validates the derived rules per rule group independently (`validateRulesPerGroup` over `subjectShape`, `subjectCap`, and `body`) against the repo's 30 most recent non-merge commit messages: each group that clears 85% is enforced; groups below threshold pass freely. If fewer than 10 usable commits are available, universal-only rules apply. Universal rules (attribution-trailer stripping and process-vocabulary rejection) always apply regardless. **Declaration outranks history on the body group**: if the template explicitly declares or invites a body — via a structural section heading (e.g. `-----[ BODY ]-----`) or a prose mention of "body" without prohibiting it (e.g. "Optional body if needed") — the empty-body rule is not applied regardless of history; a line that prohibits a body (e.g. "No body — subject line only.") does not count as a declaration and history decides. The deriver recognises two structural shapes (`type(scope): subject` and `scope: subject`) and two enumeration forms (pipe-separated values and dash-list rows); it falls back to universal-only if the template does not present one of these shapes. Measured outcomes — two distinct mechanisms: **(1) Derivation failure (broken worktrees):** of 16 `nexus-*` repos and 3 `hanlun-lms` repos whose templates carry a body declaration, 13 `nexus-*` repos and 2 `hanlun-lms` repos (hanlun-lms-han871, hanlun-lms-legacy-removal) are broken git worktrees whose parent repository no longer exists; `readRecentSubjects` returns null, derivation fails entirely, and universal-only rules apply — the body-declaration precedence never executes for them. **(2) Declaration precedence (readable history):** the three `nexus-*` repos with readable history — nexus-main, nexus-omp, and nexus-seamless — and hanlun-lms actually exercise the body-declaration logic. Of these, nexus-seamless is the clearest demonstration: 87% of its recent commits omit a body, which is above the 85% threshold — history alone would have enforced the empty-body rule; the template's "Optional body if needed" declaration is what suppresses it. groundwork's own repo enforces empty bodies (its template's "No body — subject line only." matches the prohibition pattern). Any repo whose history cannot be read — broken worktree, shallow clone, fresh repo with no commits — falls through to universal-only rules via the same derivation-failure path.
- **Repo has a `.gitmessage` that groundwork cannot parse** — universal-only rules apply: Claude attribution trailers (`Co-Authored-By:` naming Claude or Anthropic, `Claude-Session:` lines, `Generated with Claude Code` lines) are stripped silently; groundwork process vocabulary (`gate cycle`, slice ids, motive slugs, decision ids) is rejected. No format, length, or body rule is imposed.
- **Repo has no `.gitmessage`** — groundwork tests its own convention (`type(scope): subject`, 72-character subject limit, no commit body) against the repo's history per rule group independently (`validateRulesPerGroup` over the 30 most recent non-merge full commit messages). Subject shape is gate-keeping: if fewer than 85% of recent commits follow the conventional-commit shape, no format rules are imposed and only universal rules apply. When subject shape clears 85%, each of the three groups (subject shape, subject length, body policy) is enforced independently for every group that also clears 85%. **A repo whose own history has never included commit bodies can silently become blocked from writing them** — this is the primary user-visible risk of this path. Universal rules always apply regardless of rule-group outcomes.

The hook never overwrites a `commit-msg` file it did not write (detected by a groundwork version header in the file); skips repos where `core.hooksPath` is already set; and fails safe — warns and exits 0 — if groundwork is later moved or uninstalled. Manual control: `gw hooks status`, `gw hooks install`, `gw hooks uninstall`. Kill-switches: `GROUNDWORK_COMMIT_MSG_HOOK=0` suppresses auto-install and disables the installed hook at commit time; `GROUNDWORK_COMMIT_LINT=0` disables all commit linting across all surfaces.

Enforcement covers message shape only — type, scope, length, and body presence. It cannot detect a well-formed subject that describes different work than the commit contains; human review of the commit content against the stated change remains the only check on subject accuracy.

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
