---
id: s0-design-patterns
ticket_type: research
motive: obsidian-native-groundwork
status: complete
date: 2026-08-29
---

# S0-DESIGN-PATTERNS — Design-Half Information Architecture Survey

**Scope.** Recognized patterns for presenting the design half of a specification as a readable folder of notes. Does NOT repeat prior research in `s0-design-research.md` (arc42/C4/MADR/Kiro at section level). Focuses on: design-system component docs, Diátaxis, Zettelkasten/MOC, Storybook, API doc exemplars, cookbook/recipe conventions, GDD tradition, Figma/Pencil visual handoff.

---

## 1 — Pattern Inventory

| Source | Note/page types | Canonical section order per type | Readability devices | Applicability to workflow concepts (e.g. "orchestration", "stop-gate") |
|--------|----------------|----------------------------------|--------------------|--------------------------------------------------------------------|
| **Carbon IBM Design System** | Usage page, Style page, Accessibility page, Code page (four separate pages per component) | Usage: Live demo → Overview → Anatomy → Sizes/placement → Behaviors → Per-variant deep-dives → Related → References. Style: Color tokens → Typography → Structure/dimensions → Size | Anatomy diagram (labeled visual of parts), color token tables, interactive live demo, accessibility status badges, per-variant examples with descriptive captions | HIGH fit. Four-page split maps cleanly: Overview note (explanation), Spec note (reference tables), Flow notes (per-variant behavior), Recipes (code/usage examples). Anatomy diagram → mermaid component diagram |
| **GOV.UK Design System** | Single component page but with deeply structured sub-sections including "Research on this component" | When to use → How it works (per variant: default, secondary, warning, start) → each variant has: description + live HTML + options table → Research (evidence section) | Variant isolation (one sub-heading per variant, each with own example), options/props table, evidence-backed rationale section ("testing showed green improved click-through") | HIGH fit. "Research on this component" → ADR or evidence note. Variant sections → separate Flow notes per scenario |
| **Polaris (Shopify)** | Usage page + Props-and-examples page (split) | Usage: purpose + when to use + when not to use. Props: interactive demo + props table | "When to use / When not to use" as paired prose blocks; props table with type + default + description | MEDIUM fit. "When not to use" is uniquely valuable for workflow concepts — maps to an explicit "anti-patterns" section in the concept overview |
| **Diátaxis** | Four distinct note TYPES — Explanation, How-to, Reference, Tutorial | Explanation: background → context → connections → why (no steps, no goal). How-to (recipe): goal statement → prerequisites → numbered steps → outcome. Reference: austere, consistent tables, no discussion. Tutorial: learning journey with exercises | The quadrant split itself is the key device — each note serves one mode, reader chooses the right note for their mental state | CRITICAL fit. The monolithic design.md is a quadrant-mixing failure. Split into: Explanation notes (why designed this way), Reference notes (spec tables), How-to notes (recipes). Never mix within one file |
| **Zettelkasten / Structure Notes** | Atomic notes (one idea), Structure notes (hub/MOC), Main structure notes (top-level index) | Atomic: title claim → explanation → wikilinks to related. Structure: section headings → annotated wikilinks → summary of connections | Three structural layers: Content → Structure notes → Main structure (MOC). Structure notes are annotated link collections, not flat lists | MEDIUM fit. Each flow or entity = one atomic note. design/index.md = structure note. concept/index.md = main structure note (MOC). Annotated links > bare links |
| **Obsidian MOC (Linking Your Thinking / LYT)** | Map of Content: curated hub note linking atomic notes with context | Status fields (frontmatter) → grouped link sections with one-line annotations → open questions | Frontmatter YAML for status/owners; group links by theme not alphabetically; annotations on every link saying what the linked note contributes | HIGH fit for the design folder index.md: group links by note type (Flows, Entities, Specs, Recipes), annotate each link |
| **Storybook Docs** | Autodocs page (auto-generated) + MDX pages (custom) | Autodocs: hero canvas (live demo) → args table → additional named stories. MDX: prose sections interspersed with `<Canvas>` and `<ArgsTable>` Doc Blocks | Self-documenting: interactive example + props table generated from code. MDX enables curated narrative alongside live examples | MEDIUM fit. For workflow concepts: replace live demo with a mermaid flow diagram; replace args table with a parameters/behavior reference table in spec.md |
| **Stripe API Reference** | Introduction, Resource pages, Endpoint pages (distinct levels) | Resource: prose description → "The X object" (attributes table) → endpoint list (create, retrieve, update, delete), each with params + response | Resource object attributes as a complete table (name, type, description, nullable); code sample pinned to right panel; guides kept strictly separate from reference | MEDIUM fit. "The X object" pattern → entities.md with a properties table per entity. Guides/tutorials live outside reference, not embedded |
| **Rails Guides / Python HOWTOs** | Topic-focused deep-dives: one guide per feature area | Goal statement → overview → detailed sections (prose + code) → summary. HOWTOs: "more detailed than the library reference" — fills gap between tutorial and reference | Front-loaded goal statement tells reader if this is the right guide. Section headings are navigational. Code examples are inline not in appendix | HIGH fit for Recipe notes: goal statement at top, prerequisites, numbered steps, what you achieve. The HOWTO label implies competence prerequisite |
| **GDD (Game Design Document)** | Living design doc with multi-audience sections | Overview/Vision → Core mechanics (loop) → Detailed mechanics (one section per system) → Art direction → UI/UX → Technical specs → Milestones. Stone Librande variant: one-page design that compresses the whole concept visually | Multi-audience clarity: any discipline (artist, engineer, producer) should parse their section without reading the whole doc. Living document = sections marked WIP/stable | MEDIUM fit. GDD's "per-system" section structure → one note per sub-system (e.g. one note for the stop-gate, one for the pacing budget). "Art direction" section → visual embed slot in entity notes |
| **Figma/Pencil handoff conventions** | Redline/annotation view, token export, dimension tables | Anatomy annotation → dimension specs (padding, margin, radius) → color tokens → export PNG/SVG for embedding | Redlines: every measurable value labeled on the visual. Token tables: name → value → usage. Exported assets stored alongside the spec | HIGH fit for spec.md. Token-style tables (threshold name → value → enforced by) replace prose descriptions. Exported .pen → PNG stored in assets/ and embedded via `![[assets/figure.png]]` |

