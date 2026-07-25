# Model customization

How to choose which model each Groundwork agent uses on each platform.

## Overview

Model assignments live in **`model-registry.json`**, not in agent prompt files.

| Concern | Where it lives |
|---|---|
| Behavior (prompt, tools, description) | `agents-src/*.md` — **model-neutral** source |
| Which model each agent uses, per platform | `model-registry.json` — **single registry** |

Source files under `agents-src/` carry **no `model:` field**. Codegen injects the platform-appropriate `model:` value when it emits the generated trees.

Do **not** hand-edit generated output (`agents/`, `agents-pi/`, `agents-opencode/`, `src/lib/agent-definitions.generated.ts`). Change the registry (or `agents-src/`), then regenerate.

## Registry shape

`model-registry.json` has three load-bearing maps plus metadata:

```json
{
  "$schema": "https://groundwork.dev/model-registry/v1",
  "version": "2.2.1",
  "description": "…",
  "agents": { /* name → { pi, opencode, claude-code, … } */ },
  "disabled": { "pi": [], "opencode": [], "claude-code": [] },
  "aliases":  { "pi": {}, "opencode": {}, "claude-code": {} }
}
```

- **`agents`** — per-agent model strings for each platform column.
- **`disabled`** — per-platform array of agent names to suppress (omit from that platform’s generated tree).
- **`aliases`** — per-platform rename map (source name → emitted filename/name). Currently empty on all platforms.

Optional extra columns (for example `codex`) may appear on individual agents; the three codegen platforms are still `pi`, `opencode`, and `claude-code`.

## Current roster (9 agents)

| Agent | `pi` | `opencode` | `claude-code` | Notes |
|---|---|---|---|---|
| `orchestrator` | `inherit` | `inherit` | `opus` | |
| `general-purpose` | `kimi-for-coding` | `kimi-for-coding/k2p7` | `sonnet` | also `codex`: `gpt-5.6-sol` |
| `advisor` | `zai/glm-5.2` | `zai-coding-plan/glm-5.2` | `opus` | |
| `designer` | `kimi-for-coding` | `kimi-for-coding/k2p7` | `sonnet` | |
| `qa` | `zai/glm-5.1` | `zai-coding-plan/glm-5.1` | `sonnet` | |
| `test-engineer` | `zai/glm-5.1` | `zai-coding-plan/glm-5.1` | `sonnet` | |
| `planner` | `zai/glm-5.2` | `zai-coding-plan/glm-5.2` | `opus` | |
| `git-master` | `opencode-go/deepseek-v4-flash` | `opencode-go/deepseek-v4-flash` | `haiku` | |
| `explore` | `opencode-go/deepseek-v4-flash` | `opencode-go/deepseek-v4-flash` | `sonnet` | also `codex`: `gpt-5.6-luna` |

`disabled` is empty on every platform (`[]`). `aliases` is empty on every platform (`{}`).

## Per-platform assignment

Each agent entry uses the three primary columns:

```json
"general-purpose": {
  "pi": "kimi-for-coding",
  "opencode": "kimi-for-coding/k2p7",
  "claude-code": "sonnet",
  "codex": "gpt-5.6-sol"
}
```

| Column | Consumed by | Generated into |
|---|---|---|
| `pi` | Pi / oh-my-pi (`pi/pi.ts` → `PI_SUBAGENTS_EXTRA_AGENTS_DIR`) | `agents-pi/*.md` (+ embedded TS pi roster) |
| `opencode` | OpenCode (`.opencode/plugins/groundwork.js`) | `agents-opencode/*.md` (+ embedded TS opencode roster) |
| `claude-code` | Claude Code (auto-discovers `agents/`) | `agents/*.md` |

