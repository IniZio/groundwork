# Skill Audit Table

Template for per-skill audit files written to `.groundwork/motives/<slug>/audits/<skill>.md` during a rewrite. When rewriting a skill, build this table at that path. Every removed or moved sentence gets a row. A table with fewer rows than sentences removed or moved is incomplete.

## Columns

| Original sentence | Classification | Destination or reason |
|---|---|---|

## Classifications

- **no-op** — model already obeys this by default; removing it changes nothing (model-relative test, not reader-relative)
- **moved-to-pointer** — content moved to a `reference/` sibling file; skill body now carries an explicit pointer to it
- **already-hook-enforced** — a registered hook or guard mechanically enforces this; prose adds no protection
- **dropped-with-reason** — removed for a stated reason other than the above (stale, wrong, duplicated elsewhere)

## Worked rows (one per classification)

| Original sentence | Classification | Destination or reason |
|---|---|---|
| "Always read the file before editing." | no-op | Model reads files before editing by default; removing this changes behaviour for no model. |
| "Ledger CLI commands: `gw ledger init`, `gw ledger complete`…" | moved-to-pointer | Moved to `reference/ledger-commands.md`; body now reads "see `bin/ledger help`". |
| "Do not spawn a junior-orchestrator from a general-purpose agent." | already-hook-enforced | `src/gw/hook/nesting-guard.ts` mechanically blocks this spawn; prose adds no protection. |
| "Commit after each wave to avoid accumulation." | dropped-with-reason | Covered by memory entry `uncommitted-wave-accumulation`; duplicating here would drift. |