---

## 2 — Recommended Design Folder IA

For one concept, e.g. `orchestration`:

```
concepts/orchestration/
├── index.md                      # [MOC] — annotated hub; links to all design notes by type
├── requirements/                 # (existing, unchanged)
│   └── REQ-NNN-*.md
└── design/
    ├── overview.md               # [EXPLANATION] — what it is, why designed this way, principles
    ├── entities.md               # [EXPLANATION+ANATOMY] — components, their roles, anatomy diagram
    ├── flows/                    # [EXPLANATION+VISUAL] — one file per key scenario
    │   ├── normal-flow.md
    │   └── stop-gate.md
    ├── spec.md                   # [REFERENCE] — austere tables: thresholds, formats, tokens
    ├── recipes/                  # [HOW-TO] — one file per task a practitioner might do
    │   ├── add-new-agent-type.md
    │   └── debug-failed-gate.md
    └── assets/                   # images, exported PNGs; note source .pen files also here
        └── orchestration-anatomy.png
```

### Note type templates

#### `index.md` — MOC (Map of Content)

```yaml
---
concept: orchestration
status: active        # draft | active | deprecated
owners: []
updated: 2026-08-29
---
```
```
## Understanding
- [[design/overview]] — What orchestration is and why this shape
- [[design/entities]] — The components and their anatomy

## Flows
- [[design/flows/normal-flow]] — Happy path through a wave
- [[design/flows/stop-gate]] — Gate lifecycle: open → verdict → close

## Specifications
- [[design/spec]] — Thresholds, format contracts, pacing limits

## Recipes
- [[design/recipes/add-new-agent-type]] — How to add a new agent to the roster
- [[design/recipes/debug-failed-gate]] — How to diagnose a stuck stop-gate

## Open items
- [[requirements/REQ-009]] — Stop-gate bypass prevention (open)
```

