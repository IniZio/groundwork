---
name: spec
description: Manage structured requirement specifications under doc/specs/ — create, build, verify, and query spec nodes and their traceability data.
disable-model-invocation: true
---

# groundwork:spec skill

Use this skill to manage structured requirement specifications in a groundwork-managed project.

## When to invoke

- User asks to "spec out", "write requirements for", or "create a spec" for a feature
- A feature plan references a `spec_ref` and the spec file is missing
- A build error mentions `doc/specs/` or `spec build` failures
- Reviewing requirement completeness or coverage

## View types

Every concept directory may declare views in `spec.yaml`. Seven core types are built in:

| Type | What it describes | Nearest neighbour |
|---|---|---|
| `overview` | Concept narrative and rationale | — |
| `data-model` | Entities, fields, relations | — |
| `flows` | Internal collaboration sequences (what happens inside) | `scenarios` — choose `flows` for component interaction diagrams |
| `api` | Declared operations / interface | — |
| `constraints` | Testable normative invariants (each entry becomes a requirement node with Why / Fit criterion / Criticality) | `cases` — choose `constraints` only when every entry deserves a full requirement node |
| `scenarios` | External input alphabet: situations, stimuli, or test inputs the system must handle | `flows` — choose `scenarios` for "what can happen to the system", `flows` for "what the system does internally when it happens" |
| `cases` | A register of instances (test cases, failure cases, edge cases) that do not individually warrant full requirement nodes | `constraints` — choose `cases` when entries lack or should not carry their own Why / Fit criterion / Criticality |

If none of the core types fit, declare a project-local extension in `spec.yaml`:

```yaml
view_types:
  - name: fixtures
    concern: "Which canned datasets exist and what each one is for."
    contents: "Table of named fixture datasets with provenance and intended use."
```

A project-declared name must not shadow a core type. An undeclared name in `views[].type` is a `spec-lint unknown-view-type` violation with an error that lists all legal values and shows the escape-hatch snippet pre-filled with the rejected name.

## Workflow

1. **Init** (first time): `spec init` — creates `doc/specs/README.md` with the project concept node.
2. **Add sub-concept** (for a major component): create `doc/specs/<component>/README.md` with frontmatter `id`, `type: concept`, `parent: C-<PROJECT>`.
3. **Add requirements**: append an anchored H3 section to the concept's existing `doc/specs/<concept>/constraints.md`. Do NOT create a `requirements/` sub-directory or one file per requirement — one `constraints.md` per concept, always. (`requirements.md` is accepted by tooling as a deprecated **filename** alias — the view type in `spec.yaml` must still be `type: constraints`, not `type: requirements`. Writing `type: requirements` triggers an `unknown-view-type` lint violation. New content uses `constraints.md`.)
4. **Build index**: `spec build` — validates the tree and writes `_generated/`. Exits 1 on:
   - Duplicate requirement ids or missing `{#anchor}` attributes
   - `concept` frontmatter disagreeing with directory position
   - Requirements missing `**Why**` or `**Fit criterion**` bullets
   - `ears:` or `verify:` frontmatter fields (both are abolished; see §Writing requirements below)
5. **Browse**: `spec tree`, `spec search <q>`, `spec show <id>`, `spec deps <id>`

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
- Cross-concept: `[VERIFICATION-R-001](../verification/constraints.md#verification-r-001)`

Never write a bare id in prose — bare ids cannot be navigated and `spec lint` flags them.

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

### `summary` — ≤25 words, byte-identical in two places

Every concept node carries a `summary` field in two files:

1. `README.md` frontmatter (the indexed entry point)
2. `spec.yaml` (the machine manifest)

**Both rules are enforced as lint violations:**

- `summary-length` — `spec lint` rejects a summary exceeding 25 words in either file. Exactly 25 passes; 26 fails.
- `manifest-mismatch` — `spec lint` rejects any `id`, `title`, or `summary` value that differs between `spec.yaml` and `README.md`. The error message names both file paths and both values so you can see which copy to fix:

  ```
  LINT_DRIFT <id>: manifest-mismatch: concept "<id>" summary differs —
    /path/to/spec.yaml: "value in spec.yaml" vs
    /path/to/README.md: "value in README.md"
  ```

**Practical consequence:** when you edit one file, update the other in the same commit. A `spec lint` run in CI catches any drift before it merges.

_(Long-term, deriving one from the other would eliminate the duplication. That redesign is deferred; the lint check is the current guard.)_

## Concept layout — flat and nested

### Flat layout (single-system repo)

```
doc/specs/
  README.md          ← root concept node (created by `spec init`)
  <concept-a>/
    README.md
    spec.yaml
    constraints.md
  <concept-b>/
    README.md
    spec.yaml
```

`spec init` creates the root at `doc/specs/README.md` and assumes this flat model.

### Nested / multi-system layout

`findNearestConceptId` walks up to 12 directory levels to find a parent concept's `README.md`. Arbitrary nesting is supported by the indexer — there is no enforced limit beyond 12 levels, and nothing requires `parent` to equal the directory name.

A repo with more than one system can root each system under `doc/specs/<system>/`:

```
doc/specs/
  frontend/
    README.md   ← system concept (id: C-FRONTEND)
    spec.yaml
    auth/
      README.md ← sub-concept (id: C-FRONTEND-AUTH, parent: C-FRONTEND)
      spec.yaml
      constraints.md
  backend/
    README.md   ← system concept (id: C-BACKEND)
    spec.yaml
```

`spec build` indexes all three concept nodes correctly. Requirements in `auth/constraints.md` associate with `C-FRONTEND-AUTH`.

**`spec init` assumption:** the command creates only `doc/specs/README.md` as a single root. For a multi-system repo, create each system's `README.md` manually with the appropriate `id` and `parent` fields.

## Coverage report

`spec build` writes `doc/specs/_generated/coverage.json`:
```json
{
  "total": 12,
  "by_source": { "R-20260726-K4M2QX": 12 },
  "by_concept": { "C-ARTIFACT": 3, "C-ENFORCEMENT": 4, "C-ORCHESTRATION": 5 },
  "by_verification": { "automated": 9, "manual": 2, "hybrid": 1 },
  "by_criticality": { "must": 10, "should": 2 }
}
```

`by_concept` maps concept id → requirement count. An area with 0 or 1 requirements is visible at a glance as potentially under-specified.

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

Inside Claude Code hook execution `${CLAUDE_PLUGIN_ROOT}/hooks/spec.mjs`
also works — `CLAUDE_PLUGIN_ROOT` is set by the hook runner to this plugin's
root directory during hook execution.

Run `spec --help` for full command documentation.
