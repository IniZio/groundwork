---
id: "agents-skills-r-001"
type: requirement
title: "Skill three-tree authority model"
concept: C-AGENTS-SKILLS
criticality: must
verification: hybrid
status: open
---

## AGENTS-SKILLS-R-001 — Skill three-tree authority model {#agents-skills-r-001}

The groundwork skill repository **shall** maintain three distinct skill trees with explicit authority relationships: `skills/groundwork/` is the hand-edited AUTHORITY source; `skills/` is a GENERATED mirror produced exclusively by `pnpm run generate:agents` and **shall not** be hand-edited; `.pi/skills/` is an INDEPENDENT Pi-overlay tree that is hand-edited and validated against declared authority sources by `pnpm run check:pi`.

- **Why** — Editing `skills/` directly produces content that is silently overwritten on the next `generate:agents` run. Editing `.pi/skills/` manifest files without running `check:pi` produces byte-level drift between the Pi copy and its authority source that only manifests when Pi receives stale routing guidance. Both failure modes have recurred in this codebase: a `.pi` drift turned `pnpm run check` red mid-session.
- **Fit criterion** — After any edit to `skills/groundwork/`, running `pnpm run generate:agents` followed by `pnpm run check:agents` exits 0. A hand-edit made directly to `skills/` without regeneration causes `pnpm run check:agents` to exit non-zero and name the stale file. After any edit to a `.pi/skills/` MANIFEST file, `pnpm run check:pi` exits 0.
- **Verification**: hybrid — `check:agents` and `check:pi` are automated; the AUTHORITY/GENERATED/INDEPENDENT labelling is verified by inspection of directory headers and generator script comments.
- **Criticality**: must
