# Structure

## Top-level directories

| Path | Contents |
|---|---|
| `agents/` | Compiled agent definition files |
| `agents-src/` | Source agent definitions (Markdown with YAML frontmatter) |
| `commands/` | Claude Code slash-command scripts |
| `docs/` | Spec tree (`docs/spec/`) and steering documents (`docs/steering/`) |
| `hooks/` | PreToolUse / Stop / SessionStart hook scripts + CLIs |
| `hooks/lib/` | Shared helpers for hooks (hook-io.mjs, spec-io.mjs) |
| `scripts/` | Build and utility scripts |
| `skills/` | Skill definition files by namespace |
| `src/` | TypeScript source |
| `test/` + `tests/` | Vitest test files |
| `.groundwork/` | Runtime artefacts: run ledgers, RFCs, journal shards, plans |
| `.claude/` | Claude Code project settings (settings.json with hooks) |

## Key files

- `CLAUDE.md` — orchestrator mode instructions; loaded by Claude Code at session start
- `hooks/hooks.json` — canonical hook registration; referenced by `.claude/settings.json`
- `model-registry.json` — agent-to-model mapping used by CLAUDE.md dispatch table
- `plugin.json` — plugin manifest consumed by the Claude Code plugin loader

## Conventions

- Hook CLIs are kebab-named `.mjs` files in `hooks/`.
- Agent source files are `agents-src/<name>.md` with YAML frontmatter.
- Skills live at `skills/<namespace>/<skill-name>/SKILL.md`.
- Spec requirements live at `docs/spec/<concept-dir>/requirements/<kebab-name>.md`.
- Steering documents live at `docs/steering/<name>.md` (this document is one).
- Runtime state (ledgers, journal shards, plans) lives under `.groundwork/` and is gitignored via `.git/info/exclude`.
