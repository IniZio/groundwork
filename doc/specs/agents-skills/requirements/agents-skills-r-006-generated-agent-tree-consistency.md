---
id: "agents-skills-r-006"
type: requirement
title: "Generated agent tree consistency"
concept: C-AGENTS-SKILLS
criticality: must
verification: unverified
status: open
---

## AGENTS-SKILLS-R-006 — Generated agent tree consistency {#agents-skills-r-006}

The `pnpm run check:agents` script **shall** exit 0 on every working tree where `agents/` is in sync with `agents-src/` and `model-registry.json`, and **shall** exit non-zero and report specific stale, missing, or extraneous files when any drift is detected. The `pnpm run check` aggregate **shall** include `check:agents` as a required gate.

- **Why** — `agents/` and the Codex-facing `skills/` copies are generated from two authority sources (`agents-src/` and `model-registry.json`). Any edit to either authority without regenerating the output tree creates silent divergence that affects agent behaviour in Claude Code. A CI-equivalent check transforms this from a manual discipline into a verifiable invariant.
- **Fit criterion** — Edit any file under `agents-src/` without running `generate:agents`. Running `pnpm run check:agents` **shall** exit non-zero and name the stale or missing file. Re-running after `pnpm run generate:agents` **shall** exit 0 with no stderr output.
- **Verification**: unverified — candidate: `pnpm run check:agents` (invokes `scripts/generate-agent-definitions.ts --check`); included in `pnpm run check` aggregate.
- **Criticality**: must
