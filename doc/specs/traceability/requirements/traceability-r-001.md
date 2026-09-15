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

When the traceability build logic is run against a real dogfooded motive (e.g. `groundwork-development`), it **shall** traverse the full chain — objective→spec-req→slice→self-test→live-verify→gate — without error on the real corpus. Note: the ambient auto-regenerated file was removed by D-24; the interactive live view (`hooks/lib/traceability-serve.mjs`) has no production caller (no `gw` command or hook starts it). Whether the pipeline is wired to a production entrypoint is deferred to a separate motive (TBR-3).

- **Why** — Dogfooding on real motive data (not synthetic fixtures) is the only way to confirm that the join engine handles the actual corpus of journal events, ledger slices, and spec requirements without gaps caused by edge cases in real data. Synthetic tests can miss corpus-specific quirks such as partial coverage, missing decision refs, or empty coverage.json entries.
- **Fit criterion** — Running the build logic against a real motive with at least one complete slice, one gate event, and at least one spec requirement completes without error; the resulting chain contains at least one node of each type (objective, spec-req, slice, gate).
- **Verification**: manual — Manual inspection of a live build run:
  1. Choose a real dogfooded motive slug (e.g. `groundwork-development`) with at least one complete slice, one GATE APPROVE event, and at least one spec requirement.
  2. Run the traceability build logic against that motive.
  3. Confirm the command exits without error.
  4. Confirm the chain output contains nodes for objective, spec-req, slice, and gate.
  5. Record inspector's initials and date as evidence.
- **Criticality**: must
