---
id: journal-motive-r-006
type: requirement
concept: C-JOURNAL-MOTIVE
criticality: must
verification: manual
status: open
title: "Ticket durability and migrate-tickets"
---

## JOURNAL-MOTIVE-R-006 — Ticket durability and migrate-tickets {#journal-motive-r-006}

Files under `.groundwork/motives/<slug>/tickets/` **shall** never be deleted or overwritten by any regeneration command; tooling **shall** create a ticket file only when a file at that path does not already exist. Files under `.groundwork/motives/<slug>/open-items/` **shall** be swept (regenerated from scratch) each time MAP regeneration runs and **shall not** be used to store durable work objects.

The `journal migrate-tickets <slug>` command **shall** scan `tickets/*.md` and delete only files whose last non-empty line matches the autogen footer; it **shall not** touch hand-authored files. It **shall** exit 0 even when no files are deleted.

- **Why** — Cross-session continuity depends on `tickets/` surviving MAP regeneration. An agent that stores a work object in `open-items/` loses it on the next append that triggers map regen — silently, with no warning. The `migrate-tickets` command exists to clean up a historical period when tickets were auto-generated per ledger slice and carried an autogen footer; post-migration, all tickets in `tickets/` are hand/agent-authored and must survive indefinitely.
- **Fit criterion** — After any `journal append` or `journal motive new` that triggers MAP regeneration, every pre-existing file in `tickets/` is still present with identical content. A file created in `open-items/` by hand is absent after the next regeneration. Running `journal migrate-tickets <slug>` on a motive with no autogen-footer tickets exits 0 and prints "nothing to delete".
- **Verification**: manual — Inspect `.groundwork/motives/obsidian-native-groundwork/tickets/` before and after a read-only `bun bin/journal show` to confirm tickets are untouched. For the `open-items/` sweep, use a throwaway project dir. Source: `hooks/journal.mjs` lines 190–198, `hooks/lib/motive-tickets.mjs`.
- **Criticality**: must
