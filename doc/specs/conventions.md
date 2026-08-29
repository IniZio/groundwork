# Spec System Conventions

## 1. Spec = viewpoints over a system

A spec describes a system through multiple complementary representations called views. Requirements and constraints are one view among peers; a data model, a flow diagram, and an API surface are equally first-class. No single view is authoritative in isolation — understanding emerges from reading them together. This reframe means the unit of organization is a **concept directory**, not a requirements document, and the indexed entry point for that directory is `index.md`.

## 2. Concept directory structure

Each concept lives in its own subdirectory under [doc/specs/](./):

```
doc/specs/<concept>/
  index.md            — concept node (frontmatter: id, type, title, summary, parent, status)
  requirements/       — one file per requirement (<id>-<kebab>.md)
  design/             — design documents (optional)
  decisions/          — decision documents (optional)
  glossary.md         — term definitions (optional)
```

`index.md` is the indexed concept entry point. It carries `id`, `type: concept`, `title`, `summary`, `parent`, and optional `origin_decision_ref` in frontmatter validated by `schemas/spec-concept.schema.json`. The `origin_decision_ref` field, when present, must be a valid decision ref in the form `<motive-slug>#D-<n>` (e.g. `plugin-cleanup#D-5`).

## 2a. Nested and multi-system layouts

`findNearestConceptId` (in `hooks/lib/spec-io.mjs`) walks up to 12 directory levels when associating a requirement file with its parent concept. Arbitrary nesting depth up to 12 is supported by the indexer; nothing requires `parent` to equal the directory name.

### Flat layout (single-system repo — default)

```
doc/specs/
  index.md           ← root concept (created by `spec init`)
  <concept-a>/
    index.md
    requirements/
      <concept-a>-r-001-<kebab>.md
```

`spec init` creates `doc/specs/index.md` and assumes this flat model.

### Multi-system / nested layout

A repo with more than one system can root each system under `doc/specs/<system>/`:

```
doc/specs/
  frontend/
    index.md         ← system concept  (id: C-FRONTEND)
    auth/
      index.md       ← sub-concept     (id: C-FRONTEND-AUTH, parent: C-FRONTEND)
      requirements/
        auth-r-001-<kebab>.md
  backend/
    index.md         ← system concept  (id: C-BACKEND)
```

`findNearestConceptId` walks up to 12 directory levels to associate a requirement file with its parent concept. Requirements in `auth/requirements/` associate with `C-FRONTEND-AUTH` because `auth/index.md` is the nearest concept node walking upward.

**`spec init` assumption:** the command always creates `doc/specs/index.md`. For a multi-system repo, create each system's `index.md` manually with appropriate `id` and `parent` fields; there is no `spec init --system` subcommand.

## 3. View types

Core view `type` values are listed here. Concept views live in the `design/` subdirectory; requirements live in `requirements/`. `spec-lint.mjs` validates view file `type` fields against the core set plus any project-declared extensions (see §3.1 below).

| Type | File convention | Diagram format | What it describes |
|---|---|---|---|
| `overview` | `index.md` | prose | Concept narrative and rationale |
| `data-model` | `data-model.md` | Mermaid `erDiagram` | Entities, fields, relations |
| `flows` | `flows.md` | Mermaid `sequenceDiagram` | Key behavioral sequences (internal collaboration between components) |
| `api` | `api.md` | prose table | Declared operations / interface |
| `constraints` | `constraints.md` (legacy) | prose (`SHALL` statements) | Testable normative invariants — superseded by individual files in `requirements/`; accepted by tooling for existing concepts (see note below) |
| `scenarios` | `scenarios.md` | prose / table | Input alphabet: the externally observable situations you select from and apply to exercise the system. Use `scenarios` when the document lists conditions, stimuli, or test inputs — not the internal component collaboration that `flows` describes. |
| `cases` | `cases.md` | prose / table | A register of instances (test cases, failure cases, edge cases) that do not individually warrant full requirement nodes. Use `cases` when a list entry would not survive promotion to a `constraints` entry — i.e. it lacks or should not carry its own Why / Fit criterion / Criticality block. |

> **Choosing between `scenarios` and `flows`:** `flows` traces internal collaboration (sequence diagrams, message passing between components). `scenarios` is the input alphabet you select from to exercise the system — it answers "what situations can arise?" not "what happens internally when they do?"

> **Choosing between `cases` and `constraints`:** if you would not want each entry to become a requirement node with a full Why / Fit criterion / Criticality block, it belongs in `cases`, not `constraints`. Promoting every case entry to a requirement is a design signal that it belongs in `constraints`.

