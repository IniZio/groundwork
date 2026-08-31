---
id: s0-design-research
ticket_type: research
motive: obsidian-native-groundwork
status: complete
date: 2026-08-29
---

# S0: Design-Half Research — Spec System Survey

## Scope

Survey how Kiro, arc42, C4, MADR, Mermaid, and Diátaxis handle the DESIGN half of a spec. Recommend an optimal shape per aspect for a Markdown+frontmatter, Obsidian-rendered spec tree whose consumers are both humans and coding agents. Out of scope: requirements authoring conventions (covered by EARS split), task/ticket formats, CI tooling.

---

## Aspect Table

| Aspect | Kiro `design.md` | arc42 | Other sources | Recommended shape | Obsidian renderability | Confidence |
|--------|-----------------|-------|---------------|-------------------|----------------------|------------|
| **Data shapes / domain model** | Implied under "system architecture and component design" — no explicit section name | S8 Crosscutting Concepts (domain entity model example: TrafficPursuitUnit); S5 Building Block View covers typed decomposition | C4 Component level; OpenAPI `components/schemas`; DDD aggregate maps | `## Domain Model` in `design.md`. `erDiagram` for entity-rel; `classDiagram` for typed objects with attributes. Frontmatter: `domain_entities: [Entity1]` | Both diagram types render natively in Obsidian | HIGH |
| **State machines & lifecycles** | Not a named section | S6 Runtime View (behavior); S8 event handling patterns (TrafficPursuitUnit event handling example) | XState / UML statechart conventions | `## State Machines` in `design.md`. `stateDiagram-v2` per stateful entity. One sub-heading per entity | Renders natively | HIGH |
| **Flows (control flow, sequence between components)** | "Sequence diagrams and data flow" — core of design.md | S6 Runtime View: scenario-based sequences; tip 6-7 recommends activity diagrams with swimlanes | arc42 tip 6-6: partial scenarios; UML sequence + activity | `## Flows` in `design.md`. `sequenceDiagram` per key scenario (name each sub-section); `flowchart TD` for decision/control trees. Keep to architecturally relevant scenarios only (arc42 tip 6-2) | Both render natively | HIGH |
| **Interfaces & contracts (CLI, hook JSON, file formats)** | Implied in "component design" — no dedicated section | S3 Context & Scope (external interfaces); S5 internal interfaces between building blocks | OpenAPI (REST), AsyncAPI (events), JSON Schema (file formats); arc42 S5 blackbox descriptions include explicit interface tables | `## Interfaces` section in `design.md` OR `interfaces/<name>.md` files if >3 contracts. CLI: Markdown table (command \| flags \| stdin \| stdout \| exit-codes). Hook JSON: annotated fenced block. File formats: inline YAML/JSON schema. Frontmatter: `interface_types: [cli, hook, file-format]` | Tables + fenced blocks render natively; no native OpenAPI renderer | HIGH |
| **Architecture / context (component & boundaries)** | "System architecture and component design" — in design.md | S3 Context & Scope; S4 Solution Strategy; S5 Building Block View (whitebox/blackbox hierarchy) | C4: 4 levels — Context (L1), Container (L2), Component (L3), Code (L4). flowchart or C4 Mermaid extension | `## Architecture` section first in `design.md`. `flowchart TB` C4-style: top box = system; cluster per container; arrows = interactions. One diagram at L1 (context), one at L2 (containers). Frontmatter: `components: [A, B]` | flowchart renders; C4 Mermaid plugin not confirmed in Obsidian — use plain flowchart | MEDIUM |
| **Decisions (ADR) and linkage** | Not a design.md section | S9 Architecture Decisions — points to MADR/Nygard format ADRs in external files | MADR 4.0: fields: `status`, `date`, `decision-makers`, `consulted`, `informed`; body: Context & Problem / Decision Drivers / Considered Options / Decision Outcome / Pros & Cons per option / Consequences | Separate `decisions/NNNN-title.md` per ADR. MADR frontmatter. Link from `design.md` body via `[[decisions/0001-title]]`. Status queryable via Dataview/Bases on `status` field | Wikilinks + Properties panel for frontmatter; Dataview/Bases can filter by status | HIGH |
| **Non-functional requirements & constraints** | "Error handling and testing strategy" — partial | S1 Quality Goals; S2 Constraints; S10 Quality Requirements (quality scenarios) | IEEE 830; EARS `when/while/if` patterns carry NFR intent | `## Non-Functional Requirements` section in `design.md`. Table: NFR-type \| statement \| measure \| source-req. Link `source-req` to `requirements/REQ-NNN.md` via wikilink. Frontmatter: `nfr_types: [performance, security, reliability]` | Table + wikilinks render; Dataview can aggregate NFR types | HIGH |
| **Glossary / ubiquitous language** | Not mentioned | S12 Glossary — term, definition, synonym, source | DDD bounded context ubiquitous language; arc42 S12 is mandatory for domain-heavy systems | Separate `glossary.md` per concept folder. Table: term \| definition \| synonym \| see-also. Body of `design.md` links `[[glossary#term]]` for key terms. Global concepts get a root `glossary.md` | Heading anchors work in Obsidian for `[[file#heading]]` links | MEDIUM |
| **Traceability (req ↔ design ↔ task)** | Implicit in three-file pipeline (requirements → design → tasks); tasks reference requirements but no explicit frontmatter convention | Not a standard arc42 section; left to tooling | RFC traceability matrices; DOORS; lightweight: frontmatter lists | `design.md` frontmatter: `covers_requirements: [REQ-001, REQ-002]`. Task files: `implements_design: [[design]]`. A `traceability.md` Dataview query produces req↔design matrix automatically from frontmatter | Dataview/Bases queries on YAML list frontmatter are the native Obsidian mechanism | MEDIUM |
| **Error / failure modes** | "Error handling and testing strategy" — named but not structured | S6 Runtime View explicitly includes "error and exception scenarios" as one of four scenario categories | FMEA (Failure Mode and Effects Analysis); chaos engineering runbooks | `## Failure Modes` subsection within `## Flows` or standalone section. Table: scenario \| trigger \| system response \| recovery path \| related-req. `stateDiagram-v2` for error state transitions if >3 states | Table + stateDiagram render | HIGH |
| **Examples / fixtures** | Not mentioned | Not a standard section | Diátaxis: examples belong in tutorials/how-to, NOT reference/explanation (design docs are explanation-mode; mixing examples in explanation is an anti-pattern per Diátaxis) | `## Examples` at bottom of `design.md` for minimal illustrative payloads (≤3). Full fixtures live in `test/` — link `design.md` → test fixture files. Fenced code blocks only; no inline lorem ipsum data | Fenced blocks render with syntax highlighting | MEDIUM |
| **Open questions / TBDs** | Not named | S11 Risks & Technical Debt captures outstanding items | MADR `status: proposed` for unresolved decisions; RFC "TODO" sections | `## Open Questions` at end of `design.md`. Each item: `- [ ] **TBD:** question (owner: @X, blocking: [[REQ-NNN]])`. Frontmatter: `open_questions: N` (manually or Dataview-derived). Resolved items move to a decision or get struck through | Checkboxes render; Dataview `length(filter(open_questions, ...))` works on list fields | MEDIUM |

