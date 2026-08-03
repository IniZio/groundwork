# Spec System Conventions

## 1. Spec = viewpoints over a system

A spec describes a system through multiple complementary representations called views. Requirements and constraints are one view among peers; a data model, a flow diagram, and an API surface are equally first-class. No single view is authoritative in isolation — understanding emerges from reading them together. This reframe means the unit of organization is a **concept directory**, not a requirements document, and the machine-readable anchor for that directory is `spec.yaml`.

## 2. Concept directory structure

Each concept lives in its own subdirectory under [doc/specs/](./):

```
doc/specs/<concept>/
  spec.yaml           — machine manifest (view registry, lint config, status)
  README.md           — concept node (indexed entry point; carries id, title, summary)
  data-model.md       — optional view: entities, fields, relations
  flows.md            — optional view: key behavioral sequences
  api.md              — optional view: declared operations / interface
  constraints.md      — optional view: testable normative invariants (self-contained: Why, Fit criterion, Criticality inline)
```

`README.md` is the indexed concept node during the current transition period — it carries the `id`, `type: concept`, `title`, `summary`, and `parent` fields validated by `spec-concept.schema.json`; `origin_decision_ref` is an optional field that, when present, must be a valid decision ref in the form `<motive-slug>#D-<n>` (e.g. `plugin-cleanup#D-5`). Renaming it to `overview.md` is a deferred follow-up; until that lands, `README.md` remains the single indexed entry point per concept.

## 2a. Nested and multi-system layouts

`findNearestConceptId` (in `hooks/lib/spec-io.mjs`) walks up to 12 directory levels when associating a requirement file with its parent concept. Arbitrary nesting depth up to 12 is supported by the indexer; nothing requires `parent` to equal the directory name.

### Flat layout (single-system repo — default)

```
doc/specs/
  README.md          ← root concept (created by `spec init`)
  <concept-a>/
    README.md
    spec.yaml
    constraints.md
```

`spec init` creates only `doc/specs/README.md` and assumes this flat model.

### Multi-system / nested layout

A repo with more than one system can root each system under `doc/specs/<system>/`:

```
doc/specs/
  frontend/
    README.md        ← system concept  (id: C-FRONTEND)
    spec.yaml
    auth/
      README.md      ← sub-concept     (id: C-FRONTEND-AUTH, parent: C-FRONTEND)
      spec.yaml
      constraints.md
  backend/
    README.md        ← system concept  (id: C-BACKEND)
    spec.yaml
```

`spec build` indexes all concept nodes correctly regardless of depth. Requirements in `auth/constraints.md` associate with `C-FRONTEND-AUTH` because that is the nearest `README.md` walking upward.

**`spec init` assumption:** the command always creates `doc/specs/README.md`. For a multi-system repo, create each system's `README.md` manually with appropriate `id` and `parent` fields; there is no `spec init --system` subcommand.

## 3. View types

Core view `type` values are listed here. `spec-lint.mjs` validates every `type` declared in `spec.yaml` against the core set plus any project-declared extensions (see §3.1 below).

| Type | File convention | Diagram format | What it describes |
|---|---|---|---|
| `overview` | `README.md` | prose | Concept narrative and rationale |
| `data-model` | `data-model.md` | Mermaid `erDiagram` | Entities, fields, relations |
| `flows` | `flows.md` | Mermaid `sequenceDiagram` | Key behavioral sequences (internal collaboration between components) |
| `api` | `api.md` | prose table | Declared operations / interface |
| `constraints` | `constraints.md` | prose (`SHALL` statements) | Testable normative invariants — use only when you want each entry to become a full requirement node with Why / Fit criterion / Criticality (see note below) |
| `scenarios` | `scenarios.md` | prose / table | Input alphabet: the externally observable situations you select from and apply to exercise the system. Use `scenarios` when the document lists conditions, stimuli, or test inputs — not the internal component collaboration that `flows` describes. |
| `cases` | `cases.md` | prose / table | A register of instances (test cases, failure cases, edge cases) that do not individually warrant full requirement nodes. Use `cases` when a list entry would not survive promotion to a `constraints` entry — i.e. it lacks or should not carry its own Why / Fit criterion / Criticality block. |

