# Groundwork Agent Conventions

## Dual-Platform Package

This package supports both **OpenCode** and **Pi**:

- OpenCode entry: `.opencode/plugins/groundwork.js`
- Pi entry: `src/pi.ts`
- Shared logic: `src/lib/`

## Agent Definitions

**Canonical source:** `agents-pi/*.md` — edit these files to change Pi agent behavior.

**Runtime:** `src/pi.ts` points pi-subagents at `agents-pi/` directly via `PI_SUBAGENTS_EXTRA_AGENTS_DIR`. No runtime preprocessing.

**Embedded copy:** `src/lib/agent-definitions.generated.ts` is generated from `agents-pi/` (plus builtin `Explore`/`Plan` disable stubs). `src/lib/agent-definitions.ts` is a thin re-export layer. The embedded roster is intended for install-and-go writes to `.pi/agents/*.md` when `agent-setup` is wired.

### Workflow

1. Edit agent prompts/models in `agents-pi/<name>.md`
2. Regenerate embedded definitions: `pnpm run generate:agents`
3. Verify in CI/local check: `pnpm run check:agents` (also runs as part of `pnpm run check`)

Do **not** hand-edit `src/lib/agent-definitions.generated.ts`.

The Pi roster includes specialists such as `debugger`, `planner`, `critic`, `verifier`, `security-reviewer`, and `test-engineer`. `oracle` is intentionally disabled (`enabled: false` in `agents-pi/oracle.md`) because `advisor` covers that role.

### OpenCode vs Pi

- **OpenCode / Claude:** `agents/*.md` (Claude model IDs in `model:`)
- **Pi:** `agents-pi/*.md` (Pi provider model strings in `model:`)

Keep behavioral parity where agents exist on both sides; model fields will differ by design.

This ensures:

- Single source of truth per platform (`agents-pi/` for Pi)
- Deterministic embedded sync via code generation
- User customizations preserved in `.pi/agents/` (remove `managed_by: groundwork` to opt out of auto-updates)

## Frontmatter Mapping

| Groundwork | Pi Frontmatter | Status |
|---|---|---|
| `description` | `description` | ✅ Supported |
| `model` | `model` | ✅ Supported |
| `thinking` | `thinking` | ✅ Supported |
| `temperature` | — | ❌ Dropped (not supported by pi-subagents) |
| `permission` | `permission` | ✅ Supported via pi-permission-system |
| `tools` | `tools` | ✅ CSV list |
| `prompt_mode` | `prompt_mode` | ✅ `replace` or `append` |
| `enabled` | `enabled` | ✅ `false` to disable |

## Testing

- Unit tests: `pnpm exec vitest run`
- Acceptance tests: `pnpm exec vitest run test/acceptance`
- Smoke tests: see `.pi/skills/pi-test-harness/SKILL.md`
