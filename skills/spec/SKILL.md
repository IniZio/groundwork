---
name: spec
description: Manage structured requirement specifications under doc/specs/ — create, build, verify, and query spec nodes and their traceability data.
disable-model-invocation: false
---

# groundwork:spec skill

Use this skill to manage structured requirement specifications in a groundwork-managed project.

## When to invoke

- User asks to "spec out", "write requirements for", or "create a spec" for a feature
- A feature plan references a `spec_ref` and the spec file is missing
- A build error mentions `doc/specs/` or `spec build` failures
- Reviewing requirement completeness or coverage

## Workflow

1. **Init** (first time): `spec init` — creates `doc/specs/README.md` with the project concept node.
2. **Add sub-concept** (for a major component): create `doc/specs/<component>/README.md` with frontmatter `id`, `type: concept`, `parent: C-<PROJECT>`.
3. **Add requirements**: append an anchored H3 section to the concept's existing `doc/specs/<concept>/requirements.md`. Do NOT create a `requirements/` sub-directory or one file per requirement — one `requirements.md` per concept, always.
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

**1. Normative sentence** — write it in one of the five EARS patterns with `**shall**` bolded.

| Pattern | Template |
|---|---|
| Ubiquitous | `The <system> **shall** <response>.` |
| Event-driven | `**When** <trigger>, the <system> **shall** <response>.` |
| State-driven | `**While** <precondition>, the <system> **shall** <response>.` |
| Optional-feature | `**Where** <feature included>, the <system> **shall** <response>.` |
| Unwanted-behaviour | `**If** <trigger>, **then** the <system> **shall** <response>.` |

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

```
- **Verification** <automated|manual|hybrid> · **Criticality** <must|should> · **Source** <rfc-uid>
```

- `criticality: should` is surfaced in coverage reports but never blocks CI.
- For `verification: manual`, the body must also include a `## Manual procedure` section describing the steps.

**5. See also (optional)** — comma-separated anchor links to related requirements. Never write bare id text.

```
- **See also** [ARTIFACT-R-002](#artifact-r-002)
```

### Anchors and cross-references

Every requirement carries `{#<id-lowercased>}` on its H3 heading line — this is the machine-readable anchor and stable citation target. All cross-references are markdown anchor links:

- Same file: `[ARTIFACT-R-002](#artifact-r-002)`
- Cross-concept: `[VERIFICATION-R-001](../verification/requirements.md#verification-r-001)`

Never write a bare id in prose — bare ids cannot be navigated and `spec lint` flags them.

### ID scheme

Sequential per concept, zero-padded to 3 digits: `<CONCEPT>-R-NNN`, where `<CONCEPT>` is the concept directory name uppercased. Start each concept at `001`. Never reuse a number within a concept, even for withdrawn requirements.

### Source-annotation convention (`@verifies`)

Tests reference requirements via `@verifies <id>` annotation comments in source code (e.g. `// @verifies ARTIFACT-R-001`). This convention remains valid and complementary to anchor links: the anchor is the canonical navigation target in Markdown; `@verifies` is the traceability tag in code. Use both when a test covers a specific requirement — link to the anchor in documentation, and annotate the test function with `@verifies`.

### RFC reference (optional)

Writes to `doc/specs/` do not require RFC authorization — specs are always editable. The `spec-guard.mjs` PreToolUse hook is advisory: it may emit a warning when `rfc_ref` is present but the write is not covered by the referenced RFC, but it never blocks the write. The `rfc_ref` ledger field is optional metadata that MAY be set by passing `--rfc <dir>` at ledger init; omitting it is normal and causes no warnings.

RFCs are decision records — the WHY behind a requirement. Write one when the decision is significant enough to warrant traceability (a new constraint, a breaking change, a policy shift); skip for small or obvious changes. A requirement's `origin_rfc` field traces it back to the motivating RFC, so reviewers can follow the rationale chain from requirement to decision record.

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

## Coverage report

`spec build` writes `doc/specs/_generated/coverage.json`:
```json
{
  "total": 12,
  "by_status": { "active": 11, "superseded": 1 },
  "by_verification": { "automated": 9, "manual": 2, "hybrid": 1 },
  "by_criticality": { "must": 10, "should": 2 }
}
```

## CLI reference

Run `spec --help` for full command documentation.
