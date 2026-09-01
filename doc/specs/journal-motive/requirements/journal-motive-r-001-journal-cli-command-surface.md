---
id: journal-motive-r-001
type: requirement
concept: C-JOURNAL-MOTIVE
criticality: must
verification: manual
status: open
title: "Journal CLI command surface"
---

## JOURNAL-MOTIVE-R-001 — Journal CLI command surface {#journal-motive-r-001}

The journal CLI **shall** expose exactly the following top-level commands: `append`, `show`, `digest`, `compile`, `motive`, `baseline`, `migrate-tickets`, `ac-retract`, and `graph`. The `motive` subcommand **shall** accept only `new` and `archive`; it **shall not** accept `list` or any other subcommand. Commands `journal motive list` and `journal event add` **shall not** exist.

- **Why** — Agent instructions elsewhere in the codebase wrongly reference `journal motive list` and `journal event add`. A caller invoking a phantom command receives exit 2 ("unknown command") with no event written and no diagnostic beyond the error message; if the caller does not check exit codes, the event is silently lost. Specifying the exact surface here creates a single authoritative reference that can be diffed against the implementation.
- **Fit criterion** — `bun bin/journal help` (or `bun bin/journal --help`) lists the nine commands above and no others. `bun bin/journal motive list` exits 2 and prints a message containing "unknown motive subcommand". `bun bin/journal event` exits 2 and prints "unknown command".
- **Verification**: manual — Run `bun bin/journal --help` from the repo root; confirm the command list. Run `bun bin/journal motive list`; confirm exit 2 and the error text. Source: `hooks/journal.mjs` lines 964–974 (the dispatch switch).
- **Criticality**: must
