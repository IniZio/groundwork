---
type: constraints
id: C-VERIFICATION
---

# Verification — Normative Constraints

## VERIFICATION-R-001 — Stop hook blocks session end while slices are incomplete

The stop hook **SHALL** block session end while the active run ledger contains any slices whose status is not `complete` or `skipped`, **OR** while the advisor gate verdict is not `APPROVE`. Both conditions must be satisfied — all slices in a terminal state **AND** `gate.advisor = "APPROVE"` — before the hook releases.

- **Verification**: automated — the Stop hook enforces this mechanically on every session-end attempt.

## VERIFICATION-R-002 — Orchestrator invokes advisor to validate completion

When a non-trivial task is complete, the orchestrator **SHALL** invoke the advisor (native `advisor()` tool, or `groundwork:advisor` if unavailable) to validate that the work is genuinely complete in the real world. The advisor executes verification commands itself rather than accepting implementer self-reports.

- **Verification**: manual — confirmed by reviewing the orchestrator's session transcript to ensure advisor invocation occurred before session end and that real-world verification commands were performed.
