---
id: journal-motive-r-008
type: requirement
concept: C-JOURNAL-MOTIVE
criticality: must
verification: manual
status: open
title: "Archive gating with event-based resolution"
---

## JOURNAL-MOTIVE-R-008 — Archive gating with event-based resolution {#journal-motive-r-008}

**When** `journal motive archive <slug>` is invoked without `--force`, it **shall** refuse (exit 1) if the motive contains any open TBD/TBR items that have no event-based resolution. An open item **shall** be considered resolved when an accepted DECISION event with `data.resolves` set to that item's id exists in the motive's journal, or when the charter's `open_items` entry carries a `resolved_by` field. **When** `--force` is passed, the open-items check **shall** be skipped entirely and archiving **shall** proceed.

**Note — known divergence:** The archive gate reads the charter's `open_items` array and applies the event-resolution overlay at archive time; it does not re-scan from the compiled view. If the charter's `open_items` list is stale (e.g., new items were added to the charter prose but the structured `open_items` array was not updated), those items may not appear in the gate check. Additionally, `journal compile --tbd` reports open-item count as warn-only and never affects the archive gate. The `--force` flag is the only reliable escape hatch when event-resolved items are not correctly reflected.

- **Why** — Archiving a motive with genuinely open decisions or unknowns produces an archive that is misleading to readers who inspect it later: the archived state appears complete but contains unresolved questions. The gate prevents accidental premature archival; `--force` is available when the operator knows the items are resolved despite stale charter metadata.
- **Fit criterion** — `journal motive archive <slug> --force` exits 0 regardless of open items. `journal motive archive <slug>` (without `--force`) exits 1 when at least one TBD/TBR item in the charter has no resolution event, and prints a message containing "open TBD/TBR items".
- **Verification**: manual — Using a throwaway project dir, create a motive with a charter containing an open TBD item (no DECISION event resolving it). Run `bun bin/journal motive archive test-slug`; confirm exit 1 and error message. Run with `--force`; confirm exit 0 and the motive directory moved to `.groundwork/archive/motives/`. Source: `hooks/journal.mjs` lines 458–533.
- **Criticality**: must
