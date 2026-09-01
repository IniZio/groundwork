---
id: journal-motive-r-002
type: requirement
concept: C-JOURNAL-MOTIVE
criticality: must
verification: manual
status: open
title: "Motive on-disk directory structure"
---

## JOURNAL-MOTIVE-R-002 — Motive on-disk directory structure {#journal-motive-r-002}

Each motive **shall** be stored under `.groundwork/motives/<slug>/` and **shall** contain: `motive.md` (the charter), `MAP.md` (the ambient human view, auto-regenerated), `tickets/` (durable hand/agent-authored work objects), and `open-items/` (generated drill-down views, swept on regeneration). A motive directory **shall not** be created at any path outside `.groundwork/motives/`. Archived motives **shall** be moved to `.groundwork/archive/motives/<slug>/`.

- **Why** — Tools that read the filesystem directly (Obsidian, shell scripts, IDE file trees) depend on a stable directory contract. A caller storing durable work objects in `open-items/` loses them silently on the next MAP regeneration, because that directory is swept. The `tickets/` directory is the only location where durable work objects survive across regeneration cycles and sessions.
- **Fit criterion** — `ls .groundwork/motives/<slug>/` for a live motive shows `motive.md`, `MAP.md`, `tickets/`, and `open-items/` (or a subset when no items are present). A file created in `open-items/` by hand is absent after the next `journal append` that triggers MAP regeneration. A file created in `tickets/` is still present after the same regeneration.
- **Verification**: manual — Inspect `.groundwork/motives/obsidian-native-groundwork/` to confirm the expected entries. Do NOT create files in the live motive for testing; use a throwaway project dir via `CLAUDE_PROJECT_DIR=/tmp/scratchpad`.
- **Criticality**: must
