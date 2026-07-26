# Planner Reference: Coverage Table Protocol

This document defines the coverage verification protocol for the planner agent (Phase 5). The coverage table is mandatory before the planner may return RFC-READY.

## Purpose

The coverage table provides a machine-readable, human-auditable map from every task acceptance criterion to:
1. The **task** that covers it (confirms no criterion is left floating)
2. The **requirement ID** that traces it to a formal requirement in `docs/spec/`

A criterion with no covering task is a gap. A criterion with no requirement ID is a trace gap. Both must be resolved or explicitly flagged before RFC-READY.

## Construction

Enumerate every acceptance criterion across all tasks. For each:

| Column | Source | Rules |
|---|---|---|
| Criterion ID | `acceptance[].id` from task | e.g. `T1-AC1` |
| Criterion Summary | Abbreviated `acceptance[].text` | Max ~60 chars |
| Covered By (Task ID) | The task whose `acceptance` array contains this criterion | Must be non-empty |
| Requirement ID | `acceptance[].req_id` from the criterion | Write `(untraced)` if absent; flag as gap |

## Format

Embed the coverage table in `## 9. Appendix` of the RFC:

```markdown
## AC Coverage Map

| Criterion ID | Criterion Summary | Covered By | Requirement ID |
|---|---|---|---|
| T1-AC1 | [summary] | T1 | REQ-001 |
| T1-AC2 | [summary] | T1 | REQ-002 |
| T2-AC1 | [summary] | T2 | (untraced) ⚠ |
```

Flag `(untraced)` rows with ⚠ so reviewers can see gaps at a glance.

## Blocking Rules

**Do not return RFC-READY while any of the following is true:**

1. Any criterion's "Covered By" cell is empty — the criterion is uncovered
2. Any criterion is marked `testable: false` and its linked requirement does not declare `verification: manual` — see decompose.md § Testability constraint

When a blocking gap is found:
- Add a NEEDS-INPUT question for each uncovered criterion
- Do not partially emit RFC-READY alongside NEEDS-INPUT — choose one format per response

## Tracing to docs/spec/

Requirement IDs come from `docs/spec/` requirement files. To look up a requirement:

```bash
node hooks/spec.mjs show <req-id>
```

Or search:

```bash
node hooks/spec.mjs search <keyword>
```

If `docs/spec/` has no matching requirement for a criterion, record `(untraced)` and add a non-blocking NEEDS-INPUT question asking whether a new requirement should be created.

## Example Coverage Table

Given tasks T1 (two ACs) and T2 (one AC), the table would be:

| Criterion ID | Criterion Summary | Covered By | Requirement ID |
|---|---|---|---|
| T1-AC1 | RFC written to disk on completion | T1 | REQ-planner-001 |
| T1-AC2 | rfc_ref reported in output | T1 | REQ-planner-001 |
| T2-AC1 | NEEDS-INPUT emitted for human questions | T2 | REQ-planner-002 |

All three rows are covered, all three are traced — this table passes and unblocks RFC-READY.