To change a model: edit the relevant column in `model-registry.json`, then regenerate (see [Workflow](#workflow-after-any-registry-edit)).

## `claude-code` column conventions

Claude Code accepts:

- Tier aliases: `opus`, `sonnet`, `haiku`
- Explicit full IDs matching `claude-*` (for example `claude-sonnet-4-6`)

**Convention:**

- Sonnet tier → prefer the full ID `claude-sonnet-4-6` when you want a pinned Sonnet SKU.
- Opus / Haiku tiers → use the short aliases `opus` / `haiku`.

The generator rejects unknown `claude-code` values (anything outside those aliases or the `claude-*` ID pattern). `"inherit"` is **not** valid for Claude Code subagent definitions (it *is* valid for Pi/OpenCode, as used by `orchestrator` today).

Current registry values for Sonnet-tier agents use the short alias `sonnet` (see the roster table above). Either form is accepted by codegen; pick the convention your team standardizes on and keep the column consistent.

## Suppress an agent on a platform

Add the agent’s source name to `disabled.<platform>`:

```json
"disabled": {
  "pi": ["designer"],
  "opencode": [],
  "claude-code": []
}
```

That agent is dropped from that platform’s generated tree (and from the matching embedded roster where applicable). Other platforms are unchanged.

You can also set the agent’s model string for that platform to `DISABLED` (the generator treats that as disabled).

## Rename an agent on a platform

Use `aliases.<platform>` — a map from **source name** → **emitted name**:

```json
"aliases": {
  "pi": {},
  "opencode": {
    "explore": "explorer"
  },
  "claude-code": {}
}
```

Today every platform map is empty (`{}`). An entry like the OpenCode example above would emit `agents-src/explore.md` as `explorer.md` (with the aliased definition name) on OpenCode only.

## Workflow after any registry edit

1. Edit `model-registry.json` (model column, `disabled`, or `aliases`).
2. Regenerate:

   ```sh
   pnpm run generate:agents
   ```

   This runs `scripts/generate-agent-definitions.ts`, which:

   1. Reads every `agents-src/*.md` (model-neutral source).
   2. Reads `model-registry.json` (assignments, `disabled`, `aliases`).
   3. Emits **four** generated artifacts for the three agent platforms:
      - **`agents/*.md`** — Claude Code
      - **`agents-pi/*.md`** — Pi
      - **`agents-opencode/*.md`** — OpenCode
      - **`src/lib/agent-definitions.generated.ts`** — embedded pi + opencode roster (includes pi built-in `Explore`/`Plan` disable stubs)

   It also refreshes Codex skill overlays under `skills/` and injects the Claude Code model table into `CLAUDE.md` between the `AGENT-MODELS` markers.

3. Verify:

   ```sh
   pnpm run check
   ```

   `check` = `check:agents` then `tsc --noEmit`.  
   `check:agents` re-runs the generator with `--check` and **fails if any generated artifact is stale** (missing / content-drift / extraneous files under the generated dirs, stale embedded TS, or a stale `CLAUDE.md` model table). On drift it prints:

   ```text
   Agent definition drift detected:
     - …
   Run `pnpm run generate:agents` to regenerate.
   ```

4. Unit tests (optional but recommended after generator-touching work):

   ```sh
   pnpm exec vitest run
   ```

### Do not hand-edit generated files

| Generated (never edit) | Edit instead |
|---|---|
| `agents/*.md` | `agents-src/*.md` + registry |
| `agents-pi/*.md` | `agents-src/*.md` + registry |
| `agents-opencode/*.md` | `agents-src/*.md` + registry |
| `src/lib/agent-definitions.generated.ts` | registry / sources, then regenerate |

## Worked example: change `general-purpose`’s Pi model

Goal: point Pi’s `general-purpose` agent at a different model string.

### 1. Edit the registry

In `model-registry.json`, change only the `pi` column:

```json
"general-purpose": {
  "pi": "my-provider/my-new-model",
  "opencode": "kimi-for-coding/k2p7",
  "claude-code": "sonnet",
  "codex": "gpt-5.6-sol"
}
```

Leave `opencode` / `claude-code` / `codex` alone unless you intend to change those platforms too.

### 2. Regenerate

```sh
pnpm run generate:agents
```

### 3. Verify

```sh
pnpm run check
# optional:
pnpm exec vitest run
```

`check:agents` must report `All agent definitions in sync.`

### 4. What changes on disk

| Path | Why it changes |
|---|---|
| `agents-pi/general-purpose.md` | Pi frontmatter `model:` becomes `my-provider/my-new-model` |
| `src/lib/agent-definitions.generated.ts` | Embedded pi roster content for `general-purpose` updates |

Typically **unchanged** by a Pi-only edit:

- `agents/general-purpose.md` (Claude Code column untouched)
- `agents-opencode/general-purpose.md` (OpenCode column untouched)
- Other agents’ files

If you also changed a `claude-code` value, expect `agents/<name>.md` and the `CLAUDE.md` `AGENT-MODELS` table to update as well.

### 5. Revert

Restore the previous `pi` string (`kimi-for-coding` in the current registry), run `pnpm run generate:agents` again, and re-check.

## Quick reference

| Task | Action |
|---|---|
| Change behavior / tools / prompt | Edit `agents-src/<name>.md` → `pnpm run generate:agents` → `pnpm run check` |
| Change model | Edit `model-registry.json` → `agents.<name>.{pi\|opencode\|claude-code}` → regenerate + check |
| Hide agent on one platform | Add name to `disabled.<platform>` → regenerate + check |
| Rename on one platform | Add `aliases.<platform>.<sourceName> = "<emittedName>"` → regenerate + check |
| Confirm artifacts match registry | `pnpm run check` (staleness gate + `tsc --noEmit`) |

## See also

- `AGENTS.md` — Model registry, codegen pipeline, and platform runtime wiring
- `model-registry.json` — live assignments
- `scripts/generate-agent-definitions.ts` — generator + `--check` implementation
- `agents-src/` — model-neutral agent sources