*Obsidian rendering*: wikilinks open on hover. Dataview can query `status` across all concept index files. Annotate every link with a one-line description — never leave a bare wikilink list.

---

#### `overview.md` — Explanation note

```yaml
---
note_type: explanation
concept: "[[orchestration/index]]"
diátaxis: explanation
related_entities: []
---
```
```
## Purpose
[Why this concept exists in groundwork — the need it solves]

## Design philosophy
[Principles that shaped the decisions — e.g. "fan-out over serial", "delegate, never implement"]

## How it fits
[Context diagram — mermaid flowchart TB showing system boundary]

## What it is NOT
[Explicit negative scope — most important section for agents]

## Background
[Prior art, alternatives considered — links to ADRs via [[decisions/]]]
```

*Obsidian rendering*: mermaid context diagram renders natively. No step-by-step instructions — those are recipes. No spec tables — those are spec.md.

---

#### `entities.md` — Anatomy note

```yaml
---
note_type: anatomy
concept: "[[orchestration/index]]"
diátaxis: explanation
entities: []
---
```
```
## Anatomy
![[assets/orchestration-anatomy.png]]

_Figure: [label every callout by number, reference in prose below]_

## Entity reference

### Orchestrator (depth 0)
| Property | Value |
|----------|-------|
| Role | Classifies, delegates, reviews |
| Spawns | junior-orchestrator, general-purpose |
| Cannot spawn | another orchestrator |

### junior-orchestrator (depth 1)
…
```

*Obsidian rendering*: `![[assets/fig.png]]` embeds natively. Properties panel shows frontmatter. Entity table = Carbon's "anatomy" pattern applied to software entities.

---

#### `flows/stop-gate.md` — Flow note

```yaml
---
note_type: flow
concept: "[[orchestration/index]]"
diátaxis: explanation
mermaid_type: stateDiagram-v2
participants: [orchestrator, advisor, ledger]
---
```
```
## Scenario
[What situation this flow covers — one sentence]

## Flow
```stateDiagram-v2
...
```

## Participants
| Participant | Role in this flow |
|-------------|-------------------|
| orchestrator | Initiates gate check |
| advisor | Issues APPROVE/CORRECTION verdict |
| ledger | Records gate result |

## Failure modes
[Table: failure → signal → recovery — links to debug recipe]
```

*Obsidian rendering*: `stateDiagram-v2` renders natively. Each flow is a separate file — non-linear reading without scrolling past irrelevant scenarios.

---

#### `spec.md` — Reference note

```yaml
---
note_type: reference
concept: "[[orchestration/index]]"
diátaxis: reference
---
```
```
## Pacing limits
| Threshold | Value | Enforced by |
|-----------|-------|-------------|
| Max impl waves/session | 1 | ledger-pacing.mjs |
| Autopilot waves | user-authorized only | session-reminder.mjs |

## Format contracts
| Artifact | Format | Schema location |
|----------|--------|-----------------|
| Run ledger | .groundwork/runs/<id>.json | src/lib/ledger-schema.ts |

## Agent roster
| Agent | Model alias | Spawned by |
|-------|-------------|-----------|
| advisor | opus | orchestrator only |
```

*Obsidian rendering*: pure tables — no prose discussion. Diátaxis reference: austere and comprehensive. No "why" here — that is overview.md.

---

#### `recipes/add-new-agent-type.md` — How-to note

```yaml
---
note_type: recipe
concept: "[[orchestration/index]]"
diátaxis: how-to
goal: Add a new agent type to the groundwork roster
prerequisites: [familiarity with agents-src/ format, model-registry.json]
---
```
```
## Goal
[One sentence — what will be achieved]

## Prerequisites
[What the practitioner must already know/have]

## Steps
1. …
2. …

## Verification
[How to confirm it worked]

## Related
- [[spec]] for the agent roster table
- [[decisions/0007-model-registry]] for model assignment rules
```

*Obsidian rendering*: numbered steps render as ordered list. No explanation of why steps work — that is overview.md.

