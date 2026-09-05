---
name: spec
description: Manage requirement specifications under doc/specs/ — create, verify, query, and build concept nodes and traceability data. Triggers on: spec out, write requirements, add requirements, spec upkeep, spec is stale, build spec, spec build.
disable-model-invocation: true
---

# groundwork:spec

## When to invoke

- "spec out", "write requirements for", or "create a spec" for a feature
- A feature plan references a `spec_ref` and the spec file is missing
- A lint error mentions `doc/specs/` or missing requirement fields
- Reviewing requirement completeness or coverage

## Where specs live

Each concept lives at `doc/specs/<concept>/` with an `index.md` (frontmatter: `id`, `type`, `title`, `summary`, `parent`, `status`) and a `requirements/` subdirectory. Requirements are individual files named `<CONCEPT>-R-NNN-<kebab>.md` — zero-padded sequential integers starting at `001`. Never reuse a number within a concept, even for withdrawn requirements.

For all commands (init, tree, search, show, deps, lint, build): `bin/spec --help`.

## Requirement anatomy

**Frontmatter is metadata; body is the requirement.** Parsers return `{data, content}` as separate objects — prose in YAML fields is stripped, cannot be linked, and cannot be lint-checked. No normative content belongs in frontmatter.

**H2 heading with anchor:** `## <ID> — <title> {#<id-lowercased>}`. The `{#…}` anchor is the stable citation target for all cross-references.

**Normative sentence** (EARS pattern): write with `**shall**` bolded. Prohibitions use `**shall not**`. The `pattern` frontmatter field records which pattern applies; there is no `ears:` frontmatter field — using one is an error.

**Why (required):** the engineering consequence if this requirement is absent — what breaks, not a restatement of the rule. `spec lint` rejects filler rationales ("this ensures correctness", "this maintains consistency").

**Fit criterion (required):** a concrete, observable pass/fail condition. There is no `verify:` frontmatter field — using one is an error.

**Annotation (required):**
```
- **Verification**: automated|manual|hybrid — <method>
- **Criticality**: must|should
```
Legacy single-line form also accepted: `**Verification** … · **Criticality** … · **Source** …`

**See also (optional):** anchor links only — never bare IDs. `spec lint` flags bare IDs.

For the EARS pattern table and a complete worked example: [`reference/requirement-anatomy.md`](reference/requirement-anatomy.md).

## Traceability

**`@verifies` annotation:** add `// @verifies <ID>` to test functions that cover a requirement. The `automated-unverified` lint rule surfaces `automated` requirements with no matching annotation.

**Decision reference:** when a requirement stems from a decision, set `origin_decision_ref: <motive-slug>#D-<n>` in frontmatter so reviewers can follow the rationale chain from requirement back to the motivating decision.

**Ledger:** `gw ledger add --covers-ac "AC1,AC2"` records which acceptance criteria a slice addresses. The `verifies:` frontmatter field on requirement files declares which ledger slices implement that requirement (slice linkage only — no lint rule reads it for coverage).

Run `spec build` after adding or editing requirements to refresh `doc/specs/_generated/`. For build output fields: `spec build --help`.

## Concept layout

`index.md` frontmatter carries `parent: C-<PARENT>` to establish hierarchy. `spec init` creates a single root at `doc/specs/index.md`; create each additional system or sub-concept's `index.md` manually with the appropriate `id` and `parent` fields.

The `summary` field must be ≤25 words. The `summary-length` lint rule rejects summaries exceeding 25 words; exactly 25 passes.

## Named failure modes

**Prose-in-frontmatter:** normative content placed in YAML fields is silently stripped by parsers — no cross-reference or lint check can reach it.

**Bare-ID citation:** bare requirement IDs in prose cannot be navigated. Use anchor links; `spec lint` flags bare IDs.

**TypeScript language boundary:** the `lint.data-model.type_names` rule runs only for TypeScript projects (Decision D-9, motive `groundwork-development`). A skip message on non-TypeScript runs is expected — no configuration is needed to suppress it. To add support for other languages, open a new motive referencing D-9 as prior context.
