---
id: "agents-skills-r-007"
type: requirement
title: "Pi skills drift detection"
concept: C-AGENTS-SKILLS
criticality: must
verification: automated
status: open
---

## AGENTS-SKILLS-R-007 — Pi skills drift detection {#agents-skills-r-007}

**If** a file listed in the `check-pi-skills.mjs` MANIFEST differs byte-for-byte from its declared authority source in `skills/groundwork/`, **then** `pnpm run check:pi` **shall** exit non-zero and report the diverged file path. The `pnpm run check` aggregate **shall** include `check:pi` as a required gate.

- **Why** — `.pi/skills/` is independently maintained but certain files inside it are declared mirrors of `skills/groundwork/` authority sources. When the authority is updated (for example, a routing rule changes in `use-groundwork/SKILL.md`) the Pi copy must be synced manually. Without `check:pi`, drift accumulates silently: Pi receives stale routing guidance while groundwork's canonical tree is current, producing inconsistent agent behaviour across platforms.
- **Fit criterion** — Two conjuncts, both automated: (1) Drift detection: modify one byte of a MANIFEST authority file (e.g. `skills/groundwork/use-groundwork/SKILL.md`) without updating its Pi copy. Running `pnpm run check:pi` **shall** exit 1 and print the drifted path. Restore the file and run again; it **shall** exit 0. (2) Aggregate gate: `package.json`'s `check` script **shall** include `check:pi`; removing it causes the config-invariant test to fail.
- **Verification**: automated — `test/lib/pi-skills-sync.test.ts` (annotated `// @verifies AGENTS-SKILLS-R-007` at two describe blocks): the `check-pi-skills` describe covers conjunct 1 (byte-flip exit codes and DRIFT output); the `check:pi build-configuration invariant` describe covers conjunct 2 (parses the real `package.json` and asserts `check` includes `check:pi`).
- **Criticality**: must