> **`constraints` view type (legacy)** — in prior layouts, normative invariants were held in `constraints.md` and registered in a `spec.yaml` view registry. In the D-15 layout, normative requirements are individual files in `requirements/<id>-<kebab>.md`. Legacy `constraints.md` files are accepted by tooling but are not the authoring target for new requirements.

### 3.1 Project-declared view type extensions

If none of the core types fit, place a design document in `design/` with a `type` frontmatter field naming the project-local view type. This is modelled on ISO/IEC/IEEE 42010 viewpoint vocabulary: you may invent a type, but you must state what concern it frames and what the view contains. Document the extension in the concept's `index.md` or a `design/_MOC.md` map-of-content.

Rules enforced by `spec-lint`:

1. `name` must match `^[a-z][a-z0-9-]*$`.
2. `name` **must not** shadow a core type — the core wins. If you need a narrative document about a core type (e.g. a verification strategy), use a distinct name like `verification-strategy`.
3. Any `views[].type` that is neither a core type nor declared in `view_types` is a lint violation (`unknown-view-type`) with an error message that lists the core types and shows the declaration snippet pre-filled with the rejected name.
4. A `view_types` entry that no `views` entry uses emits a warning (dead vocabulary is untidy, not wrong).

## 4. View file format rule

Every view file **MUST** have exactly two frontmatter fields: `type` and `id`. No other frontmatter fields are permitted. Adding a third field causes a `spec-lint unknown-field` violation and exit 1. Omitting either field causes a `spec-lint required-field` violation.

Valid view file header:

```yaml
---
type: data-model
id: C-MYCONCEPT
---
```

The `id` value **MUST** match the owning concept's id (the same value declared in the concept's `index.md`).

### Spec views are self-contained

Every view file **MUST** be fully self-contained. The full rationale (Why), fit criteria, and verification method for each requirement belong **inside** the view file — not in an external document. In particular:

- **RFCs are for progress tracking and journaling.** They are not committed to the repository and are not a durable source of spec truth. A `constraints.md` file **MUST NOT** rely on an RFC to supply rationale or acceptance criteria.
- **Individual requirement files** (`requirements/<id>-<kebab>.md`) carry normative `**shall**` (or `**shall not**` for prohibitions) statements with Why, Fit criterion, Criticality, and Verification method inline. A requirement that lacks these fields is incomplete regardless of whether an RFC exists that documents them.
- **`Verification:` describes a method, not evidence.** Write it as a test specification: what to run, what inputs to use, what outcome certifies compliance. Use future-tense prose ("Integration test asserts that…"). Evidence of having run the verification belongs in the RFC journal or commit history — not in the spec. The field is populated before the tests exist; its purpose is to specify them precisely enough that another engineer can implement them.
- **`Criticality:` is a machine-readable index tag** (`must` / `should` / `may`). It is NOT redundant with the normative verb (SHALL / SHOULD / MAY) in the requirement body. The body uses RFC 2119 language for the binding normative statement; `Criticality` is the structured index key for filtering and tooling queries (e.g. "show all `must` requirements"). Both must be present and consistent: a `shall` body requires `Criticality: must`; a `should` body requires `Criticality: should`.
- **Legacy filenames (`requirements.md`, `constraints.md`) are superseded.** New spec content uses individual files in `requirements/<id>-<kebab>.md`. Tooling accepts the legacy filenames but they are not the authoring target for new requirements.

### Annotation line formats

Two forms are accepted for the Verification/Criticality annotation. The **two-bullet form is preferred** for new requirements:

```
- **Verification**: <automated|manual|hybrid> — <brief prose description of the test method>
- **Criticality**: <must|should>
```

The **single-line form** is the legacy format, still valid:

```
- **Verification** <automated|manual|hybrid> · **Criticality** <must|should> · **Source** <rfc-uid>
```

`Source` is **optional in both forms**. Include it when the requirement traces to a specific RFC (e.g. `Source R-20260726-K4M2QX`); omit it when no RFC is the origin. Tooling parses both forms; mixing forms across requirements in the same file is permitted.

**`verification: manual` — recommended `### Manual procedure` sub-section.** When the annotation declares `Verification: manual`, the requirement body should also include a `### Manual procedure` H3 sub-section directly after the annotation bullets, describing the exact steps needed to verify compliance. A manual verification without written steps is not verifiable by a second engineer. Example:

