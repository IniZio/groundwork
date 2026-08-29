---
name: spec
description: "Manage structured requirement specifications under doc/specs/ — create, verify, and query spec concept nodes and their traceability data. Triggers on: spec out, write requirements, add requirements, spec upkeep, spec is stale."
disable-model-invocation: false
---

# groundwork:spec skill

Use this skill to manage structured requirement specifications in a groundwork-managed project.

## When to invoke

- User asks to "spec out", "write requirements for", or "create a spec" for a feature
- A feature plan references a `spec_ref` and the spec file is missing
- A lint error mentions `doc/specs/` or missing requirement fields
- Reviewing requirement completeness or coverage

## Concept directory structure

Each concept lives in its own subdirectory under `doc/specs/`:

```
doc/specs/<concept>/
  index.md            — concept node (frontmatter: id, type, title, summary, parent, status)
  requirements/       — one file per requirement (<id>-<kebab>.md)
  design/             — design documents (optional)
  decisions/          — decision documents (optional)
  glossary.md         — term definitions (optional)
```

`index.md` is the indexed entry point. It carries `id`, `type: concept`, `title`, `summary`, and `parent` in frontmatter. The `parent` field references the parent concept id (e.g. `C-ENFORCEMENT` is a child of `C-GROUNDWORK`).

## Workflow

1. **Init** (first time): `spec init` — creates `doc/specs/index.md` with the project concept node.
2. **Add sub-concept** (for a major component): create `doc/specs/<component>/index.md` with frontmatter `id`, `type: concept`, `parent: C-<PROJECT>`.
3. **Add a requirement**: create `requirements/<id>-<kebab>.md` with the required frontmatter and body structure (see §Writing requirements below).
4. **Browse**: `spec tree`, `spec search <q>`, `spec show <id>`, `spec deps <id>`

## Writing requirements

### Principle: frontmatter is metadata, body is the requirement

Frontmatter fields are typed data consumed by the `spec` CLI, `spec-lint`, and `spec-guard`. Parsers return `{data, content}` as separate objects, so prose placed in YAML fields is stripped from the rendered page and cannot be linked, cross-referenced, or syntax-checked. No normative content belongs in frontmatter.

The H3 heading and body prose together constitute the complete requirement.

### Required body structure (in order)

**1. Normative sentence** — write it in one of the five EARS patterns with `**shall**` bolded. Prohibitions use `**shall not**` (negation inside the bold, e.g. `The system **shall not** apply …`) or `**shall** not` (negation outside). Both forms satisfy the lint check; the bare word "shall" without bolding does not.

| Pattern | Template |
|---|---|
| Ubiquitous | `The <system> **shall** <response>.` |
| Event-driven | `**When** <trigger>, the <system> **shall** <response>.` |
| State-driven | `**While** <precondition>, the <system> **shall** <response>.` |
| Optional-feature | `**Where** <feature included>, the <system> **shall** <response>.` |
| Unwanted-behaviour | `**If** <trigger>, **then** the <system> **shall** <response>.` |
| Prohibition | `The <system> **shall not** <proscribed-action>.` |

EARS is a sentence discipline, not a field. The `pattern` frontmatter field records which pattern applies as typed metadata for tooling; the sentence in the body is the normative statement. There is no `ears:` frontmatter field — using one is an error.

**2. Why (REQUIRED)** — state the engineering consequence of the requirement being violated: why this rule exists and what breaks if it does not hold.

```
- **Why** — <one or two sentences on what breaks if this requirement is absent>
```

A requirement without a **Why** is rejected by `spec lint`. The rationale must state a real consequence — not a restatement of the requirement in other words. The following are filler and are prohibited:

- "this ensures correctness"
- "this is important for reliability"
- "this maintains consistency"
- any phrase that restates the normative sentence

If the rationale genuinely cannot be determined, write `TODO: rationale unknown — flag for review` and do not invent one.

