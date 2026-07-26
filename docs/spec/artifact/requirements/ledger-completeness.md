---
id: ARTIFACT-R-u6zs
concept: C-ARTIFACT
ears: "When a vertical slice is marked complete via the ledger CLI, the run ledger shall record the slice id, completion timestamp, and the session id before the Stop hook permits the session to end."
pattern: event
verify: "Inspect a run ledger file after marking slices complete and confirm that each completed entry carries an id, a timestamp, and the session_id from the session that completed it. Confirm that the Stop hook blocks session end when any slice remains incomplete."
verification: hybrid
criticality: must
origin_rfc: R-20260726-K4M2QX
superseded_by: null
status: active
---

The run ledger at `.groundwork/runs/<session_id>.json` is the canonical source of truth for wave progress. The Stop hook reads it to determine whether to allow or block a session-end event.

## Manual procedure

Initiate a run with two slices. Complete one slice via `ledger.mjs complete <id>`. Attempt to end the session and verify the Stop hook blocks it citing the incomplete slice. Complete the second slice and obtain an advisor APPROVE via `ledger.mjs gate advisor APPROVE`, then verify the session is permitted to end.
