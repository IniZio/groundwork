# Groundwork Agent Conventions

This package supports **Claude Code**, **Pi**, and **Codex** from a single model-neutral source of truth. For full developer reference, see [`docs/development.md`](docs/development.md).

## Bootstrapping

Load the `/groundwork:use-groundwork` skill at session start to activate full skill routing, planning conventions, and BDD implementation rules.

## Editing Agents

- **Behavior change:** edit `agents-src/<name>.md` (model-neutral; no `model:` field).
- **Model change:** edit `model-registry.json` (`claude-code` column; optional `codex` for Codex routing roles). Not `pi` — OMP/Pi do not take models from the registry.
- **Regenerate:** `pnpm run generate:agents`
- **Verify:** `pnpm run check`

Do **not** hand-edit `agents/`, `agents-pi/`, or `src/lib/agent-definitions.generated.ts` — they are generated output. `agents-pi/` is a **model-neutral** session-inherit roster for OMP/Pi (no `model:` frontmatter from the registry); agents inherit the active session model.

## WARNING: `plugin.json`

Never add an `agents` key to `.claude-plugin/plugin.json`. The loader rejects it with `agents: Invalid input` and **disables the entire plugin**. Agents are auto-discovered from `agents/` with no manifest key.

## Testing

- Unit tests: `pnpm exec vitest run`
- Acceptance: `pnpm exec vitest run test/acceptance`
- Smoke tests: see `.pi/skills/pi-test-harness/SKILL.md`
