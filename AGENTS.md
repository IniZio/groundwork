# Groundwork Agent Conventions

This package supports **Claude Code** and **Codex** from a single model-neutral source of truth. For full developer reference, see [`docs/development.md`](docs/development.md).

## Bootstrapping

Load the `/groundwork:use-groundwork` skill at session start to activate full skill routing, planning conventions, and BDD implementation rules.

## Editing Agents

- **Behavior change:** edit `agents-src/<name>.md` (model-neutral; no `model:` field).
- **Model change:** edit `model-registry.json` (`claude-code` column).
- **Regenerate:** `pnpm run generate:agents`
- **Verify:** `pnpm run check`

Do **not** hand-edit `agents/` or `src/lib/agent-definitions.generated.ts` — they are generated output.

## WARNING: `plugin.json`

Never add an `agents` key to `.claude-plugin/plugin.json`. The loader rejects it with `agents: Invalid input` and **disables the entire plugin**. Agents are auto-discovered from `agents/` with no manifest key.

## Testing

- Unit tests: `pnpm exec vitest run`
- Acceptance: `pnpm exec vitest run test/acceptance`
