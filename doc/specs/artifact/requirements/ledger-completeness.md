---
id: ARTIFACT-R-u6zs
type: requirement
concept: C-ARTIFACT
summary: "hooks/ledger.mjs persists slice id, completion timestamp, and session id when a slice is marked complete."
ears: "When a vertical slice is marked complete via the ledger CLI, hooks/ledger.mjs shall persist the slice id, completion timestamp, and session id to the run ledger."
pattern: event
verify: "Inspect a run ledger file after marking a slice complete via the ledger CLI and confirm that the completed entry carries an id, a completion timestamp, and the session_id from the session that completed it."
verification: automated
criticality: must
origin_rfc: R-20260726-K4M2QX
status: active
---

The run ledger at `.groundwork/runs/<session_id>.json` is the canonical source of truth for wave progress. The Stop hook reads it to determine whether to allow or block a session-end event. See ARTIFACT-R-p3qx for the Stop hook's incomplete-slice guard.
