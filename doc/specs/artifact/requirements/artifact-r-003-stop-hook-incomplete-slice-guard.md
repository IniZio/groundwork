---
id: "artifact-r-003"
type: requirement
concept: C-ARTIFACT
criticality: must
verification: unverified
status: open
design: "[[design/flows/slice-lifecycle]]"
---

## ARTIFACT-R-003 — Stop hook incomplete-slice guard {#artifact-r-003}

If the Stop hook fires and the active run ledger contains any slice not marked complete, then the Stop hook **shall** block session end and emit a message citing the id of each incomplete slice.

- **Why** — The Stop hook is the final check preventing incomplete work from being left behind; if a slice is in `"pending"` or `"in_progress"` state, the session must not terminate, because the run ledger is the orchestrator's ground truth for what work remains. This guard is independent of and in addition to the advisor gate guard; both must be satisfied.
- **Fit criterion** — Run the Stop hook against a run ledger with one incomplete slice and confirm it emits a block citing the incomplete slice id. Complete the slice via `ledger complete <id>` and re-run the Stop hook; confirm it no longer blocks.
- **Verification**: unverified — Automated — the Stop hook enforces this mechanically on every session-end attempt.
- **Criticality**: must

See also: [ARTIFACT-R-001](artifact-r-001-ledger-records-slice-completion.md)
