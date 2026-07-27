---
concept: C-VERIFICATION
origin_rfc: R-20260726-K4M2QX
---

### VERIFICATION-R-001 — Stop hook blocks session end while slices are incomplete {#verification-r-001}

If the Stop hook fires and the active run ledger contains any slices whose status is not `complete` or `skipped`, or the advisor gate verdict is not `APPROVE`, then the Stop hook **shall** block session end.

- **Why** — Without mechanical enforcement at the Stop boundary, an orchestrator (an LLM) can rationalize ending the session before all delegated slices have landed, leaving work unfinished and no audit trail. The Stop hook forces every session-end attempt through a ledger check, making incomplete delegations visible and preventing accidental completions that bypass the fan-out model.

- **Fit criterion** — Run the Stop hook against a ledger with one or more pending slices and confirm it emits a block. Run it with all slices complete but gate.advisor not APPROVE and confirm it still blocks. Run it with all slices complete AND gate.advisor = "APPROVE" and confirm the session is permitted to end.

- **Verification** automated · **Criticality** must · **Source** R-20260726-K4M2QX

- **See also** [VERIFICATION-R-002](#verification-r-002)

### VERIFICATION-R-002 — Orchestrator invokes advisor to validate completion {#verification-r-002}

When a non-trivial task is complete, the orchestrator **shall** invoke the advisor (native `advisor()` tool, or `groundwork:advisor` if unavailable) to validate that the work is genuinely complete in the real world.

- **Why** — Tests passing and slices marked complete establish internal consistency, not real-world validity. A working API must be tested against a real server; a UI change must be pixel-checked against the design; a PR must be CI-watched to completion. The advisor executes these checks itself rather than trusting self-reports. This requirement captures the orchestrator's explicit obligation to perform that validation step, not to treat green tests as sufficient evidence of done.

- **Fit criterion** — Review the orchestrator's session transcript after a completed non-trivial task and confirm the advisor was invoked (via `advisor()` or a Task call to `groundwork:advisor`) before the session ended, and that the advisor performed real-world verification commands rather than accepting a self-report.

- **Verification** manual · **Criticality** must · **Source** R-20260726-K4M2QX

- **See also** [VERIFICATION-R-001](#verification-r-001)
