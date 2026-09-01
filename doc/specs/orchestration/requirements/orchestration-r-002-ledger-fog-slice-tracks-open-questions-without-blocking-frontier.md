---
id: "orchestration-r-002"
type: requirement
concept: C-ORCHESTRATION
title: "Ledger fog slice tracks open questions without blocking frontier"
criticality: must
verification: manual
status: open
design: "[[design#Slice lifecycle]]"
---

## ORCHESTRATION-R-002 — Ledger fog slice tracks open questions without blocking frontier {#orchestration-r-002}

When the orchestrator runs `ledger fog <id> --desc "…" --question "…"`, `hooks/ledger.mjs` **shall** create a slice with `kind: "fog"` and no acceptance criteria, and the `ledger frontier` command **shall** exclude all slices with `kind: "fog"` from its output.

- **Why** — Fog slices represent open questions (unknown unknowns) that are not actionable work items; including them in the frontier would mislead the orchestrator into treating unresolved questions as scheduled deliverables, distorting wave planning and completion accounting.
- **Fit criterion** — After `ledger fog q1 --desc "open question" --question "…"`, `ledger view` shows `q1` with `kind: fog` and no acceptance field; `ledger frontier` output does not list `q1`.
- **Verification**: manual —
- **Criticality**: must
