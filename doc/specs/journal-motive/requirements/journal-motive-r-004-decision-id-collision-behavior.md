---
id: journal-motive-r-004
type: requirement
concept: C-JOURNAL-MOTIVE
criticality: should
verification: manual
status: open
title: "DECISION id-collision behavior"
---

## JOURNAL-MOTIVE-R-004 — DECISION id-collision behavior {#journal-motive-r-004}

**When** a DECISION event is appended whose `data.id` matches an existing DECISION event in the same motive, the journal **shall** emit a WARNING to stderr and **shall** write the event anyway; it **shall not** exit non-zero solely due to the id collision. **When** `data.revises` is set to the colliding id, the warning **shall** be suppressed and the event **shall** be written without any warning output.

**Note — current divergence from intended behavior:** The intended invariant is to reject a colliding id (exit 1) so that duplicate ids are impossible without explicit supersession. The current implementation warns and writes (observed: ids D-11–D-16 collided with existing ids in a live session and required subsequent supersession events). Callers **shall** treat the warning as a prompt to add `data.revises`; they **shall not** rely on the CLI to enforce id uniqueness automatically.

- **Why** — Silent duplicate DECISION ids produce two events with the same id in the same motive. The fold (`motive-compile.mjs`) applies a merge strategy (latest wins) but the raw log carries both events, and downstream consumers that do not apply the same merge see conflicting entries. The warn-and-write behavior places the uniqueness burden entirely on the caller; a caller that ignores stderr will never notice the collision.
- **Fit criterion** — Appending a DECISION with a pre-existing id exits 0; stderr contains "WARNING" and the colliding id. Appending the same id with `data.revises` set to that id exits 0 with no WARNING in stderr.
- **Verification**: manual — Using a throwaway project dir (`CLAUDE_PROJECT_DIR=/tmp/scratch bun bin/journal motive new scratch-test`), append one DECISION, then append a second with the same `data.id`. Observe exit code 0 and WARNING on stderr. Repeat with `data.revises` set; confirm no WARNING. Source: `hooks/journal.mjs` lines 628–637.
- **Criticality**: should
