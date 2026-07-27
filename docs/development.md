# Groundwork Developer Reference

Full agent conventions and development workflows. For the lean session bootstrap, see [`AGENTS.md`](../AGENTS.md).

## Multi-Platform Package

This package supports **Claude Code**, **Pi**, and **Codex** from a single model-neutral source of truth:

- Claude Code entry: `.claude-plugin/plugin.json`
- Pi entry: `pi/pi.ts` (compiled-TS extension source under `pi/`; pi-only code in `pi/pi-commands/`, `pi/pi-tools/`)
- Codex entry: `.codex-plugin/plugin.json`
- Shared logic: `src/lib/`

## Agent Definitions

### Canonical source (model-neutral)

**`agents-src/*.md`** is the single canonical source for all agent prompts and behavior. These files are **model-neutral** — they contain **no `model:` field**. Edit them to change what an agent *does* (description, tools, prompt body, `prompt_mode`).

`agents/`, `agents-pi/` are **generated output** — never edit them directly.

### Model registry

**`model-registry.json`** is the single source of truth for *which model* each agent uses, per platform. Each agent maps to a model for `pi` and `claude-code`:

```jsonc
{
  "agents": {
    "advisor": { "pi": "zai/glm-5.2", "claude-code": "opus" },
    "general-purpose": { "pi": "neuralwatt/Qwen/...", "claude-code": "claude-sonnet-4-6" }
  },
  "disabled": { "pi": [], "claude-code": [] },
  "aliases":  { "pi": {}, "claude-code": {} }
}
```

The `claude-code` column uses explicit full model IDs for the Sonnet tier (`claude-sonnet-4-6`) and the `opus`/`haiku` aliases for those tiers.

The registry also carries:

- **`disabled`** — per-platform array of agent names to suppress.
- **`aliases`** — per-platform rename map (currently empty).

### Codegen pipeline

`pnpm run generate:agents` runs `scripts/generate-agent-definitions.ts`, which:

1. Reads every `agents-src/*.md` (model-neutral source).
2. Reads `model-registry.json` (per-platform model assignments, `disabled` list, `aliases`).
3. Emits **three** generated artifacts targeting **two platforms**:
   - **`agents/*.md`** — Claude Code-flavored agent files (Claude aliases injected, `claude-code`-disabled agents dropped).
   - **`agents-pi/*.md`** — Pi-flavored agent files (Pi model strings injected, Pi-disabled agents dropped).
   - **`src/lib/agent-definitions.generated.ts`** — embedded roster for install-and-go writes.

**Check mode:** `pnpm run check:agents` re-runs the generator with `--check` and fails if any generated artifact is stale. It is chained into `pnpm run check` (which also runs `tsc --noEmit`). **Run `pnpm run check` before committing.**

### Runtime

- **Claude Code** (`.claude-plugin/plugin.json`): auto-discovers agents from the generated `agents/` directory. No manifest `agents` key — adding one breaks the plugin (see WARNING below).
- **Pi** (`pi/pi.ts`): points pi-subagents at the generated `agents-pi/` directory via `PI_SUBAGENTS_EXTRA_AGENTS_DIR`. No runtime preprocessing — the directory is already platform-correct. Pi is the one platform whose plugin is a compiled-TS extension (plain `pi/` source folder; no `.<platform>-plugin/plugin.json`).

### Codex

Codex discovers the root `.codex-plugin/plugin.json` manifest and direct skill
directories under `skills/`. The direct Codex skill files are generated from the
canonical `skills/groundwork/` tree by `pnpm run generate:agents`; Codex-specific
frontmatter normalization is applied during that generation.

### Workflow

1. **Behavior change?** Edit `agents-src/<name>.md` (the prompt, tools, description).
2. **Model change?** Edit `model-registry.json` (the `pi` / `claude-code` value for that agent).
3. **Disable an agent?** Add its name to `model-registry.json` → `disabled.<platform>` (or set its model to `DISABLED`).
4. **Rename per platform?** Add an entry to `model-registry.json` → `aliases.<platform>`.
5. Regenerate: `pnpm run generate:agents`
6. Verify: `pnpm run check`

### Do NOT hand-edit generated files

The following are **generated output** — never edit them directly:

- `agents/*.md` — Claude Code platform output
- `agents-pi/*.md` — Pi platform output
- `src/lib/agent-definitions.generated.ts`

Edit **`agents-src/*.md`** instead. The generator overwrites all `agents*/` directories on every run.

`src/lib/agent-definitions.ts` is a thin re-export layer over the generated file.

### WARNING: do not add `agents` to `.claude-plugin/plugin.json`

**Never add an `agents` key to `.claude-plugin/plugin.json`.** The Claude Code loader rejects it with `agents: Invalid input` and **disables the entire plugin** — all agents and skills stop working. Agents are auto-discovered from `agents/` with no manifest key. (Confirmed by a live regression on 2026-06-26: adding the key broke the plugin; removing it restored it.)

### Claude Code vs Pi vs Codex at a glance

| | Claude Code | Pi | Codex |
|---|---|---|---|
| Canonical source | `agents-src/*.md` (shared) | `agents-src/*.md` (shared) | `skills/groundwork/*/SKILL.md` |
| Model assignment | `model-registry.json` → `agents.*.claude-code` | `model-registry.json` → `agents.*.pi` | model-neutral; no registry injection |
| Generated dir | `agents/` | `agents-pi/` | direct `skills/<name>/` |
| Runtime entry | `.claude-plugin/plugin.json` | `pi/pi.ts` | `.codex-plugin/plugin.json` |
| Aliases applied | yes (currently none) | no | no |
| Install step | — | — | Codex plugin directory |

Keep behavioral parity where agents exist on both sides; model fields will differ by design. The roster includes 9 specialists: `orchestrator`, `general-purpose`, `planner`, `advisor` (evidence-gathering + quality review + final APPROVE gate), `qa` (live browser/TUI/CLI testing), `designer`, `test-engineer`, `git-master`, and `explore`.

> **Note:** `verifier` was merged into `critic`; `critic` has since been merged into `advisor`. `advisor` now handles strategic decisions, fresh-evidence completion gating, code/plan quality review, and the final APPROVE/REVISE/REJECT verdict. A new `qa` agent handles live interactive testing, fixture generation, and background-env handoff. The completion flow is: `[qa if interactive UI] → advisor`.

This ensures:

- Single model-neutral source of truth (`agents-src/`) for behavior
- Single registry (`model-registry.json`) for model assignments per platform
- Deterministic per-platform sync via code generation

## Background Subagents

The plugin **does not** ship its own background-task tools. Background execution uses the host agent's native `background: true` parameter on the `task` tool.

## Frontmatter Mapping

Source files (`agents-src/*.md`) carry **no `model:` field** — models live in `model-registry.json`. The generated platform files inject the platform-appropriate `model:` value during codegen.

| Groundwork (source) | Claude Code (generated) | Status |
|---|---|---|
| `description` | `description` | ✅ Supported |
| — (registry) | `model` | ✅ Injected from `model-registry.json` at generate time |
| `thinking` | `thinking` | ✅ Supported |
| `tools` | `tools` | ✅ CSV list |
| `prompt_mode` | `prompt_mode` | ✅ `replace` or `append` |
| `enabled` | `enabled` | ✅ `false` to disable (or use registry `disabled` list) |

## Testing

- Unit tests: `pnpm exec vitest run`
- Acceptance tests: `pnpm exec vitest run test/acceptance`
- Smoke tests: see `.pi/skills/pi-test-harness/SKILL.md`
