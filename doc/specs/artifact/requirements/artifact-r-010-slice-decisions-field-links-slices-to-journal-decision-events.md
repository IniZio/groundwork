---
id: "artifact-r-010"
type: requirement
concept: C-ARTIFACT
criticality: may
verification: unverified
status: open
design: "[[design/components/run-ledger-slice]]"
---

## ARTIFACT-R-010 — Slice decisions field links slices to journal decision events {#artifact-r-010}

A run-ledger `Slice` may carry a `decisions` field containing a single decision id (string) or an ordered list of decision ids (string[]). When the compile step produces a decision log, it **shall** enumerate every decision id cited by any slice and, for each id, list the ids of all slices that cite it.

- **Why** — The `decisions` field makes the provenance of a decision traceable in both directions: given a slice, you can find the decisions it produced; given a decision id, you can find the slices that originated or are governed by it. Without this linkage, decision events in the journal are disconnected from the unit of work that generated them, making retrospectives and coverage audits manual.
- **Fit criterion** — `ledger add s1 --decisions D-1` records `decisions: ["D-1"]` on slice `s1`; `ledger add s2 --decisions D-1,D-2` records `decisions: ["D-1","D-2"]` on slice `s2`; the compile step output for a run containing both slices lists `D-1 → [s1, s2]` and `D-2 → [s2]`; a ledger with no `decisions` fields on any slice continues to function without error (back-compat).
- **Verification**: unverified — Automated — the ledger schema accepts but does not require the `decisions` field; the compile step is tested with single, multi-id, and absent `decisions` values.
- **Criticality**: may
