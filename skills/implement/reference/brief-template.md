# Agent Brief Template

Every spawn uses this template. Fill every field; send in ONE message before delegating.

## One-line statement (before delegating)

> Delegating to `<agent>` because `<why>`. Success check: `<verifiable outcome>`.

## Brief fields

**Goal** — one sentence: what behavior must exist when done. No process description.

**Files owned** — explicit list. Implementer touches only these.

**Files NOT owned** — explicit list. Read-only or hands-off. If uncertain, list here and ask.

**Success criteria (ACs)** — verifiable done-conditions, ≥1 per behavior. Written before implementation.

**Constraints** — hard limits: no new deps, stay under X lines, no schema changes, etc.

**Receipt format** — what the agent must return: STATUS / files changed / test output / bite proof.

## Size limit

≤3 files and ~200 lines per task. Larger scope = split into multiple slices before delegating.

## Bite proof requirement

Receipt must include a bite proof: break the behavior → confirm red → restore → confirm green.
Arguing correctness without running is not a bite proof.
Fixtures must be copied from real data in the codebase, not invented.
"Pre-existing failure" claims need a HEAD comparison (baseline run before any change).