**3. Fit criterion (REQUIRED)** — the Volere fit criterion: a concrete, observable pass/fail condition.

```
- **Fit criterion** — <specific observable outcome>
```

Two engineers reading it independently must run the same test and agree on the result. "The system works correctly" is not a fit criterion. "After `ledger complete s3`, the `s3` entry carries non-null `id`, ISO-8601 `completed_at`, and `session_id` matching the completing session" is. There is no `verify:` frontmatter field — using one is an error.

**4. Annotation line (REQUIRED)**

Two forms are accepted. The **two-bullet form is preferred** for new requirements because it allows a prose description of the verification method:

```
- **Verification**: <automated|manual|hybrid> — <brief prose description of the test method>
- **Criticality**: <must|should>
```

The **single-line form** is the legacy format, still valid when brevity is preferred or when citing a source decision reference:

```
- **Verification** <automated|manual|hybrid> · **Criticality** <must|should> · **Source** <motive-slug>#D-<n>
```

`Source` is **optional** in both forms. Include it when the requirement originates from a specific decision (e.g. `Source plugin-cleanup#D-3`); omit it when the origin is not traced to a decision.

- `criticality: should` is surfaced in coverage reports but never blocks CI.
- For `verification: manual`, the body should also include a `### Manual procedure` H3 sub-section directly after the annotation bullets, describing the exact steps to verify compliance. A manual verification without written steps is not reproducible by a second engineer. (Not a lint violation, but strongly recommended.)

**5. See also (optional)** — comma-separated anchor links to related requirements. Never write bare id text.

```
- **See also** [ARTIFACT-R-002](#artifact-r-002)
```

### Anchors and cross-references

Every requirement carries `{#<id-lowercased>}` on its H3 heading line — this is the machine-readable anchor and stable citation target. All cross-references are markdown anchor links:

- Same file: `[ARTIFACT-R-002](#artifact-r-002)`
- Cross-concept: `[VERIFICATION-R-001](../verification/requirements/verification-r-001.md)`

Cross-concept links point to individual requirement files, not anchors in a monolithic file. Never write a bare id in prose — bare ids cannot be navigated and `spec lint` flags them.

### ID scheme

Sequential per concept, zero-padded to 3 digits: `<CONCEPT>-R-NNN`, where `<CONCEPT>` is the concept directory name uppercased. Start each concept at `001`. Never reuse a number within a concept, even for withdrawn requirements.

### Source-annotation convention (`@verifies`)

Tests reference requirements via `@verifies <id>` annotation comments in source code (e.g. `// @verifies ARTIFACT-R-001`). This convention remains valid and complementary to anchor links: the anchor is the canonical navigation target in Markdown; `@verifies` is the traceability tag in code. Use both when a test covers a specific requirement — link to the anchor in documentation, and annotate the test function with `@verifies`.

### Decision reference (optional)

Decisions are the WHY behind a requirement. When a requirement stems from a significant choice (a new constraint, a breaking change, a policy shift), record it as a `DECISION` event in the relevant motive charter and set the requirement's `origin_decision_ref` field to `<motive-slug>#D-<n>` — reviewers can then follow the rationale chain from requirement back to the motivating decision. Skip for small or obvious changes where no explicit decision record is needed.

### Advisor validation after spec-backed implementation

After implementing a change backed by spec requirements, invoke `advisor()` (the native tool) or `groundwork:advisor` as a fallback to validate the work is genuinely complete — not just that tests pass, but that the right things were tested in the right environment (CI watched to completion, API changes exercised against real infrastructure, UI pixel-checked against spec).

### Complete example

The following is a copy-pasteable example taken from `conventions.md` (the normative source). Use this exact structure.

