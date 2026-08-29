# motive: obsidian-native-groundwork

## Objective

Replace groundwork's mixed JSON/JSONL/YAML/Markdown persistence with one uniform format — Markdown files with YAML frontmatter following Obsidian Properties conventions (typed properties, ISO dates, YAML lists, `[[wikilinks]]` in frontmatter for relations) — and rewrite the CLI as a single TypeScript+Bun binary `gw`, preserving current behavior exactly. Modeled on mudissue's principles: frontmatter-as-database / body-as-document, identity in the filesystem, surgical property writes, format-level (zero-coupling) Obsidian compatibility.

## Decisions

- D1: All state converts to Markdown+frontmatter, including the run ledger and journal. Slices/events become files; the write-seal survives as a sidecar hash file (not a frontmatter key) so human edits in Obsidian do not invalidate machine trust. Claude Code contract files (plugin.json, hooks.json, model-registry.json) stay JSON — not our data model.

- D2: The per-session "run" is collapsed: slices are sub-issues of their motive (files/folders under the motive dir, mudissue-style `<label>-<slug>` naming) carrying `session` and `wave` properties; the advisor gate becomes one note per session under the motive; the Stop-gate queries slices by `session` property plus the session's gate note verdict. Pacing counts distinct waves among this session's slices.

- D3: Own implementation — no runtime dependency on mudissue. Adopt verbatim: gray-matter round-trip frontmatter parsing, patch-only-the-target-line property writes (Obsidian edits and CLI edits never clobber each other), wikilink formatting with escaping, `--json` on every command, generic primitives (cat/locate/get-property/set-property/append) plus typed bidirectional link commands.

- D4: TypeScript compiled with Bun to a single `gw` binary; hooks become one-line shims invoking `gw hook <name>`; kills the .mjs/.d.mts split; one shared Zod schema for frontmatter across CLI and hooks. Plugin (hooks/skills/agents) remains the delivery and enforcement surface; a `gw mcp` server mode is a later, optional slice.

- D5: Migration is durable-artefacts-only via `gw migrate`: motive charters, tickets, journal decisions/TBDs. Ephemeral run state (per-session ledgers, seals, struggle tallies, open-items) is NOT migrated. New layout lives in a parallel directory until cutover so existing hooks keep working.

- D6: Behavior-preserving is the acceptance baseline: on identical inputs the new stop-gate/pacing/guards make identical decisions to today's. ALL workflow changes — link-driven auto-blocked status, promoter phase, configurable status lists — are deferred to post-migration follow-ups (record as TBRs).

- D7: Obsidian vault = `.groundwork/` (the tracker dir), with a mudissue-style configurable tracker path so it can live outside the repo. Spec cross-links via a `.groundwork/specs → ../doc/specs` symlink; fallback if symlink-following proves unreliable is CLI-emitted relative Markdown links.

- D8: Specs move to mudissue-style human-readable shape: concept metadata absorbed into the concept's index.md frontmatter; requirements as prose-first Markdown with machine-facing bits (id, criticality, verification, status) in frontmatter; spec.yaml, constraints.md, and doc/specs/_generated/ are deleted; coverage becomes `verifies: [[<req-id>]]` wikilinks on slices (backlinks pane = coverage report). Exact file granularity is TBD-1.

## Open items

- TBD-1: Spec file granularity — one requirement per file vs one concept per file with requirement sections. Resolve by prototype: rewrite 2–3 real concepts (ORCHESTRATION, ENFORCEMENT) in both shapes, review in Obsidian, pick. Spec migration is blocked on this.
    refs: D8

- TBD-2: Verify Obsidian follows the `specs` symlink on the user's setup (unofficial behavior); decide symlink vs relative-link fallback. Rides in the same prototype slice as TBD-1.
    refs: D7

- TBR-1: Post-migration workflow adjustments backlog — auto-blocked status from blocked_by links, promoter/communication phase after advisor APPROVE, configurable status lists.
    refs: D6

## Acceptance criteria

- AC-1: A single `gw` binary (TS+Bun) replaces bin/ledger and bin/journal; every command supports `--json`; hooks are shims calling `gw hook <name>`.
    note: verified by running `gw --help`, `gw hook <name> --json`, and diffing hook shim source against `gw hook` invocations.

- AC-2: All groundwork-owned persisted state is Markdown+YAML frontmatter conforming to Obsidian Properties conventions; no groundwork-owned JSON/JSONL state files are written on the new path (sidecar seal hash exempt).
    note: enforced by a file-extension audit of `.groundwork/` after a representative session; sidecar hash files (.seal) are the only non-Markdown artefacts.

- AC-3: Behavior parity: a test suite replays recorded gate/pacing/guard scenarios against old and new implementations and gets identical verdicts.
    note: enforced by a parity test that feeds the same input corpus to the legacy and new Stop-gate/pacing code paths and diffs the decision outputs.

- AC-4: `gw migrate` converts all existing motive charters, tickets, and journal decisions/TBDs losslessly (round-trip test on the real corpus of 14 motives); ephemeral state untouched.
    note: verified by `gw migrate --dry-run` reporting zero lossy conversions; spot-check 3 motives manually in Obsidian.

- AC-5: Opening `.groundwork/` as an Obsidian vault shows motives, slices, gates, decisions as linked notes with typed properties; slice→requirement links resolve.
    note: `verification: manual` — screenshot of Obsidian graph view and a linked note open; wikilinks resolve without 404.

- AC-6: Specs are readable as standalone prose documents; concept metadata lives in frontmatter only; _generated/ and spec.yaml no longer exist (after TBD-1 resolves).
    note: enforced by asserting `doc/specs/_generated/` and `doc/specs/spec.yaml` are absent and every concept has an index.md with required frontmatter keys.

## Tickets

See [MAP.md](MAP.md) for the live ticket index.

## Out of scope

- Any behavior change to gate/pacing/guard semantics (TBR-1 items included — deferred post-migration).
- Adopting mudissue as a runtime dependency.
- Migrating ephemeral run state (per-session ledgers, seals, struggle tallies, open-items).
- Renaming or restructuring doc/ beyond the spec shape changes described in D8.
- MCP server (`gw mcp`) — a later, optional slice at most, not required for done.
- Mobile sync tooling.
