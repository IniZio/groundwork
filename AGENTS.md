# Groundwork Agent Conventions

## Dual-Platform Package

This package supports both **OpenCode** and **Pi** from a single model-neutral source of truth:

- OpenCode entry: `.opencode/plugins/groundwork.js`
- Pi entry: `src/pi.ts`
- Shared logic: `src/lib/`

## Agent Definitions

### Canonical source (model-neutral)

**`agents/*.md`** is the single canonical source for all agent prompts and behavior. These files are **model-neutral** — they contain **no `model:` field**. Edit them to change what an agent *does* (description, tools, prompt body, `prompt_mode`).

### Model registry

**`model-registry.json`** is the single source of truth for *which model* each agent uses, per platform. Each agent maps to a model for `pi` and `opencode`:

```jsonc
{
  "agents": {
    "advisor": { "pi": "zai/glm-5.2",         "opencode": "zai/glm-5.2" },
    "coder":   { "pi": "neuralwatt/Qwen/...",  "opencode": "neuralwatt/Qwen/..." }
  },
  "disabled": { "pi": [], "opencode": [] },
  "aliases":  { "opencode": { "explore": "explorer" } }
}
```

The registry also carries:

- **`disabled`** — per-platform array of agent names to suppress.
- **`aliases`** — per-platform rename map. The source file stays `agents/explore.md`, but on opencode it is emitted as `explorer.md` to match opencode's native agent name.

### Codegen pipeline

`pnpm run generate:agents` runs `scripts/generate-agent-definitions.ts`, which:

1. Reads every `agents/*.md` (model-neutral source).
2. Reads `model-registry.json` (per-platform model assignments, `disabled` list, `aliases`).
3. Emits three generated artifacts:
   - **`agents-pi/*.md`** — Pi-flavored agent files (Pi model strings injected, Pi-disabled agents dropped).
   - **`agents-opencode/*.md`** — OpenCode-flavored agent files (OpenCode model IDs injected, aliases applied).
   - **`src/lib/agent-definitions.generated.ts`** — embedded roster for install-and-go writes (also emits builtin `Explore`/`Plan` disable stubs so pi-subagents' builtins defer to groundwork's `explore`/planning agents).

**Check mode:** `pnpm run check:agents` re-runs the generator with `--check` and fails if any generated artifact is stale. It is chained into `pnpm run check` (which also runs `tsc --noEmit`). **Run `pnpm run check` before committing.**

### Runtime

- **Pi** (`src/pi.ts`): points pi-subagents at the generated `agents-pi/` directory via `PI_SUBAGENTS_EXTRA_AGENTS_DIR`. No runtime preprocessing — the directory is already platform-correct.
- **OpenCode** (`.opencode/plugins/groundwork.js`): reads from the generated `agents-opencode/` directory.

### Workflow

1. **Behavior change?** Edit `agents/<name>.md` (the prompt, tools, description).
2. **Model change?** Edit `model-registry.json` (the `pi` / `opencode` value for that agent).
3. **Disable an agent?** Add its name to `model-registry.json` → `disabled.<platform>` (or set its model to `DISABLED`).
4. **Rename per platform?** Add an entry to `model-registry.json` → `aliases.<platform>`.
5. Regenerate: `pnpm run generate:agents`
6. Verify: `pnpm run check`

### Do NOT hand-edit generated files

The following are **generated** — never edit them directly:

- `agents-pi/*.md`
- `agents-opencode/*.md`
- `src/lib/agent-definitions.generated.ts`

`src/lib/agent-definitions.ts` is a thin re-export layer over the generated file. The embedded roster is intended for install-and-go writes to `.pi/agents/*.md` when `agent-setup` is wired. User customizations in `.pi/agents/` are preserved (remove the `managed_by: groundwork` marker to opt out of auto-updates).

### Pi vs OpenCode at a glance

| | Pi | OpenCode |
|---|---|---|
| Canonical source | `agents/*.md` (shared) | `agents/*.md` (shared) |
| Model assignment | `model-registry.json` → `agents.*.pi` | `model-registry.json` → `agents.*.opencode` |
| Generated dir | `agents-pi/` | `agents-opencode/` |
| Runtime entry | `src/pi.ts` | `.opencode/plugins/groundwork.js` |
| Aliases applied | no | yes (`explore` → `explorer`) |

Keep behavioral parity where agents exist on both sides; model fields will differ by design. The roster includes specialists such as `debugger`, `planner`, `critic`, `verifier`, and `test-engineer`.

This ensures:

- Single model-neutral source of truth (`agents/`) for behavior
- Single registry (`model-registry.json`) for model assignments
- Deterministic per-platform sync via code generation

## Background Subagents

The plugin **does not** ship its own background-task tools. The previous custom tools (`background_task`, `background_output`, `background_result`, `background_list`, `background_kill`, `background_wait`, and the `background-manager.ts` runtime) have been **removed**.

Background execution now uses **opencode's native `background: true` parameter** on the `task` tool. To enable it, set:

```
OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=1
```

There is no `background-manager.ts` and no custom background tool surface to maintain.

## Frontmatter Mapping

Source files (`agents/*.md`) carry **no `model:` field** — models live in `model-registry.json`. The generated platform files inject the platform-appropriate `model:` value during codegen.

| Groundwork (source) | Pi / OpenCode (generated) | Status |
|---|---|---|
| `description` | `description` | ✅ Supported |
| — (registry) | `model` | ✅ Injected from `model-registry.json` at generate time |
| `thinking` | `thinking` | ✅ Supported |
| `temperature` | — | ❌ Dropped (not supported by pi-subagents) |
| `permission` | `permission` | ✅ Supported via pi-permission-system |
| `tools` | `tools` | ✅ CSV list |
| `prompt_mode` | `prompt_mode` | ✅ `replace` or `append` |
| `enabled` | `enabled` | ✅ `false` to disable (or use registry `disabled` list) |

## Testing

- Unit tests: `pnpm exec vitest run`
- Acceptance tests: `pnpm exec vitest run test/acceptance`
- Smoke tests: see `.pi/skills/pi-test-harness/SKILL.md`