```markdown
### ARTIFACT-R-001 — Ledger records slice completion {#artifact-r-001}

**When** a vertical slice is marked complete via the ledger CLI, `hooks/ledger.mjs`
**shall** persist the slice id, completion timestamp, and session id to
`.groundwork/runs/<session_id>.json`.

- **Why** — the Stop hook reads the ledger to gate session end; an entry without a
  session id cannot be attributed to the run that produced it, so a concurrent
  session's completions would incorrectly satisfy this session's gate, allowing
  premature termination.
- **Fit criterion** — after `ledger complete s3`, the `s3` entry carries non-null
  `id`, ISO-8601 `completed_at`, and `session_id` matching the completing session.
- **Verification** automated · **Criticality** must · **Source** R-20260726-K4M2QX
- **See also** [ARTIFACT-R-002](#artifact-r-002)
```

## Frontmatter rules enforced by tooling

### `summary` — ≤25 words

Every concept node carries a `summary` field in `index.md` frontmatter. The `summary-length` lint rule rejects summaries exceeding 25 words. Exactly 25 passes; 26 fails.

## Concept layout — flat and nested

### Flat layout (single-system repo)

```
doc/specs/
  index.md           ← root concept node (created by `spec init`)
  <concept-a>/
    index.md
    requirements/
      <concept-a>-r-001-<kebab>.md
  <concept-b>/
    index.md
    requirements/
```

`spec init` creates the root at `doc/specs/index.md` and assumes this flat model.

### Nested / multi-system layout

`findNearestConceptId` walks up to 12 directory levels to find a parent concept's `index.md`. Arbitrary nesting is supported by the indexer — there is no enforced limit beyond 12 levels, and nothing requires `parent` to equal the directory name.

A repo with more than one system can root each system under `doc/specs/<system>/`:

```
doc/specs/
  frontend/
    index.md   ← system concept (id: C-FRONTEND)
    auth/
      index.md ← sub-concept (id: C-FRONTEND-AUTH, parent: C-FRONTEND)
      requirements/
        frontend-auth-r-001-<kebab>.md
  backend/
    index.md   ← system concept (id: C-BACKEND)
    requirements/
```

`spec lint` validates all concept nodes correctly. Requirements in `auth/requirements/` associate with `C-FRONTEND-AUTH`.

**`spec init` assumption:** the command creates only `doc/specs/index.md` as a single root. For a multi-system repo, create each system's `index.md` manually with the appropriate `id` and `parent` fields.

## Coverage

Coverage is tracked via `// @verifies <ID>` comments in test files, scanned by `hooks/lib/verifies-scan.mjs`. `spec lint` surfaces `automated` requirements with no test carrying `// @verifies <ID>` (the `automated-unverified` rule). Slices in the run ledger use `--covers-ac` to record which acceptance criteria they address. The `verifies:` frontmatter field on requirement files declares which ledger slices implement that requirement (slice linkage only — no lint rule reads it for coverage).

## CLI reference

### Invoking `spec` — version-independent

The repo ships `bin/spec`, a tiny wrapper that resolves its own location via
`readlink` and calls `hooks/spec.mjs` relative to that. Symlink it onto your
PATH once and it survives plugin upgrades without re-pointing:

```bash
# One-time setup (adjust source path to your groundwork install):
ln -s /path/to/groundwork/bin/spec ~/.local/bin/spec

# Or invoke directly without a symlink:
/path/to/groundwork/bin/spec <command>
```

Inside Claude Code hook execution `bin/spec` (from repo root) also works.

Run `spec --help` for full command documentation.

## Lint behavior — language boundaries

### `type_names` data-model check (TypeScript only)

The `lint.data-model.type_names` rule validates that entity type names in `data-model` views follow the project's naming conventions. This check is implemented in `hooks/spec-lint.mjs` and runs **only for TypeScript projects**. When the detected language is not TypeScript, the check is skipped cleanly — a short informational message is emitted and the lint run continues without an error or warning. No configuration is needed to suppress the skip message; it is normal output confirming the boundary was reached.

Decision D-9 (motive `groundwork-development`) records that support for Kotlin and other languages is intentionally deferred. If you need `type_names` enforcement for a non-TypeScript codebase, open a new motive and reference D-9 as prior context.
