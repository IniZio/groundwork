# Groundwork Agent Conventions

This package supports **Claude Code**, **OpenCode**, **Pi**, **Kimi Code CLI**, and **Codex** from a single model-neutral source of truth. For full developer reference, see [`docs/development.md`](docs/development.md).

## Bootstrapping

Load the `/groundwork:use-groundwork` skill at session start to activate full skill routing, planning conventions, and BDD implementation rules.

## Editing Agents

- **Behavior change:** edit `agents-src/<name>.md` (model-neutral; no `model:` field).
- **Model change:** edit `model-registry.json` (`pi` / `opencode` / `claude-code` columns).
- **Regenerate:** `pnpm run generate:agents`
- **Verify:** `pnpm run check`

Do **not** hand-edit `agents/`, `agents-pi/`, `agents-opencode/`, or `src/lib/agent-definitions.generated.ts` — they are generated output.

## WARNING: `plugin.json`

Never add an `agents` key to `.claude-plugin/plugin.json`. The loader rejects it with `agents: Invalid input` and **disables the entire plugin**. Agents are auto-discovered from `agents/` with no manifest key.

## Background Subagents (OpenCode)

Background execution uses opencode's native `background: true` on the `task` tool. Requires:

```
OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=1
```

Add to `~/.bashrc` or `~/.profile` and restart opencode.

## Testing

- Unit tests: `pnpm exec vitest run`
- Acceptance: `pnpm exec vitest run test/acceptance`
- Smoke tests: see `.pi/skills/pi-test-harness/SKILL.md`
