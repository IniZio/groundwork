---
id: s0-inventory
ticket_type: analysis
motive: obsidian-native-groundwork
status: complete
---

# S0 — Migration Artefact Inventory

Authoritative inventory of every artefact groundwork persists at HEAD, derived from source (hooks/lib/*.mjs, hooks/*.mjs, bin/ledger, bin/journal, src/) — NOT the prior session-level survey. Feeds S1-SCHEMA (schema contract) and S2-MIGRATE (`gw migrate` implementation).

---

## 1. Artefact Table

All paths relative to `<projectDir>/` unless noted. "Producer" and "Consumer" cite the file that contains the path literal or the I/O function; line references are approximate from HEAD.

| Artefact | Format | Path Pattern | Producer (file:approx-line) | Consumers (file:approx-line) | Durable / Ephemeral | Migrate? (per D5) | Target Shape Note |
|---|---|---|---|---|---|---|---|
| **Run ledger (per-session)** | JSON | `.groundwork/runs/<session-id>.json` | `ledger-io.mjs:157` (writeLedger), `bin/ledger` CLI | `ledger-io.mjs:163`, `stop-gate.mjs`, `traceability-adapter.mjs:220`, `motive-map.mjs:129` | Ephemeral | NO | Collapses: slices become per-motive notes with `session`/`wave` frontmatter (D2) |
| **Run ledger (legacy)** | JSON | `.groundwork/run.json` | `ledger-io.mjs:151` | `ledger-io.mjs:141`, `journal-io.mjs:153`, `motive-map.mjs:141`, `traceability-adapter.mjs:241` | Ephemeral | NO | Legacy fallback only; superseded by per-session path |
| **Seal key** | Binary (HMAC key) | `.groundwork/runs/<session-id>.seal.key` | `gate-seal.mjs:187` | `gate-seal.mjs` (sign/verify), `stop-gate.mjs` | Ephemeral | NO | Survives as sidecar hash file per D1; not migrated |
| **Legacy seal key** | Binary | `.groundwork/runs/legacy.seal.key` | `gate-seal.mjs:190` | `gate-seal.mjs` | Ephemeral | NO | Legacy fallback only |
| **Journal shards** | JSONL | `.groundwork/journal/<date>-<session-id>.jsonl` | `journal-io.mjs:254` (appendEvent), `bin/journal` CLI | `journal-io.mjs:296` (readAllEvents), `motive-compile.mjs`, `motive-map.mjs:257`, `traceability-adapter.mjs:250` | Durable (DECISION, MILESTONE, AC_COVERAGE, MOTIVE_CREATED events) | YES (DECISION, TBD-bearing events only per D5) | Each migrated event becomes a Markdown note in the motive; ephemeral event types (LINT_DRIFT, SESSION_START, TASK_COMPLETE) NOT migrated |
| **Motive charter** | Markdown | `.groundwork/motives/<slug>/motive.md` | `journal.mjs:478` (new cmd), `motive-charter.mjs:50` | `motive-compile.mjs`, `motive-map.mjs:49`, `traceability-adapter.mjs:276`, `journal.mjs:512` (archive), `session-reminder.mjs` | Durable | YES | Already Markdown; round-trip must preserve all frontmatter and body sections |
| **Tickets** | Markdown | `.groundwork/motives/<slug>/tickets/*.md` | `motive-ticket.mjs` (hook), `journal.mjs` (migrate-tickets cmd) | `motive-map.mjs:219`, `motive-ticket-doc.mjs` | Durable | YES | Already Markdown; migrated to new vault path preserving filenames |
| **MAP.md** | Markdown | `.groundwork/motives/<slug>/MAP.md` | `motive-map.mjs:113` (regenerateMap) | Human / Obsidian viewer | Ephemeral (regenerated) | NO | Regenerated post-migration from migrated durable data |
| **Open items** | Markdown | `.groundwork/motives/<slug>/open-items/*.md` | `motive-map.mjs` (drill-down) | Human | Ephemeral (swept on regen) | NO | Swept on MAP regeneration; do not migrate |
| **TRACE.html** | HTML | `.groundwork/motives/<slug>/TRACE.html` | `motive-html.mjs` | Human / browser | Ephemeral (generated) | NO | Regenerated from compiled view |
| **Graph seal key** | Binary | `.groundwork/motives/<slug>/graph.seal.key` | `graph-seal.mjs:163` | `graph-seal.mjs`, `motive-graph.mjs` | Ephemeral | NO | Invalidated on migration; new seals computed after cutover |
| **Compiled motive** | JSON + Markdown | `.groundwork/compiled/<slug>.json` + `.groundwork/compiled/<slug>.md` | `journal.mjs:340` (compile cmd), `motive-compile.mjs` | `motive-render.mjs`, `motive-html.mjs`, `session-reminder.mjs` | Ephemeral (regenerated from journal+charter) | NO | Regenerated post-migration |
| **Advisor gate records** | Markdown | `.groundwork/gates/<id>.md` | `stop-gate.mjs`, `bin/ledger` (gate cmd) | `stop-gate.mjs` (verdict read) | Ephemeral | NO | Advisory verdicts are session-scoped; not migrated |
| **Struggle signals** | JSONL | `.groundwork/struggle-signals.jsonl` | `signals-io.mjs:25` | `struggle-nudge.mjs` | Ephemeral | NO | Session telemetry only |
| **Handoffs** | Markdown | `.groundwork/handoffs/*.md` | `journal.mjs` (handoff cmd) / manual | Human / `session-reminder.mjs` | Durable (session continuity notes) | **Needs schema decision** | Not explicitly listed in D5's durable set; likely should be migrated as motive-less notes |
| **Research docs** | Markdown | `.groundwork/research/*.md` | Manual / `groundwork:researcher` agent | Human / orchestrator | Durable | **Needs schema decision** | Not in D5 scope; migrate as-is or leave in place |
| **Pilots** | Mixed | `.groundwork/pilots/` | Manual / `groundwork:qa` | Human | Durable (reference docs) | **Needs schema decision** | Not in D5 scope |
| **Archive (motives)** | Directory | `.groundwork/archive/motives/<slug>/` | `journal.mjs:512` (archive cmd) | None active | Durable (archived charters) | YES (charters within) | Archive also contains motive charters — same lossless round-trip requirement |
| **Learnings** | Markdown | `.groundwork/learnings/<slug>.md` | `learnings-io.mjs:21` | `session-reminder.mjs` (inferred) | Durable | **Needs schema decision** | Path defined in learnings-io.mjs but directory does NOT exist at HEAD |
| **Out-of-scope (rejection KB)** | Markdown | `.groundwork/out-of-scope/*.md` | `journal.mjs` / manual | `motive-map.mjs:452` | Durable | **Needs schema decision** | Directory does NOT exist at HEAD |
| **doc/specs (source)** | Markdown + YAML | `doc/specs/<concept>/{README.md,constraints.md,requirements.md,spec.yaml}` | `spec.mjs`, `hooks/doc.mjs` | `spec-io.mjs`, `spec-guard.mjs`, `spec-lint.mjs`, `traceability-adapter.mjs:112` | Durable (committed to git) | NO | Already committed Markdown; not a .groundwork artefact |
| **doc/specs/_generated** | JSON + Markdown | `doc/specs/_generated/{index.json,coverage.json,index.md}` | `spec.mjs` (build cmd) | `spec-io.mjs` (index.json), `spec-lint.mjs` (index.json), `traceability-adapter.mjs:203` (coverage.json), `spec-guard.mjs` (exempts dir) | Ephemeral (generated) | NO | Generated; regenerated post-migration |
| **JSON Schemas** | JSON | `schemas/*.schema.json` | Hand-authored | `schema-io.mjs` (compile/validate) | Durable (committed to git) | NO | Committed source; not a .groundwork runtime artefact |
| **pacing state** | Embedded in run ledger `pacing` field | (see run ledger) | `pacing.mjs`, `ledger-io.mjs` | `pacing.mjs`, `stop-gate.mjs` | Ephemeral | NO | Session-scoped; recomputed from slice wave counts post-migration |

---

## 2. Durable Corpus — Enumerated Concretely

**Active motive count at HEAD: 15** (charter AC-4 says 14 — see §5 Discrepancies).

**Archived motives (in `.groundwork/archive/motives/`):** 3 — `plugin-cleanup`, `live-surface-cutover`, `tracking-viz`. These contain durable charters and should be included in the `gw migrate` corpus.

**Total `gw migrate` corpus: 18 motives** (15 active + 3 archived).

### Per-motive durable corpus counts

(Ticket count = files in `tickets/`; DECISION events = journal event type `DECISION` attributed to that motive slug)

| Motive slug | Tickets | DECISION events | Total journal events | Notes |
|---|---|---|---|---|
| codify-motive-dag | 6 | 12 | 19 | Active |
| depth2-experiment | 0 | 4 | 18 | Active |
| drop-pi-model-registry | 0 | 0 | 5 | Active |
| graph-authoring | 0 | 5 | 57 | Active |
| graph-pilot | 2 | 7 | 37 | Active |
| groundwork-development | 6 | 126 | 458 | Active; largest corpus |
| groundwork-hardening | 2 | 4 | 50 | Active |
| handbook-kb-plugin | 0 | 4 | 6 | Active |
| junior-orchestrator-parity | 0 | 9 | 53 | Active |
| motive-dag-cutover | 0 | 4 | 22 | Active |
| obsidian-native-groundwork | 13 | 11 | 12 | Active; this motive |
| parallel-width-hardening | 0 | 10 | 49 | Active |
| sealed-gate | 5 | 10 | 12 | Active |
| spine-beads-hitl-portability | 0 | 29 | 106 | Active |
| token-economy | 10 | 12 | 41 | Active |
| **live-surface-cutover** | (archived) | 12 | 43 | In archive/ |
| **plugin-cleanup** | (archived) | 9 | 45 | In archive/ |
| **tracking-viz** | (archived) | 11 | 52 | In archive/ |
| **TOTALS (active only)** | **44** | **247** | **1,004** | |
| **TOTALS (all 18)** | **44+** | **279** | **1,144** | Archived ticket counts not yet enumerated |

### TBD-bearing events

The journal has no dedicated `TBD` event type. TBDs appear in two forms:
1. Inline in `motive.md` charter text as `TBD:` / `TBR:` markers (consumed by `motive-map.mjs` open-items drill-down)
2. Materialised as `open-items/tbd-*.md` and `open-items/tbr-*.md` (ephemeral, swept on regen)

The `gw migrate` round-trip test for AC-4 must verify that TBD markers in `motive.md` are preserved verbatim — they are NOT separate journal events.

### AC-4 expected corpus for round-trip verification

- 15 active motive charters + 3 archived charters = **18 charter files**
- **44 ticket files** across active motives (archived ticket counts TBD — enumeration needed)
- **279 DECISION events** across all 18 motives (journal attribution)
- TBD markers: inline in charter text — count by scanning motive.md files (not pre-counted here; run `grep -c 'TBD:' .groundwork/motives/*/motive.md` at migration time)

---

## 3. Lossy-Set Analysis

Fields and structures in current JSON/JSONL that have no obvious frontmatter home and require schema decisions in S1-SCHEMA.

### Run ledger (`<session-id>.json`) — D2 collapses this; fields listed for completeness

| Field | Current shape | Proposed representation | Decision needed? |
|---|---|---|---|
| `active` | boolean | Not migrated (ephemeral) | No |
| `brief` | string | Not migrated (ephemeral) | No |
| `slices[]` | array of objects | Becomes per-motive slice notes (D2) | S1-SCHEMA owns |
| `slices[].id` | string (e.g. `S1`) | Frontmatter `id:` | No |
| `slices[].wave` | integer | Frontmatter `wave:` | No |
| `slices[].status` | string enum | Frontmatter `status:` | No |
| `slices[].desc` | string | Frontmatter or H1 title | No |
| `slices[].blocked_by` | string array | Frontmatter list `blocked_by: [...]` | No |
| `slices[].acceptance` | string (semicolon-delimited) | Frontmatter list or body section | **Needs schema decision** — array vs. inline prose |
| `slices[].kind` | string enum (`impl`,`plan`,`diagnose`,`design`,`fog`) | Frontmatter `kind:` | No |
| `slices[].ticket` | string (ticket filename) | Frontmatter `ticket:` (wikilink) | No |
| `slices[].covers_ac` | comma-delimited string | Frontmatter list `covers_ac: [...]` | No |
| `slices[].decisions` | comma-delimited string | Frontmatter list `decisions: [...]` | No |
| `slices[].claimed_by` | string (session lock) | Not migrated (ephemeral) | No |
| `slices[].claimed_at` | ISO timestamp | Not migrated (ephemeral) | No |
| `gate.seal` | SHA256 hex string | Sidecar `.seal` file per D1 | No — D1 explicit |
| `write_token` | string (auth token) | Not migrated (ephemeral) | No |
| `schema_version` | string | Frontmatter `schema_version:` | No |
| `session_id` | string (UUID) | Not migrated (part of filename) | No |
| `motive` | string slug | Not migrated (derived from vault dir) | No |
| `pacing.policy` | string | Not migrated (recomputed) | No |
| `pacing.budget` | integer | Not migrated (recomputed) | No |
| `pacing.exempt_kinds` | string array | Not migrated (recomputed) | No |
| `pacing.offset` | integer | Not migrated (recomputed) | No |

### Journal shards (`.jsonl`) — per-event field analysis

| Field | Present on | Current shape | Proposed representation | Decision needed? |
|---|---|---|---|---|
| `ts` | all events | ISO timestamp | Frontmatter `ts:` | No |
| `session` | all events | UUID string | Frontmatter `session:` | No |
| `rfc` | all events | string identifier | Frontmatter `rfc:` | **Needs schema decision** — rfc appears on every event but meaning unclear; may overlap with `data.rfc` on DECISION |
| `type` | all events | string enum | Frontmatter `type:` | No |
| `msg` | all events | string | H1 title or frontmatter `msg:` | No |
| `motive` | most events | string slug | Frontmatter `motive:` | No |
| `source` | some events | string | Frontmatter `source:` | No |
| `data` (DECISION) | DECISION events | `{rfc, wave, tasks, ruled_by, date, rationale, consequence, known_debt}` | Structured body sections | **Needs schema decision** — `tasks` may be an array; `known_debt` is free prose |
| `data.tasks` | DECISION | unknown (array?) | Body list or frontmatter list | **Needs schema decision** |
| `data` (TASK_COMPLETE) | TASK_COMPLETE | `{slice, motive_provenance}` | Not migrated (ephemeral) | No |
| `data` (GATE) | GATE | `{which, verdict, citation, rubric, motive_provenance}` | Not migrated (advisory verdict) | No |
| `data` (FAILURE) | FAILURE events | unknown structure | **Needs schema decision** | Yes |
| `data` (BASELINE) | BASELINE events | unknown structure | **Needs schema decision** | Yes |
| `data` (VERIFICATION) | VERIFICATION events | unknown structure | **Needs schema decision** | Yes |
| `data` (AC_RETRACTION) | AC_RETRACTION events | unknown structure | **Needs schema decision** | Yes |
| `data` (LINT_DRIFT) | LINT_DRIFT (499 events) | unknown — likely tooling noise | Not migrated (ephemeral telemetry) | **Needs explicit classification** — 499 events, confirm none are durable |

### Other

| Item | Issue | Decision needed? |
|---|---|---|
| Seal key files (`.seal.key`) | Binary; survive as sidecar per D1, not migrated | No — D1 explicit |
| `out-of-scope/*.md` | Dir does NOT exist at HEAD; referenced in `motive-map.mjs:452` | Define if and where to create in new vault |
| `learnings/<slug>.md` | Dir does NOT exist at HEAD; defined in `learnings-io.mjs` | Define vault path for when it is created |
| Ghost "session:" motive slugs in journal | 7 journal shards attributed to `session:<uuid>` slugs (no motive field) — total ~144 events | Classify: are these attributable to a motive? None contain DECISION events; treat as ephemeral |

---

## 4. Consumer-Rewiring Map

Every module that reads a to-be-migrated artefact. S3-HOOKS and S6-CUTOVER own the shim work.

### Motive charters (`motive.md`)

| Consumer | File:function | What it reads | Rewiring required |
|---|---|---|---|
| Journal compile | `bin/journal` → `motive-compile.mjs` | Full charter text (objective, decisions) | Point to new vault path |
| MAP regeneration | `motive-map.mjs:49` | `motive.md` for metadata | Point to new vault path |
| Traceability adapter | `traceability-adapter.mjs:276` | Objective field | Point to new vault path |
| Session reminder | `session-reminder.mjs` | Compiled view (via compile) | Indirect — compile step rewired |
| Journal `new` cmd | `journal.mjs:478` | Creates charter | Point to new vault path |
| Journal `archive` cmd | `journal.mjs:512` | Moves charter dir | Update source path |

### Tickets (`tickets/*.md`)

| Consumer | File:function | What it reads | Rewiring required |
|---|---|---|---|
| MAP regeneration | `motive-map.mjs:219` (listTickets) | All ticket files | Point to new vault path |
| Ticket doc builder | `motive-ticket-doc.mjs` | Individual ticket content | Point to new vault path |
| Ticket hook | `hooks/motive-ticket.mjs` | Creates/reads tickets | Update write path |
| Migrate-tickets cmd | `journal.mjs` (migrate-tickets) | Scans `tickets/*.md` | Update scan path |

### Journal shards (`.groundwork/journal/*.jsonl`)

| Consumer | File:function | What it reads | Rewiring required |
|---|---|---|---|
| Journal I/O reader | `journal-io.mjs:296` (readAllEvents) | All shards | Shard format becomes per-event .md files; reader must switch |
| Motive compile | `motive-compile.mjs` (via journal-io) | Events filtered by motive | Same |
| MAP regeneration | `motive-map.mjs:257,323` | DECISION, MILESTONE events | Same |
| Traceability adapter | `traceability-adapter.mjs:250` | Journal events for coverage | Same |
| Stop-gate | `stop-gate.mjs` (via journal-io) | GATE events for verdict | Same |

### Run ledger (`runs/<session>.json`) — ephemeral, not migrated; listed for S3-HOOKS blast radius

| Consumer | File:function | Rewiring for new layout |
|---|---|---|
| Stop-gate | `stop-gate.mjs` | Must read slice notes per D2 |
| Motive map | `motive-map.mjs:128` | Must read slice notes per D2 |
| Traceability adapter | `traceability-adapter.mjs:220` | Must read slice notes per D2 |
| Pacing | `pacing.mjs` | Must derive wave count from slice notes |
| Ledger guard | `hooks/ledger-guard.mjs` | Must locate session slice notes |
| Ledger bash guard | `hooks/ledger-bash-guard.mjs` | Same |

### doc/specs/_generated (not migrated; consumer list for S3-HOOKS reference)

**Verified six-module claim from brief:** the brief names 6 consumers. Actual count is **5**:

| Module | Role | References `_generated`? | Verified |
|---|---|---|---|
| `spec-io.mjs` | Writes `_generated/index.json`; provides generated dir path | YES — `join(sd, '_generated', 'index.json')` (spec-io.mjs) | Confirmed |
| `spec.mjs` | Builds `_generated/{index.md,index.json,coverage.json}` | YES — "build doc/specs/_generated/..." (spec.mjs) | Confirmed |
| `spec-lint.mjs` | Reads `_generated/index.json` | YES — `join(projectDir, 'doc', 'specs', '_generated', 'index.json')` (spec-lint.mjs) | Confirmed |
| `spec-guard.mjs` | Exempts `_generated/` from write guards | YES — `const GENERATED_EXEMPT = 'doc/specs/_generated/'` (spec-guard.mjs) | Confirmed |
| `traceability-adapter.mjs` | Reads `_generated/coverage.json` | YES — `path.join(...'_generated', 'coverage.json')` (traceability-adapter.mjs:203) | Confirmed |
| `journal.mjs` | Brief claims this as a consumer | **NO** — no `_generated` reference found in journal.mjs at HEAD | **Discrepancy** — brief's sixth module is wrong |

**Corrected count: 5 modules touch `doc/specs/_generated/`**, not 6. `journal.mjs` does not reference `_generated` directly.

---

## 5. Discrepancies

| # | Item | Charter / Brief says | Actual at HEAD | Impact |
|---|---|---|---|---|
| D-1 | Motive count for AC-4 | "14 motives" | **15 active motives** + 3 archived = 18 total | AC-4's round-trip test must use corpus of 18 (or 15 if archived are excluded — needs explicit decision) |
| D-2 | `gw migrate` scope (D5) | "motive charters, tickets, journal decisions/TBDs" | `handoffs/`, `research/`, `pilots/`, `learnings/` (when created) and archived motives are not addressed | S1-SCHEMA needs to classify these explicitly; recommend including archived motive charters |
| D-3 | `journal.mjs` as `_generated` consumer | Brief says 6 modules | Only 5 confirmed; `journal.mjs` has no `_generated` reference | Corrected in §4 above; S3-HOOKS blast-radius estimate unchanged |
| D-4 | `out-of-scope/` and `learnings/` dirs | Referenced in `motive-map.mjs:452` and `learnings-io.mjs` respectively | Neither directory exists at HEAD | Migration tool must handle absent directories gracefully (no error on missing optional dirs) |
| D-5 | LINT_DRIFT events (499) | No mention in charter | Largest event type by count; source is `hooks/spec-lint.mjs` | Not durable; must be explicitly excluded from migration corpus in S1-SCHEMA spec |
| D-6 | Ghost session-keyed journal "motives" | Not addressed | 7 journal shards use `motive: session:<uuid>` instead of a slug | These 144 events contain no DECISION events; classify as ephemeral and skip in `gw migrate` |
| D-7 | `migrate.mjs` in hooks/ | Not referenced in charter | `hooks/migrate.mjs` is a DIFFERENT old tool converting `features/<slug>/` dirs to motives; entirely separate from the planned `gw migrate` command | No conflict; charter's `gw migrate` is a new command; `hooks/migrate.mjs` is legacy plumbing |
| D-8 | Runs directory contains `.seal.key` files only at HEAD | Prior survey noted binary seal files | Runs dir contains both `.json` run ledgers (6 files) AND `.seal.key` sidecars | Both are ephemeral and not migrated |
