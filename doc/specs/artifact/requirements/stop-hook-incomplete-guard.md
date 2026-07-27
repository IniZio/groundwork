---
id: ARTIFACT-R-p3qx
type: requirement
concept: C-ARTIFACT
summary: "The Stop hook shall block session end when the active run ledger contains any slice not marked complete."
ears: "If the Stop hook fires and the active run ledger contains any slice not marked complete, then the Stop hook shall block session end."
pattern: unwanted
verify: "Run the Stop hook against a run ledger with one incomplete slice and confirm it emits a block citing the incomplete slice id. Complete the slice via the ledger CLI and re-run the Stop hook; confirm it no longer blocks."
verification: automated
criticality: must
origin_rfc: R-20260726-K4M2QX
status: active
---

The Stop hook reads the active run ledger from `.groundwork/runs/<session_id>.json`. A slice is considered complete when its `status` field equals `"complete"`. Slices in `"pending"` or `"in_progress"` states both trigger a block. This guard is independent of the advisor gate guard (VERIFICATION-R-oxuu): both must be satisfied before the session is permitted to end.