> **Choosing between `scenarios` and `flows`:** `flows` traces internal collaboration (sequence diagrams, message passing between components). `scenarios` is the input alphabet you select from to exercise the system — it answers "what situations can arise?" not "what happens internally when they do?"

> **Choosing between `cases` and `constraints`:** if you would not want each entry to become a requirement node with a full Why / Fit criterion / Criticality block, it belongs in `cases`, not `constraints`. Promoting every case entry to a requirement is a design signal that it belongs in `constraints`.

> **`constraints` view type and the `constraints.md` file** — the `constraints` view type in the table above names the _kind_ of a view: normative invariants. The file that holds those invariants is `constraints.md`, registered in `spec.yaml` as `type: constraints`. Listing `type: constraints` in `spec.yaml` registers the view for tooling (lint, index); it does not drop or filter any requirements. The requirements themselves live in the body of `constraints.md` as anchored H3 sections. There is no separate processing step that would silently remove them.
>
> **Deprecated filename `requirements.md`:** tooling accepts `requirements.md` as a deprecated alias for the file **name** only. The view **type** must still be `type: constraints` — there is no view type named `requirements`. If you name the file `requirements.md` in `spec.yaml`, write `type: constraints`, not `type: requirements`. Writing `type: requirements` triggers an `unknown-view-type` lint violation. All new content uses `constraints.md`.

### 3.1 Project-declared view type extensions

If none of the core types fit, declare a project-local type under `view_types` in `spec.yaml`. This is modelled on ISO/IEC/IEEE 42010 viewpoint vocabulary: you may invent a type, but you must state what concern it frames and what the view contains.

```yaml
view_types:
  - name: fixtures
    concern: "Which canned datasets exist and what each one is for — needed by anyone writing a new harness test."
    contents: "Table of named fixture datasets with provenance and intended use."

views:
  - type: overview
    file: README.md
  - type: scenarios
    file: scenarios.md
  - type: fixtures        # resolves against view_types above
    file: fixtures.md
```

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

The `id` value **MUST** match the owning concept's id (the same value in `README.md` and `spec.yaml`).

### Spec views are self-contained

Every view file **MUST** be fully self-contained. The full rationale (Why), fit criteria, and verification method for each requirement belong **inside** the view file — not in an external document. In particular:

- **RFCs are for progress tracking and journaling.** They are not committed to the repository and are not a durable source of spec truth. A `constraints.md` file **MUST NOT** rely on an RFC to supply rationale or acceptance criteria.
- **The `constraints.md` view type** carries normative `**shall**` (or `**shall not**` for prohibitions) statements with Why, Fit criterion, Criticality, and Verification method inline. A constraint entry that lacks these fields is incomplete regardless of whether an RFC exists that documents them.
- **`Verification:` describes a method, not evidence.** Write it as a test specification: what to run, what inputs to use, what outcome certifies compliance. Use future-tense prose ("Integration test asserts that…"). Evidence of having run the verification belongs in the RFC journal or commit history — not in the spec. The field is populated before the tests exist; its purpose is to specify them precisely enough that another engineer can implement them.
- **`Criticality:` is a machine-readable index tag** (`must` / `should` / `may`). It is NOT redundant with the normative verb (SHALL / SHOULD / MAY) in the requirement body. The body uses RFC 2119 language for the binding normative statement; `Criticality` is the structured index key for filtering and tooling queries (e.g. "show all `must` requirements"). Both must be present and consistent: a `shall` body requires `Criticality: must`; a `should` body requires `Criticality: should`.
- **The `requirements.md` filename is superseded by `constraints.md`.** New spec content uses `constraints.md`. Tooling accepts `requirements.md` as a deprecated **filename** alias — the view **type** must still be `type: constraints`, not `type: requirements` (`requirements` is not a view type). No new files should use the old name.

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

## 5. spec.yaml — the manifest