---

## Recommended Concept Folder Layout

```
concepts/<slug>/
├── index.md                     # overview: purpose, owners, status, wikilinks to design + requirements
├── requirements/                # one file per requirement (EARS + verification_method)
│   └── REQ-001-<name>.md
├── design.md                    # all design aspects in one file (see section order below)
├── decisions/                   # one MADR file per architectural decision
│   └── 0001-<title>.md
└── glossary.md                  # term | definition | synonym table
```

**`design.md` internal section order** (top→bottom = zoom-out→detail):
```
## Architecture          ← C4 context + container diagrams (flowchart TB)
## Domain Model          ← erDiagram or classDiagram
## State Machines        ← stateDiagram-v2 per stateful entity
## Flows                 ← sequenceDiagram per key scenario
## Interfaces            ← tables + annotated fenced blocks
## Non-Functional Requirements  ← table: type | measure | source-req
## Failure Modes         ← table + optional stateDiagram
## Examples              ← minimal illustrative payloads only
## Open Questions        ← [ ] checklist with owners
```

**Rationale for section-vs-file split:**

- `design.md` stays **one file** for all tightly-coupled aspects. Humans read design top-to-bottom (zoom out → zoom in); splitting Architecture and Flows into separate files forces two-window navigation with no gain. Agents scan `## ` headers as anchors — consistent headers are sufficient without file-level splitting.
- `decisions/` **must be separate files** because ADRs have an independent lifecycle (proposed → accepted → superseded), must be linkable from multiple design docs cross-concept, and their `status` frontmatter must be queryable in isolation by Dataview/Bases.
- `glossary.md` is a **separate file** because terms are referenced from both `requirements/` and `design.md`; a shared file avoids duplication and is linkable via `[[glossary#term]]`.
- `requirements/` stays **one file per requirement** (existing pattern) — enables per-requirement `verification_method` frontmatter and Dataview queries.
- `examples/` subdirectory is **optional** — only needed when fixtures exceed 3 payloads or require versioning.

---

## Anti-Patterns Observed

