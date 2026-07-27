---
id: C-GROUNDWORK
type: concept
title: Groundwork
summary: "Groundwork classifies tasks, delegates to specialist subagents, and reviews outcomes without the orchestrator writing code itself."
parent: null
origin_rfc: R-20260726-K4M2QX
---

# Groundwork

Groundwork is an orchestrator-mode AI coding framework that classifies, delegates, and reviews coding tasks through specialist subagents.

## Goals

- Enable structured, plan-driven feature development with parallel agent execution
- Provide durable multi-session feature state through ledgers, plans, and specs
- Maintain audit trails via journals, ADRs, and retrospectives
- Expose a testable spec system that captures requirements in EARS notation

## Scope

This spec is partial. It covers four load-bearing behavioral areas established in RFC-0001: artifact records (C-ARTIFACT), enforcement hooks (C-ENFORCEMENT), the orchestration model (C-ORCHESTRATION), and the verification gate (C-VERIFICATION). It does not yet specify the four CLIs (`spec`, `ledger`, `rfc`, `journal`), the hooks beyond `orchestrator-impl-guard`, `nesting-guard`, `stop-gate`, `deslop-guard`, and `agent-model-guard`, the twenty-plus skills, or the session-start injection pipeline. Coverage grows incrementally: each RFC records the decisions behind the concepts and requirements it introduces, using `origin_rfc` as the traceability link.

---

## How to Read This Spec Tree

1. **Start here** — this file. Read the Goals and Scope to understand what is and is not covered.
2. **Pick a concept** — open the concept's `README.md` for the problem statement, scope, and key decisions.
3. **Read the requirements** — open the concept's `requirements.md` for the normative requirements as anchored H3 sections.

To cite a specific requirement, use a markdown anchor link to its id lowercased:

```markdown
[ARTIFACT-R-001](doc/specs/artifact/requirements.md#artifact-r-001)
```

Within the same file, omit the path prefix:

```markdown
[ARTIFACT-R-001](#artifact-r-001)
```

Never cite by bare id text; anchor links are the machine-checkable citation form.

---

## Concepts

| Concept | Directory | Description |
|---|---|---|
| C-ARTIFACT | `doc/specs/artifact/` | The four groundwork artifact types: run ledgers, RFC documents, session journals, and plans. |
| C-ENFORCEMENT | `doc/specs/enforcement/` | PreToolUse hooks that mechanically enforce CLAUDE.md rules as hard gates. |
| C-ORCHESTRATION | `doc/specs/orchestration/` | The orchestrator's delegation model: classify, delegate to specialists, never implement directly. |
| C-VERIFICATION | `doc/specs/verification/` | The advisor-gate completion protocol: non-trivial tasks require an explicit APPROVE verdict. |

---

## Authoring and Tooling

**Authoring guide** — [`doc/specs/conventions.md`](conventions.md): the normative rules for frontmatter, requirement body shape, EARS sentence discipline, anchors, and ID scheme. Read this before writing any requirement.

**Generated index** — [`doc/specs/_generated/index.md`](_generated/index.md): auto-built table of all concepts and requirements with status and summaries.

**Build the index:**

```sh
node hooks/spec.mjs build
```

**Lint all spec files:**

```sh
node hooks/spec.mjs lint
```

**Lint only files touched by a specific RFC (exits 1 on violation):**

```sh
node hooks/spec.mjs lint --rfc <rfc-uid>
```
