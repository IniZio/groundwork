# Groundwork Agent Conventions

## Multi-Platform Package

This package supports **Claude Code**, **OpenCode**, **Pi**, and **Kimi Code CLI** from a single model-neutral source of truth:

- Claude Code entry: `.claude-plugin/plugin.json`
- OpenCode entry: `.opencode/plugins/groundwork.js`
- Pi entry: `src/pi.ts`
- Kimi entry: `.kimi-plugin/plugin.json` (skill manifest)
- Kimi installer: `scripts/install-kimi.sh`
- Shared logic: `src/lib/`

## Agent Definitions

### Canonical source (model-neutral)

**`agents-src/*.md`** is the single canonical source for all agent prompts and behavior. These files are **model-neutral** — they contain **no `model:` field**. Edit them to change what an agent *does* (description, tools, prompt body, `prompt_mode`).

`agents/`, `agents-pi/`, and `agents-opencode/` are **generated output** — never edit them directly. See [Do NOT hand-edit generated files](#do-not-hand-edit-generated-files).

### Model registry

**`model-registry.json`** is the single source of truth for *which model* each agent uses, per platform. Each agent maps to a model for `pi`, `opencode`, and `claude-code`:

```jsonc
{
  "agents": {
    "advisor": { "pi": "zai/glm-5.2", "opencode": "zai/glm-5.2", "claude-code": "opus" },
    "general-purpose": { "pi": "neuralwatt/Qwen/...", "opencode": "neuralwatt/Qwen/...", "claude-code": "sonnet" }
  },
  "disabled": { "pi": [], "opencode": [], "claude-code": [] },
  "aliases":  { "pi": {}, "opencode": {}, "claude-code": {} }
}
```

The `claude-code` column uses **Claude model aliases** (`sonnet`, `opus`, `haiku`) rather than full model IDs.

The registry also carries:

- **`disabled`** — per-platform array of agent names to suppress.
- **`aliases`** — per-platform rename map (currently empty). An entry like `{ "opencode": { "old-name": "new-name" } }` would emit `agents-src/old-name.md` as `new-name.md` on opencode.

### Codegen pipeline

`pnpm run generate:agents` runs `scripts/generate-agent-definitions.ts`, which:

1. Reads every `agents-src/*.md` (model-neutral source).
2. Reads `model-registry.json` (per-platform model assignments, `disabled` list, `aliases`).
3. Emits **four** generated artifacts targeting **three platforms**:
   - **`agents/*.md`** — Claude Code-flavored agent files (Claude aliases injected, `claude-code`-disabled agents dropped).
   - **`agents-pi/*.md`** — Pi-flavored agent files (Pi model strings injected, Pi-disabled agents dropped).
   - **`agents-opencode/*.md`** — OpenCode-flavored agent files (OpenCode model IDs injected, aliases applied).
   - **`src/lib/agent-definitions.generated.ts`** — embedded roster for install-and-go writes (also emits builtin `Explore`/`Plan` disable stubs so pi-subagents' builtins defer to groundwork's `explore`/planning agents).

**Check mode:** `pnpm run check:agents` re-runs the generator with `--check` and fails if any generated artifact is stale. It is chained into `pnpm run check` (which also runs `tsc --noEmit`). **Run `pnpm run check` before committing.**

### Runtime

- **Claude Code** (`.claude-plugin/plugin.json`): auto-discovers agents from the generated `agents/` directory. No manifest `agents` key — adding one breaks the plugin (see WARNING above).
- **Pi** (`src/pi.ts`): points pi-subagents at the generated `agents-pi/` directory via `PI_SUBAGENTS_EXTRA_AGENTS_DIR`. No runtime preprocessing — the directory is already platform-correct.
- **OpenCode** (`.opencode/plugins/groundwork.js`): reads from the generated `agents-opencode/` directory.

### Kimi

Kimi Code CLI discovers skills as directories containing `SKILL.md` under project `.agents/skills/` or user `~/.agents/skills/`. Groundwork ships a Kimi-compatible skill tree at `skills/groundwork/` (for example, `use-groundwork`, `arch-review`, `implement`).

To install the skills into `~/.agents/skills`:

```sh
pnpm run install:kimi
# or
scripts/install-kimi.sh
```

The installer creates symlinks (not copies), so updates to the plugin are reflected automatically. To preview what it would do without changing the filesystem:

```sh
scripts/install-kimi.sh --dry-run
```

Set `TARGET_DIR` to install somewhere other than `~/.agents/skills`:

```sh
TARGET_DIR=./.agents/skills pnpm run install:kimi
```

The installer refuses to overwrite an existing non-symlink directory or a symlink pointing somewhere else; resolve conflicts manually.

### Workflow

1. **Behavior change?** Edit `agents-src/<name>.md` (the prompt, tools, description).
2. **Model change?** Edit `model-registry.json` (the `pi` / `opencode` / `claude-code` value for that agent).
3. **Disable an agent?** Add its name to `model-registry.json` → `disabled.<platform>` (or set its model to `DISABLED`).
4. **Rename per platform?** Add an entry to `model-registry.json` → `aliases.<platform>`.
5. Regenerate: `pnpm run generate:agents`
6. Verify: `pnpm run check`

### Do NOT hand-edit generated files

The following are **generated output** — never edit them directly:

- `agents/*.md` — Claude Code platform output
- `agents-pi/*.md` — Pi platform output
- `agents-opencode/*.md` — OpenCode platform output
- `src/lib/agent-definitions.generated.ts`

Edit **`agents-src/*.md`** instead. The generator overwrites all three `agents*/` directories on every run.

`src/lib/agent-definitions.ts` is a thin re-export layer over the generated file. The embedded roster is intended for install-and-go writes to `.pi/agents/*.md` when `agent-setup` is wired. User customizations in `.pi/agents/` are preserved (remove the `managed_by: groundwork` marker to opt out of auto-updates).

### WARNING: do not add `agents` to `.claude-plugin/plugin.json`

**Never add an `agents` key to `.claude-plugin/plugin.json`.** The Claude Code / opencode loader rejects it with `agents: Invalid input` and **disables the entire plugin** — all agents and skills stop working. Agents are auto-discovered from `agents/` with no manifest key. (Confirmed by a live regression on 2026-06-26: adding the key broke the plugin; removing it restored it.)

### Claude Code vs Pi vs OpenCode vs Kimi at a glance

| | Claude Code | Pi | OpenCode | Kimi |
|---|---|---|---|---|
| Canonical source | `agents-src/*.md` (shared) | `agents-src/*.md` (shared) | `agents-src/*.md` (shared) | `skills/groundwork/*/SKILL.md` |
| Model assignment | `model-registry.json` → `agents.*.claude-code` (aliases: `sonnet`/`opus`/`haiku`) | `model-registry.json` → `agents.*.pi` | `model-registry.json` → `agents.*.opencode` | model-neutral; no registry injection |
| Generated dir | `agents/` | `agents-pi/` | `agents-opencode/` | — |
| Runtime entry | `.claude-plugin/plugin.json` | `src/pi.ts` | `.opencode/plugins/groundwork.js` | `.kimi-plugin/plugin.json` |
| Aliases applied | yes (currently none) | no | yes (currently none) | no |
| Install step | — | — | — | `pnpm run install:kimi` |

Keep behavioral parity where agents exist on both sides; model fields will differ by design. The roster includes 10 specialists: `orchestrator`, `general-purpose`, `planner`, `advisor`, `critic` (evidence-gathering + quality review), `qa` (live browser/TUI/CLI testing), `designer`, `test-engineer`, `git-master`, and `explore`.

> **Note:** `verifier` has been merged into `critic`. `critic` now handles both fresh-evidence completion verification and code/plan quality review. A new `qa` agent handles live interactive testing, fixture generation, and background-env handoff. The completion flow is: `[qa if interactive UI] → critic → advisor`.

This ensures:

- Single model-neutral source of truth (`agents-src/`) for behavior
- Single registry (`model-registry.json`) for model assignments per platform
- Deterministic per-platform sync via code generation

## Background Subagents

The plugin **does not** ship its own background-task tools. The previous custom tools (`background_task`, `background_output`, `background_result`, `background_list`, `background_kill`, `background_wait`, and the `background-manager.ts` runtime) have been **removed**.

Background execution now uses **opencode's native `background: true` parameter** on the `task` tool. To enable it, set:

```
OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=1
```

Add this to `~/.bashrc` or `~/.profile` and **restart opencode**. Without it, `background: true` is unavailable and the plugin's fan-out enforcement hook has no effect.

There is no `background-manager.ts` and no custom background tool surface to maintain.

## Frontmatter Mapping

Source files (`agents-src/*.md`) carry **no `model:` field** — models live in `model-registry.json`. The generated platform files inject the platform-appropriate `model:` value during codegen.

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
