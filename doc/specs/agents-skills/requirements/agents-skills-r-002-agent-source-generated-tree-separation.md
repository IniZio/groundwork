---
id: "agents-skills-r-002"
type: requirement
title: "Agent source/generated tree separation"
concept: C-AGENTS-SKILLS
criticality: must
verification: automated
status: open
---

## AGENTS-SKILLS-R-002 — Agent source/generated tree separation {#agents-skills-r-002}

The groundwork agent repository **shall** maintain `agents-src/` as the hand-edited source for agent definitions and `agents/` as the generated output produced exclusively by `pnpm run generate:agents`; the `agents/` tree **shall not** be hand-edited.

- **Why** — `agents/` files are completely overwritten on each `generate:agents` run. A hand-edit to `agents/` appears to work until the next generation pass, at which point the change is silently lost. Because model assignments are injected from `model-registry.json` during generation, a hand-edit can also produce an agent file with a stale or wrong model tier that bypasses the guard.
- **Fit criterion** — `pnpm run check:agents` exits 0 on a clean working tree immediately after `generate:agents`. Making any edit to a file under `agents/` without re-running the generator causes `check:agents` to exit non-zero and report the stale file by name.
- **Verification**: automated — `pnpm run check:agents` (invokes `scripts/generate-agent-definitions.ts --check`); included in `pnpm run check` aggregate.
- **Criticality**: must
