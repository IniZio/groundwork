# Groundwork file-layout contract

> **Machine-readable contract:** `layout.ts` in this directory. All path functions are pure — no disk access. Always call them; never hard-code paths.

## Tracker directory

Default: `.groundwork/` relative to the repo root.
Override via `tracker_path` config (may be absolute or relative).
Function: `resolveTracker(repoRoot, configured?)`

## Motive-level layout

```
<tracker>/motives/<slug>/
  motive.md                   # charter (MotiveSchema frontmatter)
  <label>-<slug>.md           # slice notes (SliceSchema frontmatter)
  gate-<sessionId>.md         # advisor gate note per session (GateSchema frontmatter)
  tickets/
    <filename>.md             # ticket files (TicketSchema frontmatter)
  decisions/
    <decision-id>.md          # MADR decision files (DecisionSchema frontmatter)
```

**Slice filenames** follow the mudissue `<label>-<slug>` convention.
- `label` = slice id (e.g. `S1-SCHEMA`)
- `slug` = optional human slug (e.g. `schema-module`)
- Function: `sliceNotePath(repoRoot, tracker, motive, label, slug?)`

**Gate notes** are one per session:
- Function: `gateNotePath(repoRoot, tracker, motive, sessionId)`

## Spec concept layout

```
doc/specs/<concept-slug>/
  index.md                    # concept index (ConceptIndexSchema frontmatter)
  requirements/
    <req-id>.md               # requirements (RequirementSchema frontmatter, D-13 template)
  design/
    _MOC.md                   # curated reading map (type: moc)
    concepts/                 # Diataxis explanation notes (type: concept)
    flows/                    # decision paths / state machines (type: flow)
    components/               # Carbon-style anatomy pages (type: component)
      assets/                 # embedded images via ![[…]]
    recipes/                  # Diataxis how-to guides (type: recipe)
    reference/                # reference tables (type: reference)
  decisions/
    <decision-id>.md          # MADR decision files (DecisionSchema frontmatter)
  glossary.md                 # term definitions (type: glossary)
```

## Obsidian vault

The tracker directory IS the Obsidian vault (D7).
Spec cross-links use a symlink: `.groundwork/specs → ../doc/specs` (TBD-2, confirmed working in round-1 review).

## Design note kinds (D-15)

| Kind | Location | Description |
|------|----------|-------------|
| `moc` | `design/_MOC.md` | Curated reading map with section links |
| `concept` | `design/concepts/` | Diataxis explanation — one mermaid + related requirements |
| `flow` | `design/flows/` | Decision path or state machine — diagram + step/actor/source table |
| `component` | `design/components/` | Carbon-style anatomy, variants, states, specs, usage, related |
| `recipe` | `design/recipes/` | Diataxis how-to with exact CLI commands |
| `reference` | `design/reference/` | Reference tables |
| `glossary` | `glossary.md` | Term definitions per concept |

## Transition root (D5)

During migration, new notes land under `.groundwork/next/` — the **parallel tracker root** for the new Obsidian-native layout while existing hooks continue writing to `.groundwork/`.

```
.groundwork/next/motives/<slug>/
  index.md                      # charter (MotiveSchema frontmatter) — replaces motive.md
  tickets/
    <filename>.md               # ticket files (TicketSchema frontmatter)
  decisions/
    <decision-id>.md            # MADR decision files (DecisionSchema frontmatter)
  open-items/
    <TBD-n>.md | <TBR-n>.md    # open-item notes (OpenItemFm — plain interface, no Zod schema)
```

Configurable via `tracker_path` per D7; default transition value is `.groundwork/next`.
The existing `.groundwork/` tree is **read-only** during transition.
`gw migrate` writes here; cutover swaps the `tracker_path` config to the final value.

Path functions: `charterPath`, `decisionNotePath`, `openItemPath` live in `src/gw/store/motive/` (store layer, not layout.ts) because `open-items/` has no layout.ts entry and `index.md` differs from the legacy `motive.md` name.

## Journal events & session state

**No groundwork-owned JSON/JSONL state may be written under the new path.** All state is Markdown-first.

### Journal events

Journal events are one Markdown note per event:

```
.groundwork/next/motives/<slug>/journal/<ISO-ts>-<TYPE>.md
```

Frontmatter = `JournalEventSchema` fields (`ts`, `session`, `type`, `source`, `data` as nested YAML — passthrough). Body = the `--msg` text.

`--type DECISION` MUST go through the S2-MOTIVE decision store (`writeDecision`) so decisions remain MADR notes under `decisions/`. `journal show` and `journal compile` read both the `journal/` event notes and the `decisions/` MADR notes for a complete view.

### Session state (await-human, autopilot)

`await-human` hold and `autopilot` grants are session state. They live as properties on the session's gate note (`gate-<sessionId>.md`) written via `writeGate`:

- `awaiting_human: { reason: string; set_at: string } | null` — present when hold is active, absent or null when cleared.
- `autopilot: Array<{ units: number; reason: string; ts: string }>` — append-only log of grants.

Gate notes are sealed (token-gated); setting these fields without the correct token changes the canonical machine state and invalidates the seal (fail-closed).
