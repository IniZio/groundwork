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

Each motive **shall** be stored under `.groundwork/motives/<slug>/` and **shall** contain: `motive.md` (the charter), `tickets/` (durable hand/agent-authored work objects), `evidence/` (milestone and verification artifacts), `journal/` (append-only event log), and `decisions/` (decision records). A motive directory **shall not** be created at any path outside `.groundwork/motives/`. Archived motives **shall** be moved to `.groundwork/archive/motives/<slug>/`.

- **Why** — Tools that read the filesystem directly (Obsidian, shell scripts, IDE file trees) depend on a stable directory contract. The `tickets/` directory is the only location where durable work objects survive across sessions.
- **Fit criterion** — `ls .groundwork/motives/<slug>/` for a live motive shows `motive.md`, `tickets/`, and any of `evidence/`, `journal/`, `decisions/` (created as needed). A file created in `tickets/` survives across sessions and any tooling invocation.
- **Verification**: manual — Inspect `.groundwork/motives/obsidian-native-groundwork/` to confirm the expected entries. Do NOT create files in the live motive for testing; use a throwaway project dir via `CLAUDE_PROJECT_DIR=/tmp/scratchpad`.
- **Criticality**: must
