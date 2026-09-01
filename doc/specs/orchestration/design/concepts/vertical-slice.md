---
tags: [concept, orchestration, slice]
realizes: "[[../../requirements/orchestration-r-002-ledger-fog-slice-tracks-open-questions-without-blocking-frontier|R-002]]"
source: schemas/run-ledger.schema.json, hooks/ledger.mjs
---

# Vertical Slice

> **Concept note.** This explains *what* a vertical slice is and *why* groundwork uses this decomposition model. For the data shape of a slice, see [[../components/run-ledger-slice]]. To add one, see [[../recipes/add-slice-with-acceptance-criteria]].

---

## Overview

A **vertical slice** is a unit of work that cuts through the full stack of a single domain — from interface to persistence — and delivers one observable user-facing behaviour. It is deliberately *not* a layer cut (not "all the models", not "all the tests").

Groundwork tracks slices in the run ledger. Every slice has an `id`, a `kind`, a `status`, and optionally a set of `acceptance` criteria. When all slices reach `complete` or `skipped` and the advisor approves, the stop-gate releases.

---

## Why slices, not layers

| Layer cut | Vertical slice |
|-----------|---------------|
| "implement all data models" | "add a slice that accepts a ticket id and stores it" |
| Agent A owns models, Agent B owns routes — coupling at seam | One agent owns one end-to-end behaviour — seam is at behaviour boundary |
| A green slice for each layer, but the seam between them is untested | Observable AC proves the behaviour works end-to-end |
| Hard to assign acceptance criteria | Acceptance criteria are naturally expressed as observable outcomes |

---

## Slice kinds

Five kinds are defined in `schemas/run-ledger.schema.json`. Missing `kind` defaults to `impl` at runtime.

| Kind | Purpose | Acceptance criteria required? |
|------|---------|-------------------------------|
| `impl` | Implementation work | Yes |
| `plan` | Planning or decomposition | Optional |
| `design` | Design or architecture | Optional |
| `diagnose` | Root-cause investigation | Optional |
| `fog` | Open question — no resolution yet | No — must not have acceptance |

`fog` slices are excluded from `ledger frontier` output (R-002). They park an open question without blocking the implementation frontier.

---

## Fog slices

A fog slice tracks something unknown that cannot yet be scoped. Example: "What is the correct retry policy for the hook?" might not be answerable until the hook is prototyped.

```
gw ledger fog --motive <slug> Q1 --desc "open question" --question "What retry policy suits the hook?"
```

Fog slices:
- Never block the frontier
- Have no acceptance criteria
- Can be converted to `impl` once the question resolves (manually edit `kind` and add `acceptance`)

See [[../../requirements/orchestration-r-002-ledger-fog-slice-tracks-open-questions-without-blocking-frontier|R-002]] for the formal requirement.

---

## Slice dependencies and waves

Slices may declare `blocked_by: [id, ...]` — the ids of slices that must reach `complete` before this one can be claimed. The orchestrator groups slices into waves (parallelisable sets) and fans out agents per wave.

The ledger does not evaluate dependency correctness — it trusts the orchestrator's declared `blocked_by`.

---

## The pacing constraint

By default the ledger seeds with `pacing: { policy: "wave", budget: 1 }`. This means only one implementation wave may be claimed per session without an explicit `autopilot` grant. Planning, design, diagnose, and fog slices are exempt.

---

## Related notes

- [[delegation-hierarchy]] — who implements each slice
- [[stop-gate]] — what checks slices at session end
- [[../components/run-ledger-slice]] — full field spec for a slice
- [[../flows/slice-lifecycle]] — state machine a slice moves through
- [[../recipes/add-slice-with-acceptance-criteria]] — how to register a slice
