---
title: "Traceability Chain"
concept: "[[C-TRACEABILITY/index]]"
status: "draft"
date_updated: "2026-08-29"
---

# Traceability Chain

## What it is

The traceability chain is a directed graph that connects every "it's done" claim to the evidence that backs it. In groundwork, the chain runs:

```
objective → spec-req → slice → self-test → live-verify → gate
```

Each arrow is a typed edge. Each node type has a fixed source of truth.

## Node types

| Node type | Source of truth | Example |
|---|---|---|
| `objective` | Motive charter (`motive.md`) | "Users can see traceability chains" |
| `spec-req` | `doc/specs/*/constraints.md` | `TRACEABILITY-R-002` |
| `slice` | Active run ledger (`.groundwork/runs/`) | `S3` |
| `self-test` | `test_paths` on a slice, or decision-mediated via coverage.json | `test/hooks/traceability.test.ts` |
| `live-verify` | VERIFICATION journal events | A screenshot captured at build `abc` |
| `gate` | GATE journal events | Advisor APPROVE verdict |
| `artifact-evidence` | Artifact URL + build hash from a VERIFICATION event | `https://claude.ai/artifacts/xyz` |

## Edge types

| Edge kind | Connects | Proven when |
|---|---|---|
| `covers` | slice → spec-req | Slice has `covers_ac` or `decisions` matching the requirement's `origin_decision_ref` |
| `confirms` | self-test → slice | Test carries `@verifies` annotation or `test_paths` links it directly |
| `seals` | gate → slice | A GATE APPROVE journal event names the slice |
| `evidences` | artifact-evidence → live-verify | A VERIFICATION event links the artifact |

## Link classification

Every edge is classified into exactly one state:

- **proven** — gate APPROVE and live-verify pass on record
- **unproven** — slice exists but no live-verify or gate recorded
- **stale** — evidence hash does not match the current build hash (see [[../reference/requirement-fields|build_hash field]])
- **missing** — a required link is absent from the graph entirely

Classification is derived exclusively from recorded journal events (D-3). The assembler never invents a verdict.

## Two linkage mechanisms for self-test nodes

**Direct linkage** (preferred): the slice carries a `test_paths` field listing repo-relative paths to its test files. The adapter emits these as direct self-test nodes with no ambiguity.

**Decision-mediated linkage** (fallback): when `test_paths` is absent, the adapter cross-joins `slice.decisions` against `spec-requirement.origin_decision_ref` values in `coverage.json`. This path is coarse (one-to-many) and labeled accordingly in the graph.
