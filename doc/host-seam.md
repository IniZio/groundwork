# Host-seam portability layer

groundwork generates host-specific agent definition files from a single
model-neutral source. This document is the authoritative description of that
seam. **Getting the tree classification wrong causes people to edit the wrong
files** — read this before touching any agent or skill file.

---

## Tree classification

| Tree | Role | Edit rule |
|---|---|---|
| `agents-src/*.md` | **AUTHORITY** — model-neutral source | Hand-edit here |
| `agents/*.md` | **GENERATED** — Claude Code output | Never hand-edit; run `pnpm run generate:agents` |
| `agents-pi/*.md` | **GENERATED** — Pi/OMP output | Never hand-edit; run `pnpm run generate:agents` |
| `src/lib/agent-definitions.generated.ts` | **GENERATED** — embedded Pi TypeScript | Never hand-edit; run `pnpm run generate:agents` |
| `skills/groundwork/` | **AUTHORITY** — skill source tree | Hand-edit here |
| `skills/` | **GENERATED** — Codex-facing flattened mirror of `skills/groundwork/` | Never hand-edit; run `pnpm run generate:agents` |
| `.pi/skills/` | **INDEPENDENT** — Pi skill overlay (not generated from `skills/groundwork/`) | Hand-edit here; run `pnpm run check:pi` after changes |

The `.pi/skills/` tree is neither generated nor authoritative for Claude Code —
it is a hand-maintained Pi overlay. `check:pi` detects byte-level drift for the
subset of files that track authority sources.

---

## Generator: inputs and outputs

Generator: `scripts/generate-agent-definitions.ts`
Run via: `pnpm run generate:agents`

### Inputs

| Input | Description |
|---|---|
| `agents-src/*.md` | Model-neutral agent definitions (Markdown + YAML frontmatter) |
| `model-registry.json` | Per-platform model assignments and alias/disable lists |
| `package.json` | `version` field — stamped into every generated file as `groundwork_version` |
| `skills/groundwork/` | Authority skill tree (source for the `skills/` Codex mirror) |
| `partials/` | Injectable rule-text fragments (injected into target files between marker comments) |
| `CLAUDE.md` | Receives the model table injection between `<!-- AGENT-MODELS:BEGIN -->` / `<!-- AGENT-MODELS:END -->` |

### Platform output trees

The generator iterates `PLATFORMS = ["pi", "claude-code"]` and writes one
output tree per platform:

| Platform | Output tree | Model assignment |
|---|---|---|
| `claude-code` | `agents/` | `model-registry.json` `claude-code` column, injected as `model:` frontmatter |
| `pi` | `agents-pi/` | Session inherit — no `model:` frontmatter emitted; no registry column exists for pi |

Output directory formula (line 825 of the generator):
```
platform === "claude-code"  →  agents/
otherwise                   →  agents-${platform}   (e.g. agents-pi/)
```

### Additional generator outputs

- `src/lib/agent-definitions.generated.ts` — embeds Pi agent definitions as
  TypeScript constants for runtime use by the pi branch.
- `skills/` — Codex-facing flattened copies of `skills/groundwork/`. Skill
  directories may carry `.codex-overlays/` subdirectories to override specific
  files for the Codex projection without affecting Claude Code or Pi.
- `CLAUDE.md` — the agent-to-model dispatch table is regenerated in-place
  between the `<!-- AGENT-MODELS:BEGIN -->` / `<!-- AGENT-MODELS:END -->` markers.

---

## model-registry.json platform columns

`model-registry.json` maps each agent name to its per-platform model.

### Columns

**`claude-code`** (required for every agent)
The model alias (`sonnet`, `opus`, `haiku`, `fable`) or an explicit `claude-*`
model ID. Injected as the `model:` frontmatter field in `agents/<name>.md`.
Tier aliases resolve to the provider's latest version at runtime; pin exact
versions via env vars in user `~/.claude/settings.json`:

```
ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-6
ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-5
ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-3-5
ANTHROPIC_DEFAULT_FABLE_MODEL=...
```

**`codex`** (optional; present only on `CODEX_MODEL_GUIDANCE_ROLES` agents)
Present on `explore`, `general-purpose`, and `junior-orchestrator`. This is
**not** a platform that produces an `agents-codex/` tree — Codex consumes skills
rather than agent definition files. The value is injected as model routing
guidance into skill content (in `skills/use-groundwork/reference/agent-selection.md`
between `<!-- CODEX-MODEL-ROUTING:BEGIN -->` / `<!-- CODEX-MODEL-ROUTING:END -->`).

**`pi`** — not a registry column. Pi agents inherit the session model; the
`agents-pi/` tree carries no `model:` frontmatter. Do not add a `pi` column to
the registry — the generator's comment explicitly forbids it.

---

## Adding a new host platform

To add a host that receives its own agent definition tree, update **all** of
the following surfaces. The contract test
(`test/scripts/host-seam-contract.test.ts`) enforces that documentation stays
current: adding a registry column without updating this file fails the test.

1. **`scripts/generate-agent-definitions.ts`** — add the platform name to the
   `PLATFORMS` array and implement a `transformFor<Platform>` function (see
   `transformForPi` and `transformForClaudeCode` for the pattern). Update the
   output-directory formula if the new platform's tree does not follow
   `agents-${platform}`.

2. **`model-registry.json`** — add a per-agent column for the new platform on
   every agent entry (if model assignment is needed). Omit if the platform
   inherits the session model the way pi does.

3. **Run `pnpm run generate:agents`** — creates (or regenerates) the
   `agents-<platform>/` output tree and updates all other generated surfaces.

4. **`doc/host-seam.md`** (this file) — add the new platform to the
   "Platform output trees" table and to the column descriptions above.

5. **`pnpm run check`** — verify all checks pass on the new tree.

### Adding a skill-only host (Codex pattern)

If the new host consumes skills but not agent definition files:

1. Add to `CODEX_MODEL_GUIDANCE_ROLES` in `scripts/generate-agent-definitions.ts`.
2. Add registry entries for the relevant agents.
3. Document the new column here.

---

## Checks

| Check | Command | What it enforces |
|---|---|---|
| `check:agents` | `pnpm run check:agents` | All generated files (`agents/`, `agents-pi/`, `src/lib/agent-definitions.generated.ts`, `skills/` mirror, CLAUDE.md model table) are in sync with source. Exits 1 if any file is missing or stale. |
| `check:pi` | `pnpm run check:pi` | Selected `.pi/skills/` files are byte-for-byte mirrors of their authority sources in `skills/groundwork/`; detects drift. |
| `check:sep` | `pnpm run check:sep` | Enforces bookkeeping separation (human docs vs agent artefacts). |
| `check:versions` | `pnpm run check:versions` | Version fields across manifest files are consistent. |
| `check` (full) | `pnpm run check` | Runs all of the above + `tsc --noEmit`. |
| host-seam contract | `npx vitest run test/scripts/host-seam-contract.test.ts` | Registry platform columns are documented in this file; every `agents-src/` agent has a generated file in each output tree. |
