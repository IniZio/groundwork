---
id: VERIFICATION-R-oxuu
concept: C-VERIFICATION
ears: "When a non-trivial task reaches its completion phase, the orchestrator shall obtain an APPROVE verdict from the advisor agent and record it in the run ledger before the session is permitted to end."
pattern: event
verify: "Confirm that the Stop hook reads the active run ledger and blocks session end when gate.advisor is absent or not APPROVE. Confirm that after the ledger gate command records an advisor APPROVE, the Stop hook allows the session to end."
verification: hybrid
criticality: must
origin_rfc: R-20260726-K4M2QX
superseded_by: null
status: active
---

The advisor gate is enforced at two points: the orchestrator's CLAUDE.md instructs it to route to the advisor, and the Stop hook provides a mechanical backstop that cannot be bypassed by ignoring the instruction. The advisor agent runs verification commands itself and issues scored verdicts rather than accepting implementer self-reports.

## Manual procedure

Run a feature wave to completion. Without calling `ledger.mjs gate advisor APPROVE`, attempt to end the session and verify the Stop hook blocks it. Then obtain an APPROVE verdict from the advisor and record it in the ledger, and verify the session is permitted to end.
