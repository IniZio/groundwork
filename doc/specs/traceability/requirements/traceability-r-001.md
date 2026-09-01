---
id: "traceability-r-001"
type: requirement
concept: C-TRACEABILITY
title: "Traceability chain renders on real motive data"
criticality: must
verification: manual
status: open
---

## TRACEABILITY-R-001 — Traceability chain renders on real motive data {#traceability-r-001}

When the traceability regeneration command is run against a real dogfooded motive (e.g. `groundwork-development`), it **shall** produce both read surfaces — an ambient auto-regenerated file and an interactive live view — each displaying the full chain: objective→spec-req→slice→self-test→live-verify→gate.

- **Why** — Dogfooding on real motive data (not synthetic fixtures) is the only way to confirm that the join engine handles the actual corpus of journal events, ledger slices, and spec requirements without gaps caused by edge cases in real data. Synthetic tests can miss corpus-specific quirks such as partial coverage, missing decision refs, or empty coverage.json entries.
- **Fit criterion** — Running the regeneration command against a real motive with at least one complete slice, one gate event, and at least one spec requirement produces two output artifacts (the ambient file and the served HTML) without error; both display at least one node of each type in the chain (objective, spec-req, slice, gate).
- **Verification**: manual — Manual inspection of a live regeneration run:
  1. Choose a real dogfooded motive slug (e.g. `groundwork-development`) with at least one complete slice, one GATE APPROVE event, and at least one spec requirement.
  2. Run the traceability regeneration command against that motive.
  3. Confirm the command exits without error.
  4. Open the ambient auto-regenerated file; confirm it contains nodes for objective, spec-req, slice, and gate.
  5. Open the interactive live view; confirm the same node types are displayed.
  6. Record inspector's initials and date as evidence.
- **Criticality**: must