---

## 3 — Rules: What Goes Where (Diátaxis-style)

| Content type | Note type | Rule |
|---|---|---|
| Why this is designed this way | `overview.md` (explanation) | Understanding-oriented; no steps, no tables of values |
| What the parts are, labeled | `entities.md` (anatomy) | Anatomy diagram + property table; still explanation-mode |
| How a scenario plays out | `flows/*.md` (explanation+visual) | One file per scenario; mermaid diagram required for >2 participants |
| Exact values, thresholds, formats | `spec.md` (reference) | Austere tables only; no discussion; comprehensive over readable |
| Step-by-step task for a practitioner | `recipes/*.md` (how-to) | Goal + prerequisites + numbered steps + verification; no teaching |
| Navigation between all the above | `index.md` (MOC) | Annotated links grouped by type; not a flat list |

---

## 4 — Visual Asset Storage and Embedding

**Convention (mudissue-derived, adapted):** assets live in `design/assets/` adjacent to the note that uses them, not in a global `/assets/` root. One concept = one assets folder.

| Asset type | Storage path | Embedding in Obsidian | Notes |
|---|---|---|---|
| Anatomy/flow diagram (mermaid) | Inline in `.md` | Native mermaid rendering — no file needed | Preferred over PNG for diagrams that may need edits |
| Exported PNG/SVG (from Pencil/Figma) | `design/assets/<name>.png` | `![[assets/name.png]]` or `![[assets/name.png\|caption]]` | Store alongside the note that embeds it |
| Pencil source file (.pen file) | `design/assets/<name>.pen` | Wikilink only: `[[assets/name.pen]]` — not embeddable | .pen is binary/encrypted; link for traceability, don't embed |
| Figma export (PDF spec sheet) | `design/assets/<name>.pdf` | `![[assets/name.pdf]]` — limited preview in Obsidian | Prefer PNG for Obsidian readability |

**Sizing recommendation:** export anatomy diagrams at 2x resolution (e.g. 1400px wide) so they read clearly on Retina displays without zoom. Add a `_Figure: …_` italic caption line directly below every embed.

**Agents:** mermaid is the only embeddable format agents can generate inline. For .pen and PNG, the note must pre-exist with the embed slot; an agent fills the mermaid diagram and adds a prose reference to the PNG without generating it.

---

## 5 — Anti-Patterns of the Monolithic design.md

1. **Quadrant mixing** (Diátaxis — HIGH): one file serving explanation, reference, and how-to simultaneously forces the reader to context-switch mentally. The recipe for "how to add a new agent" has no place beside the "why orchestration is fanout-first" explanation.
2. **No anatomy visual anchor** (Carbon/GOV.UK/Polaris — HIGH): every design system component page leads with a labeled anatomy diagram. Prose-only design docs have no spatial anchor; readers cannot skim to locate which part is being described.
3. **Spec values buried in prose** (Carbon Style page — HIGH): thresholds like "max 1 impl wave per session" buried in paragraphs become unscannable. An agent re-reading the file to enforce a rule must parse narrative; a reference table is O(1).
4. **No "when NOT to use" section** (Polaris — MEDIUM): the absence of explicit negative scope is where gold-plating enters. Every concept note needs a "What it is NOT" subsection.
5. **Flat link lists in the index** (Zettelkasten / LYT — MEDIUM): a bare `[[design/stop-gate]]` list has no information value. Annotated links tell the reader why to follow each link.
6. **One file for all flows** (GDD "per system" pattern — MEDIUM): combining 6 sequence diagrams in one file forces top-to-bottom scrolling. One flow per file enables wikilink navigation and non-linear reading.
7. **Recipes mixed into explanation** (Diátaxis — HIGH): "to add a new agent, do X, Y, Z" inside an explanation note is a cooking lesson inside a recipe. The practitioner who knows how to cook does not want the lesson; the learner who needs the lesson is in the wrong note.

---

## 6 — Confidence Grades