`spec.yaml` is the machine-readable manifest for a concept directory. It is validated against `schemas/spec-manifest.schema.json` by `spec lint`.

Complete annotated example:

```yaml
# Concept identifier — must match README.md and all view file id fields.
# Pattern: C-[A-Z][A-Z0-9-]+
id: C-ARTIFACT

# Human-readable concept title — must match README.md title field.
title: Artifact

# One-line summary (1–180 characters) — must match README.md summary field.
summary: "Spec-system artifacts produced and consumed by groundwork agents."

# Lifecycle status of this spec concept.
# See §6 for the full status table.
status: review

# owner_team: Platform            # Omit entirely when unknown; never use an empty string.

# Ordered list of view documents for this concept.
# Each entry must have a 'type' (from the table in §3) and a 'file' path
# relative to this concept directory.
views:
  - type: overview
    file: README.md
  - type: data-model
    file: data-model.md
  - type: constraints
    file: constraints.md

# Cross-concept relationships — informational only; concept IDs are NOT
# verified against a registry by spec lint. Do not use for machine enforcement.
relations:
  _note: "Informational only"
  items:
    - kind: depends-on
      target: C-ORCHESTRATION

# Lint configuration for automated checks.
# See §10 for full explanation of each check.
lint:
  data-model:
    type_names:
      source: types          # Only 'types' is supported; 'prisma', 'schema', 'graphql' → violation.
      names:
        - ArtifactNode
        - ArtifactRef
  api:
    operations:
      - artifact build
      - artifact publish

# status_policy: custom status transition rules, keyed by status value.
# When present, spec-lint asserts this block matches the canonical definition
# in §6 of this file. Omit to inherit the canonical policy.
# status_policy:
#   draft: "Initial description; may change freely"
#   review: "Stable enough for agent use; awaiting validation"
```

### `summary` — ≤25 words, byte-identical in README.md and spec.yaml

The `summary` field appears in both `README.md` frontmatter and `spec.yaml`. These two copies **must be byte-identical**. Two lint rules enforce this:

- **`summary-length`** — `spec lint` rejects a summary exceeding 25 words in either file. Exactly 25 words passes; 26 fails.
- **`manifest-mismatch`** — `spec lint` rejects any `id`, `title`, or `summary` value that differs between `spec.yaml` and `README.md`. The error names both file paths and both values:

  ```
  LINT_DRIFT <id>: manifest-mismatch: concept "<id>" summary differs —
    /abs/path/to/spec.yaml: "value in spec.yaml" vs
    /abs/path/to/README.md: "value in README.md"
  ```

When you edit one file, update the other in the same commit. A `spec lint` run in CI catches any drift before it merges.

_(Long-term, deriving one from the other would eliminate the duplication. That redesign is deferred; the lint check is the current guard.)_

### Dual manifest authority

A concept may have two `spec.yaml` files: one at the project root and one inside the concept directory. These serve different purposes:

- The **concept-level `spec.yaml`** (inside `doc/specs/<concept>/`) is the **canonical manifest** for tooling. View paths in it are relative to that directory. `spec-lint` reads this file.
- The **root `spec.yaml`** (at the repository root, if present) is an **optional project-level index**. It may enumerate concept directories for navigation purposes. It does not override any field in the concept-level manifest. A tool resolving concept data MUST prefer the concept-level file.

If a root manifest and a concept-level manifest share the same `id`, the concept-level file wins. Writers MUST NOT assume the root manifest drives tooling behaviour.

## 6. Status lifecycle — spec concepts

The following table is the **single canonical source** for spec concept status values and their meanings. When `status_policy` is present inline in a `spec.yaml`, `spec-lint` asserts that every entry matches this table.

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
- **`deprecated`** — set when the concept is superseded or removed. The `README.md` SHOULD link to the replacement concept or the RFC that retired it.

## 7. Origin decision ref — traceability field

The `origin_decision_ref` field links a spec node back to the motive decision that introduced it.

