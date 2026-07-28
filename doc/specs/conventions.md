# Spec System Conventions

## 1. Spec = viewpoints over a system

A spec describes a system through multiple complementary representations called views. Requirements and constraints are one view among peers; a data model, a flow diagram, and an API surface are equally first-class. No single view is authoritative in isolation — understanding emerges from reading them together. This reframe means the unit of organization is a **concept directory**, not a requirements document, and the machine-readable anchor for that directory is `spec.yaml`.

## 2. Concept directory structure

Each concept lives in its own subdirectory under `doc/specs/`:

```
doc/specs/<concept>/
  spec.yaml           — machine manifest (view registry, lint config, status)
  README.md           — concept node (indexed entry point; carries id, title, summary)
  data-model.md       — optional view: entities, fields, relations
  flows.md            — optional view: key behavioral sequences
  api.md              — optional view: declared operations / interface
  constraints.md      — optional view: testable normative invariants (self-contained: Why, Fit criterion, Criticality inline)
```

`README.md` is the indexed concept node during the current transition period — it carries the `id`, `type: concept`, `title`, `summary`, `parent`, and `origin_rfc` fields validated by `spec-concept.schema.json`. Renaming it to `overview.md` is a deferred follow-up RFC; until that RFC lands, `README.md` remains the single indexed entry point per concept.

## 3. View types

All accepted view `type` values are listed here. `spec-lint.mjs` validates that every `type` declared in `spec.yaml` is one of these values.

| Type | File convention | Diagram format | What it describes |
|---|---|---|---|
| `overview` | `README.md` | prose | Concept narrative and rationale |
| `data-model` | `data-model.md` | Mermaid `erDiagram` | Entities, fields, relations |
| `flows` | `flows.md` | Mermaid `sequenceDiagram` | Key behavioral sequences |
| `api` | `api.md` | prose table | Declared operations / interface |
| `constraints` | `constraints.md` | prose (`SHALL` statements) | Testable normative invariants |

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
- **The `constraints.md` view type** carries normative `**shall**` statements with Why, Fit criterion, Criticality, and Verification method inline. A constraint entry that lacks these fields is incomplete regardless of whether an RFC exists that documents them.
- **The `requirements.md` format is superseded.** New spec content uses the `constraints.md` view format. The old `requirements.md` files in concept directories have been migrated into their corresponding `constraints.md` view and deleted.

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

## 6. Status lifecycle — spec concepts

The following table is the **single canonical source** for spec concept status values and their meanings. When `status_policy` is present inline in a `spec.yaml`, `spec-lint` asserts that every entry matches this table.

| Status | Meaning |
|---|---|
| `draft` | Initial description; may change freely |
| `review` | Stable enough for agent use; awaiting validation against implementation |
| `accepted` | Validated against implementation; breaking changes require RFC |
| `deprecated` | No longer in use; see replacement |

## 7. Status lifecycle — RFCs

The following table is the **single canonical source** for RFC status values and their meanings. When `status_policy` is present inline in an `rfc.yaml`, `spec-lint` asserts that every entry matches this table.

| Status | Meaning |
|---|---|
| `draft` | Initial draft; not yet ready for review |
| `review` | Ready for review; `body_digest` stamped at this transition |
| `accepted` | Decision recorded; `spec_delta` concepts updated |
| `implementing` | Implementation in progress |
| `implemented` | Implementation complete |
| `rejected` | Decision recorded; no spec changes |
| `superseded` | A newer RFC supersedes this one |
| `abandoned` | Withdrawn without formal decision |

## 8. Node ownership rule (transitional)

`README.md` is the **indexed concept node** — it carries `id`, `type: concept`, `title`, `summary`, `parent`, and `origin_rfc`, validated by `spec-concept.schema.json`. View files are **not** indexed nodes; they are reached via the `spec.yaml` `views` array.

Creating an `overview.md` with a `type: overview` frontmatter field alongside `id: C-FOO` would collide on the concept node id — `spec lint` would see two nodes with the same `id`. The rename from `README.md` to `overview.md` as the indexed node is a deferred RFC; until it lands, do not create an `overview.md` that carries the concept's `id`.

## 9. Relations block

The `relations` block in `spec.yaml` is **informational only**. Concept IDs listed in `relations.items[].target` are not verified against any registry by `spec lint`. Do not use the `relations` block for machine enforcement. Use the `lint` block for machine-checked invariants, and use RFC `spec_delta` for tracked structural changes.

## 10. Lint block

The `lint` block in `spec.yaml` configures two automated checks run by `spec lint`:

**`data-model.type_names`** — checks that declared TypeScript type or interface names exist in `src/`.

- `source` must be `types`; values `prisma`, `schema`, and `graphql` cause an `unsupported-source` violation and exit 1.
- Each name in `names` is checked via `grep -rE '^export (type|interface) <name>\b' src/**/*.ts`. A name not found → `type-name-missing` violation.
- An empty `names` array → no check performed.

**`api.operations`** — checks that declared operation names appear as string literals in `hooks/*.mjs`.

- Each entry in `operations` is checked via `grep -rE '["']<op>["']' hooks/*.mjs`. A name not found → `operation-missing` violation.
- An empty `operations` array → no check performed.
