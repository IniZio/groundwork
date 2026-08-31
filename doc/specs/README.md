---
id: C-GROUNDWORK
type: concept
title: Groundwork
summary: "Groundwork classifies tasks, delegates to specialist subagents, and reviews outcomes without the orchestrator writing code itself."
parent: null
origin_decision_ref: plugin-cleanup#D-5
---

# Groundwork

Groundwork is an orchestrator-mode AI coding framework that classifies, delegates, and reviews coding tasks through specialist subagents.

## Goals

- Enable structured, plan-driven feature development with parallel agent execution
- Provide durable multi-session feature state through ledgers, plans, and specs
- Maintain audit trails via journals, ADRs, and retrospectives
- Expose a testable spec system that captures requirements in EARS notation

## Scope

This spec is partial. It covers four load-bearing behavioral areas established in RFC-0001: artifact records (C-ARTIFACT), enforcement hooks (C-ENFORCEMENT), the orchestration model (C-ORCHESTRATION), and the verification gate (C-VERIFICATION). It does not yet specify the four CLIs (`spec`, `ledger`, `rfc`, `journal`), the hooks beyond `orchestrator-impl-guard`, `nesting-guard`, `stop-gate`, `deslop-guard`, and `agent-model-guard`, the twenty-plus skills, or the session-start injection pipeline. Coverage grows incrementally: each decision in a motive's Decision Log is the traceability link using `origin_decision_ref`.

---

## How to Read This Spec Tree (D-15 Layout)

### Directory structure

Each concept lives in its own directory under `doc/specs/`:

```
doc/specs/<concept>/
├── index.md               # concept node (ConceptIndexSchema frontmatter)
├── requirements/          # one file per requirement
│   └── <id>-<kebab>.md   # RequirementSchema frontmatter + H2 body sections
├── design/
│   ├── _MOC.md
│   ├── concepts/, flows/, components/, recipes/, reference/
├── decisions/
└── glossary.md
```

1. **Start here** — this file. Read the Goals and Scope to understand what is and is not covered.
2. **Pick a concept** — open the concept's `index.md` for the problem statement, scope, and key decisions.
3. **Read the requirements** — open the concept's `requirements/` directory; each `.md` file is one requirement with YAML frontmatter and H2 body sections (`## Statement`, `## Why`, `## Fit criterion`, `## Verification procedure`).

### Concept index.md frontmatter (ConceptIndexSchema)

```yaml
id: C-ENFORCEMENT
type: moc
title: Enforcement
summary: "One sentence summary."
status: draft
parent: null
```

### Individual requirement file frontmatter (RequirementSchema)

```yaml
id: ENFORCEMENT-R-001
title: Nesting guard blocks depth-2 spawns
concept: C-ENFORCEMENT
criticality: must
verification: automated
source: RFC-0003
```

Followed by H2 body sections:

```markdown
## Statement

**When** ... the system **shall** ...

## Why

Rationale here.

## Fit criterion

Given … then …

## Verification procedure

How to verify.
```

### Wikilink convention

`[[<concept-id>]]` resolves via filename = id. For example, `[[ENFORCEMENT-R-001]]` resolves to `requirements/enforcement-r-001-*.md` within the concept directory.

### Coverage wikilinks

Requirement files declare which ledger slices implement them via the `verifies` frontmatter field:

```yaml
verifies:
  - "[[ENFORCEMENT-S-003]]"
  - "[[ENFORCEMENT-S-004]]"
```

### Citing requirements

To cite a specific requirement, use a markdown link to its individual file:

```markdown
[ENFORCEMENT-R-001](doc/specs/enforcement/requirements/enforcement-r-001-nesting-guard.md)
```

Within the same concept, use a relative path:

```markdown
[ENFORCEMENT-R-001](requirements/enforcement-r-001-nesting-guard.md)
```

Never cite by bare id text; file links are the machine-checkable citation form.

### Legacy format (transitional)

New content goes into `requirements/<id>-<kebab>.md` files. Legacy `constraints.md` and `spec.yaml` files from prior concepts are accepted by tooling but are not the authoring target for new requirements.

---

## Concepts

| Concept | Directory | Description |
|---|---|---|
| C-ARTIFACT | `doc/specs/artifact/` | The four groundwork artifact types: run ledgers, RFC documents, session journals, and plans. |
| C-ENFORCEMENT | `doc/specs/enforcement/` | PreToolUse hooks that mechanically enforce CLAUDE.md rules as hard gates. |
| C-ORCHESTRATION | `doc/specs/orchestration/` | The orchestrator's delegation model: classify, delegate to specialists, never implement directly. |
| C-VERIFICATION | `doc/specs/verification/` | The advisor-gate completion protocol: non-trivial tasks require an explicit APPROVE verdict. |
| C-MOTIVE-DAG | `doc/specs/motive-dag/` | Typed node/edge DAG as canonical primary store for motive state, built by deterministic fold over an event-sourced journal mutation log. |

---

## Authoring and Tooling

**Authoring guide** — [`doc/specs/conventions.md`](conventions.md): the normative rules for frontmatter, requirement body shape, EARS sentence discipline, anchors, and ID scheme. Read this before writing any requirement.

**Coverage** — `spec lint` surfaces uncovered `automated` requirements via the `automated-unverified` rule: it scans test files for `// @verifies <ID>` comments (`hooks/lib/verifies-scan.mjs`). The `verifies:` frontmatter field on requirement files declares which ledger slices implement that requirement (slice linkage only — no lint rule reads it for coverage).

**Lint all spec files:**

```sh
node hooks/spec.mjs lint
```

**Lint only files touched by a specific RFC (exits 1 on violation):**

```sh
node hooks/spec.mjs lint --rfc <rfc-uid>
```

**Spec build** — `spec build` compiles the full spec tree and writes `doc/specs/_generated/{index.md,index.json,coverage.json}`. The generated `coverage.json` carries a `by_requirement` map (keyed by requirement id, with `declared` verification type, `verified` boolean, and `tests` list). `getCoverageMap()` in `hooks/lib/traceability-adapter.mjs` reads this file at runtime; `buildTraceabilityGraph` in `hooks/lib/traceability-join.mjs` merges it into the traceability graph used by serve and advisor workflows. Run after adding or editing requirements.

```sh
node hooks/spec.mjs build
```
