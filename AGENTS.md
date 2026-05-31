# Groundwork Agent Conventions

## Dual-Platform Package

This package supports both **OpenCode** and **Pi**:

- OpenCode entry: `.opencode/plugins/groundwork.js`
- Pi entry: `src/pi.ts`
- Shared logic: `src/lib/`

## Agent Definitions

Agent definitions are embedded in `src/lib/agent-definitions.ts` and written to `.pi/agents/*.md` at runtime. This ensures:

- Install-and-go: no manual file copying
- Auto-updates on plugin version bumps
- User customizations preserved (remove `managed_by: groundwork` to opt out)

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