| Finding | Confidence | Basis |
|---------|-----------|-------|
| Carbon/GOV.UK multi-page split as template | HIGH | Primary source: fetched live Carbon usage + style pages; GOV.UK full page content |
| Diátaxis quadrant mixing as the root cause of monolithic design.md failure | HIGH | Primary source: diataxis.fr/explanation, diataxis.fr/how-to-guides fetched |
| Zettelkasten three-layer structure (content → structure → main structure) | HIGH | Primary source: zettelkasten.de/overview fetched |
| MOC annotated-links convention | MEDIUM | Nick Milo Medium article behind login wall; based on LYT community documentation known from general knowledge + session memory |
| Material Design 3 component page structure | MEDIUM | M3 pages SPA-rendered — 0 bytes returned; structure based on general knowledge of M3, not fetched content |
| Storybook autodocs + MDX structure | MEDIUM | Storybook docs page fetched; high-level description only, no Doc Blocks schema detail |
| Figma/Pencil handoff conventions | MEDIUM | Figma best-practices page 404; based on general design-handoff knowledge + mudissue convention from session memory |
| Obsidian `![[]]` embed syntax | HIGH | Confirmed from prior research and session memory; official docs SPA-rendered |
| Obsidian dataview/Bases for frontmatter queries | MEDIUM | help.obsidian.md/plugins/dataview returned 0 bytes (SPA); Dataview syntax from prior session research |
| Apple HIG button structure | LOW | Apple developer page SPA-rendered — 0 bytes; excluded from pattern table |
| Atlassian Design System component structure | LOW | Page returned 0 bytes (SPA); excluded from pattern table |

---

## Sources

| Source | URL | Status |
|--------|-----|--------|
| Carbon IBM button usage | https://carbondesignsystem.com/components/button/usage/ | fetched |
| Carbon IBM button style | https://carbondesignsystem.com/components/button/style/ | fetched |
| GOV.UK Design System button | https://design-system.service.gov.uk/components/button/ | fetched |
| Polaris button | https://polaris.shopify.com/components/actions/button | fetched (nav-heavy) |
| Polaris button props | https://polaris.shopify.com/components/actions/button/props-and-examples | fetched |
| Atlassian button usage | https://atlassian.design/components/button/usage | 0 bytes (SPA) |
| Material Design 3 button overview | https://m3.material.io/components/buttons/overview | 0 bytes (SPA) |
| Apple HIG buttons | https://developer.apple.com/design/human-interface-guidelines/buttons | 0 bytes (SPA) |
| Diátaxis explanation | https://diataxis.fr/explanation/ | fetched |
| Diátaxis how-to guides | https://diataxis.fr/how-to-guides/ | fetched |
| Diátaxis reference | https://diataxis.fr/reference/ | fetched |
| Zettelkasten overview | https://zettelkasten.de/overview/ | fetched |
| Nick Milo MOC article | https://nickmilo.medium.com/… | behind login wall |
| Storybook writing docs | https://storybook.js.org/docs/writing-docs | fetched |
| Stripe API reference | https://stripe.com/docs/api | fetched |
| Twilio API overview | https://www.twilio.com/docs/usage/api | fetched |
| Rails Guides index | https://guides.rubyonrails.org/ | fetched |
| Python HOWTOs index | https://docs.python.org/3/howto/index.html | fetched |
| GDD — Game Developer | https://www.gamedeveloper.com/design/how-to-write-a-game-design-document | fetched |
| GDD — Wikipedia | https://en.wikipedia.org/wiki/Game_design_document | fetched |
| Figma handoff best practices | https://www.figma.com/best-practices/design-handoff/ | 404 |
| Obsidian Roundup MOC | https://www.obsidianroundup.org/maps-of-content/ | TLS error |

---

## Recommended Next Step

Prototype the folder IA for one concept — `orchestration` — by splitting the existing `design.md` content across the new note types (overview, entities, one flow note, spec) and dog-food the result: does an agent reading only `spec.md` find the stop-gate threshold without touching other notes? Does a human reading `flows/stop-gate.md` need to jump back to overview.md to understand the diagram? Answer both questions before committing the pattern to spec.