```markdown
## MYFEATURE-R-001 — The system does X {#myfeature-r-001}

The system **shall** do X.

- **Why** — Without X, Y breaks.
- **Fit criterion** — After running Z, X is confirmed.
- **Verification**: manual — Inspect the output of Z and confirm X.
- **Criticality**: must

### Manual procedure

1. Run `<command>`.
2. Observe that `<expected output>` appears.
3. Confirm that `<invariant>` holds.
```

## 5. Concept index (`index.md`)

`index.md` is the indexed entry point for a concept directory. It carries concept-level metadata in YAML frontmatter validated against `schemas/spec-concept.schema.json`.

Required frontmatter fields:
- `id` — concept identifier (pattern: `C-[A-Z][A-Z0-9-]+`)
- `type: concept`
- `title` — human-readable name
- `summary` — one-line description (≤25 words; enforced by `summary-length` lint rule)
- `parent` — parent concept id (omit at root)

Optional fields:
- `status` — lifecycle status (see §6)
- `origin_decision_ref` — in the form `<motive-slug>#D-<n>` (e.g. `plugin-cleanup#D-5`)

## 6. Status lifecycle — spec concepts

The following table is the **single canonical source** for spec concept status values and their meanings. The `status` field in `index.md` frontmatter must use one of these values.

| Status | Meaning |
|---|---|
| `draft` | Initial description; may change freely |
| `review` | Stable enough for agent use; awaiting validation against implementation |
| `accepted` | Validated against implementation; breaking changes require RFC |
| `deprecated` | No longer in use; see replacement |

### Status transition triggers

- **`draft`** — the initial state for any new concept. The writer is actively designing; structure and requirements may change freely without a change record.
- **`review`** — set when the concept is stable enough for team validation. The spec accurately reflects the intended design; the primary open question is whether the implementation agrees.
- **`accepted`** — set after the team has reviewed and approved the concept as normative. From this point, breaking changes (removing requirements, changing IDs, altering constraints) require an RFC.
- **`deprecated`** — set when the concept is superseded or removed. The `index.md` SHOULD link to the replacement concept or the RFC that retired it.

## 7. Origin decision ref — traceability field

The `origin_decision_ref` field links a spec node back to the motive decision that introduced it.

**Format:** `<motive-slug>#D-<n>` — where `<motive-slug>` is the kebab-case slug of the motive (e.g. `plugin-cleanup`) and `D-<n>` is a decision identifier in that motive's Decision Log (e.g. `D-5`).

**Example:** `origin_decision_ref: plugin-cleanup#D-5`

**Semantics:**
- The field is **optional** — omitting it is silent (no lint violation).
- When present, the value **must** match the pattern `<motive-slug>#D-<n>` exactly; an empty value, the literal `null`, or any non-matching string is a `origin-decision-ref` lint violation.
- The field does not carry referential-integrity enforcement at lint time — the target decision is not verified on disk. It is a human-readable traceability link.

**Why optional:** not every spec change has a corresponding motive decision. Small fixes and obvious corrections need not carry a traceability ref.

## 8. Node ownership rule

`index.md` is the **indexed concept node** — it carries `id`, `type: concept`, `title`, `summary`, and `parent`, validated by `spec-concept.schema.json`. The `origin_decision_ref` field is optional; if present it must be a valid decision ref in the form `<motive-slug>#D-<n>`. Individual requirement files in `requirements/` are **not** concept nodes; they are indexed separately by `spec-io.mjs` and linked to their parent concept via `findNearestConceptId`.

## 9. Concept relationships

Cross-concept relationships are **informational only** — a human-readable dependency map, not a machine-checked contract. Document relationships in `index.md` prose or in a `design/` document. Concept IDs referenced this way are not verified against any registry by `spec lint`. Do not use prose relationships for machine enforcement; use RFC `spec_delta` for tracked structural changes.

## 10. Lint checks

`spec lint` (`node hooks/spec.mjs lint`) validates both concept `index.md` files and individual requirement files in `requirements/`.

**Concept `index.md` checks:**
- `required-field` — `id`, `type`, `title`, `summary`, `parent` must all be present.
- `summary-length` — summary must not exceed 25 words.
- `origin-decision-ref` — when `origin_decision_ref` is present, it must match `<motive-slug>#D-<n>`.

**Requirement file checks:**
- `required-field` — `id`, `title`, `concept`, `criticality`, `verification` must all be present.
- `ids_prefix` — requirement `id` must begin with the expected prefix derived from the concept id (e.g. `ENFORCEMENT-R-`).
- `unknown-view-type` — `type` in a design document must be a known core type or a declared project extension (see §3.1).