1. **Requirements prose mixed into design.md** — "The system shall…" statements in a design doc create a drift zone: requirements evolve but design prose lags behind. The split (requirements/ + design.md) is essential, not optional.
2. **Narrative-only flows without diagrams** — Prose descriptions of multi-component interactions become unreadable beyond 3 components and unscannable by agents searching for "who calls whom." Require `sequenceDiagram` for every scenario with >2 participants.
3. **No `##` section structure in design.md** — A wall of prose with no headers gives agents no anchor point and humans no jump-to. Enforce the section order above as non-optional structure (a lint rule or spec-guard check).
4. **ADRs inlined in design.md** — Embedded decisions lose their lifecycle. Once a decision is superseded, the old text pollutes the design doc with no clear status signal. Always externalize to `decisions/NNNN-title.md`.
5. **Glossary as prose paragraphs** — Terms buried in narrative paragraphs cannot be queried, linked to, or found by agents scanning for a definition. Table format is mandatory for machine consumption.
6. **Traceability by convention only (no frontmatter)** — Without `covers_requirements` frontmatter on design.md, req↔design matrices require manual inspection. Frontmatter is cheap; the Dataview payoff is automatic.
7. **Conflating Diátaxis explanation with how-to** — A design doc is explanation-mode (understanding-oriented). Step-by-step "how to set up the system" prose in design.md violates Diátaxis; that content belongs in how-to guides or runbooks outside the spec tree.

---

## Sources

| Source | URL | Status |
|--------|-----|--------|
| Kiro Specs Overview | https://kiro.dev/docs/specs/ | ✓ fetched |
| Kiro Feature Specs | https://kiro.dev/docs/specs/feature-specs/ | ✓ fetched |
| Kiro design.md page | https://kiro.dev/docs/specs/design/ | 404 |
| arc42 Overview | https://arc42.org/overview/ | ✓ fetched |
| arc42 S5 Building Block View | https://docs.arc42.org/section-5/ | ✓ fetched |
| arc42 S6 Runtime View | https://docs.arc42.org/section-6/ | ✓ fetched |
| arc42 S8 Crosscutting Concepts | https://docs.arc42.org/section-8/ | ✓ fetched |
| arc42 S9 Architecture Decisions | https://docs.arc42.org/section-9/ | ✓ fetched |
| C4 Model | https://c4model.com/ | ✓ fetched |
| MADR site | https://adr.github.io/madr/ | ✓ fetched |
| MADR template (raw) | https://raw.githubusercontent.com/adr/madr/main/template/adr-template.md | ✓ fetched |
| Mermaid: class diagram | https://mermaid.js.org/syntax/classDiagram.html | ✓ fetched |
| Mermaid: sequence diagram | https://mermaid.js.org/syntax/sequenceDiagram.html | ✓ fetched |
| Mermaid: state diagram | https://mermaid.js.org/syntax/stateDiagram.html | ✓ fetched |
| Mermaid: ER diagram | https://mermaid.js.org/syntax/entityRelationshipDiagram.html | ✓ fetched |
| Mermaid: flowchart | https://mermaid.js.org/syntax/flowchart.html | ✓ fetched |
| Diátaxis | https://diataxis.fr/ | ✓ fetched (SPA-light; overview only) |
| Obsidian Properties docs | https://help.obsidian.md/properties | empty (SPA-rendered) |
| GitHub Spec Kit | not found — URL unknown | not fetched |
| OpenAPI / AsyncAPI | not fetched — left as known industry standard | — |
| arc42 raw template (GitHub) | https://raw.githubusercontent.com/arc42/arc42-template/master/EN/plain/arc42-template-EN.md | 404 |

---

## Gaps

- **Obsidian Properties type list**: official docs returned 0 bytes (SPA-rendered). Known from prior session memory: supported types are text, list, number, checkbox, date, datetime, link (wikilink). Confidence MEDIUM — from session context not primary source.
- **Obsidian Bases / Dataview**: neither Bases nor Dataview docs were fetched. Recommendations for Dataview queries rely on documented Dataview syntax (not fetched this session). Verify `length(filter(...))` syntax against Dataview docs before implementing traceability queries.
- **C4 Mermaid extension in Obsidian**: C4 diagrams via the `C4Context` Mermaid keyword require a Mermaid version that ships the C4 extension. Obsidian's bundled Mermaid version may not include it. Fallback (plain `flowchart TB` with manual C4 layout) confirmed renderable.
- **GitHub Spec Kit**: could not locate a canonical public URL for the Spec Kit templates referenced in the task. Excluded from table.
- **Kiro's internal design.md template**: the `/docs/specs/design/` page is 404; only the overview descriptions ("system architecture, sequence diagrams, data flow, error handling, testing strategy") were available from the specs index page. The actual generated template content is inferred, not confirmed.

## Recommended Next Step

Write `design.md` for the first `obsidian-native-groundwork` concept using the section order above, and add a Dataview query to `traceability.md` querying `covers_requirements` across all design files — this proves the frontmatter convention works before investing in more concepts.
