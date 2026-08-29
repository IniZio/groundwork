---
id: "token-economy-r-007"
title: "ASD-STE100 skill is at v0.4.0 or later"
concept: "[[token-economy/index]]"
criticality: must
verification: manual
ears_pattern: Ubiquitous
verification_method: Inspection
status: open
source: "token-economy#D-5"
---

## Statement

The user-level ASD-STE100 skill install at `~/.claude/skills/asd-ste100/` **shall** be upgraded to upstream v0.4.0 with the frontmatter `name` field corrected to the value defined in the upstream manifest.

## Why

The locally installed v0.1.0 is a strict subset of v0.4.0; rules added in v0.2.0–v0.4.0 cover modality preservation and scope-word handling that groundwork's compression model depends on. Running the earlier version silently omits those rules.

## Fit criterion

`cat ~/.claude/skills/asd-ste100/SKILL.md | head -5` shows a `version` or frontmatter field at `0.4.0` or later, and the frontmatter `name` matches the upstream value. The v0.1.0 install no longer exists at that path.

## Verification procedure

**Manual** — reviewer checks the installed version field against the upstream manifest; the repo test suite cannot access the user-level skills directory.

1. Run `cat ~/.claude/skills/asd-ste100/SKILL.md | head -10` to read the frontmatter.
2. Confirm the version is `0.4.0` or later.
3. Confirm the `name` field matches the upstream manifest value (not the locally-patched name from v0.1.0).
4. If both conditions hold, the requirement is satisfied.
