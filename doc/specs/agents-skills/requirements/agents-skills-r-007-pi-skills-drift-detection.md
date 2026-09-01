---
id: "agents-skills-r-007"
type: requirement
title: "Pi skills drift detection"
concept: C-AGENTS-SKILLS
criticality: must
verification: unverified
status: open
---

## AGENTS-SKILLS-R-007 — Pi skills drift detection {#agents-skills-r-007}

**If** a file listed in the `check-pi-skills.mjs` MANIFEST differs byte-for-byte from its declared authority source in `skills/groundwork/`, **then** `pnpm run check:pi` **shall** exit non-zero and report the diverged file path. The `pnpm run check` aggregate **shall** include `check:pi` as a required gate.

- **Why** — `.pi/skills/` is independently maintained but certain files inside it are declared mirrors of `skills/groundwork/` authority sources. When the authority is updated (for example, a routing rule changes in `use-groundwork/SKILL.md`) the Pi copy must be synced manually. Without `check:pi`, drift accumulates silently: Pi receives stale routing guidance while groundwork's canonical tree is current, producing inconsistent agent behaviour across platforms.
- **Fit criterion** — Modify one byte of a MANIFEST authority file (e.g. `skills/groundwork/use-groundwork/SKILL.md`) without updating its Pi copy. Running `pnpm run check:pi` **shall** exit 1 and print the drifted path. Restore the file and run again; it **shall** exit 0.
- **Verification**: automated — `pnpm run check:pi` (invokes `scripts/check-pi-skills.mjs`); included in `pnpm run check` aggregate.
- **Criticality**: must