**Format:** `<motive-slug>#D-<n>` — where `<motive-slug>` is the kebab-case slug of the motive (e.g. `plugin-cleanup`) and `D-<n>` is a decision identifier in that motive's Decision Log (e.g. `D-5`).

**Example:** `origin_decision_ref: plugin-cleanup#D-5`

**Semantics:**
- The field is **optional** — omitting it is silent (no lint violation).
- When present, the value **must** match the pattern `<motive-slug>#D-<n>` exactly; an empty value, the literal `null`, or any non-matching string is a `origin-decision-ref` lint violation.
- The field does not carry referential-integrity enforcement at lint time — the target decision is not verified on disk. It is a human-readable traceability link.

**Why optional:** not every spec change has a corresponding motive decision. Small fixes and obvious corrections need not carry a traceability ref.

## 8. Node ownership rule (transitional)

`README.md` is the **indexed concept node** — it carries `id`, `type: concept`, `title`, `summary`, and `parent`, validated by `spec-concept.schema.json`. The `origin_decision_ref` field is optional; if present it must be a valid decision ref in the form `<motive-slug>#D-<n>`. View files are **not** indexed nodes; they are reached via the `spec.yaml` `views` array.

Creating an `overview.md` with a `type: overview` frontmatter field alongside `id: C-FOO` would collide on the concept node id — `spec lint` would see two nodes with the same `id`. The rename from `README.md` to `overview.md` as the indexed node is a deferred RFC; until it lands, do not create an `overview.md` that carries the concept's `id`.

## 9. Relations block

The `relations` block in `spec.yaml` is **informational only** — a human-readable dependency map, not a machine-checked contract. Concept IDs listed in `relations.items[].target` are not verified against any registry by `spec lint`; no tooling currently checks that the referenced concept IDs exist. Do not use the `relations` block for machine enforcement. Use the `lint` block for machine-checked invariants, and use RFC `spec_delta` for tracked structural changes.

## 10. Lint block

The `lint` block in `spec.yaml` configures two automated checks run by `spec lint`:

**`data-model.type_names`** — checks that declared type or interface names exist in the configured scan root.

- `source` must be `types`; values `prisma`, `schema`, and `graphql` cause an `unsupported-source` violation and exit 1.
- `language` (optional, default `typescript`) — source language for declarations. Only `typescript` is currently supported. An unsupported language causes the check to be **skipped** with one informational message and zero `type-name-missing` violations; it is not a lint error.
- `scan_root` (optional, default `src`) — directory to scan for declarations, relative to the project root.
- Each name in `names` is checked via `grep -rE '^export (type|interface) <name>\b' <scan_root>/**/*.ts` (TypeScript). A name not found → `type-name-missing` violation.
- An empty `names` array → no check performed.

**`api.operations`** — checks that declared operation names appear as string literals in `hooks/*.mjs`.

- Each entry in `operations` is checked via `grep -rE '["']<op>["']' hooks/*.mjs`. A name not found → `operation-missing` violation.
- An empty `operations` array → no check performed.

**`data-model.entities`** — declares the *logical domain entity names* for a concept (e.g. `Task`, `User`, `Tag`). These are conceptual model names — not database table names or ORM class names specifically, unless the optional `source` sub-key says otherwise. Add the optional `source` key to specify where to validate the names:

```yaml
lint:
  data-model:
    entities: [Task, User, Tag]
    source: typescript   # optional: schema | prisma | typescript | graphql
```

When `source` is omitted, `entities` is treated as a documentation-only declaration (no automated check). When `source` is present, lint looks for the entity names in the corresponding artefact (`src/**/*.ts` for `typescript`, the Prisma schema for `prisma`, etc.).

**`constraints.ids_prefix`** — the prefix string that all requirement IDs in `constraints.md` must begin with (e.g. `TASK-R-`). This is **intentionally declared explicitly** rather than derived from the concept `id`. A concept `id` may contain hyphens, namespace separators, or version suffixes that do not map cleanly to a prefix convention; the writer states the intended prefix so lint can validate requirement headings without parsing the `id` format. If the concept `id` changes, update `ids_prefix` in the same commit.
