---
name: spec
description: Manage structured requirement specifications under docs/spec/ — create, build, verify, and query spec nodes and their traceability data.
disable-model-invocation: true
---

# groundwork:spec skill

Use this skill to manage structured requirement specifications in a groundwork-managed project.

## When to invoke

- User asks to "spec out", "write requirements for", or "create a spec" for a feature
- A feature plan references a `spec_ref` and the spec file is missing
- A build error mentions `docs/spec/` or `spec build` failures
- Reviewing requirement completeness or coverage

## Workflow

1. **Init** (first time): `spec init` — creates `docs/spec/README.md` with the project concept node.
2. **Add sub-concept** (for a major component): create `docs/spec/<component>/README.md` with frontmatter `id`, `type: concept`, `parent: C-<PROJECT>`.
3. **Add requirements**: `spec req new <concept-id> <kebab-name>` — creates a stub; fill in `ears`, `verify`, and `verification` fields.
4. **Build index**: `spec build` — validates the tree and writes `_generated/`. Exits 1 on:
   - Duplicate requirement ids
   - `concept` frontmatter disagreeing with directory position
   - File paths in `verify` fields (use `@verifies` annotations in test code instead)
5. **Browse**: `spec tree`, `spec search <q>`, `spec show <id>`, `spec deps <id>`

## Writing good requirements

- **EARS notation is normative** — the `ears` field is the binding statement.
- **`verify` is prose only** — never put file paths or test references here. Reference tests from source code via `@verifies <id>` annotation comments.
- **`criticality: should`** — surfaced in coverage reports, never blocks CI.
- **Manual requirements** must include a `## Manual procedure` section in the body.

## Coverage report

`spec build` writes `docs/spec/_generated/coverage.json`:
```json
{
  "total": 12,
  "by_status": { "active": 11, "superseded": 1 },
  "by_verification": { "automated": 9, "manual": 2, "hybrid": 1 },
  "by_criticality": { "must": 10, "should": 2 }
}
```

## CLI reference

See `skills/spec/SKILL.md` or run `spec --help`.
