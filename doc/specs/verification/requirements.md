---
concept: C-VERIFICATION
origin_rfc: R-20260726-K4M2QX
---

### VERIFICATION-R-001 — Stop hook blocks unverified session end {#verification-r-001}

If the Stop hook fires and the active run ledger does not carry an advisor APPROVE verdict, then the Stop hook **shall** block session end.

- **Why** — Without mechanical enforcement at the Stop boundary, an orchestrator (an LLM) can rationalize ending the session without recording the verdict into the ledger, leaving no audit trail and no verification gate. The Stop hook forces every session-end attempt into the ledger for inspection, making the decision point auditable and preventing accidental completions that bypass review.

- **Fit criterion** — Run the Stop hook against a ledger with no gate entry and confirm it emits a block. Run it again after recording an advisor APPROVE via the ledger gate command and confirm the session is permitted to end.

- **Verification** automated · **Criticality** must · **Source** R-20260726-K4M2QX

- **See also** [VERIFICATION-R-002](#verification-r-002)

### VERIFICATION-R-002 — Orchestrator obtains advisor approval {#verification-r-002}

When a non-trivial task is complete, the orchestrator **shall** obtain an APPROVE verdict from the advisor agent.

- **Why** — An enforcement mechanism (the Stop hook) without a binding normative obligation is merely aspirational; an orchestrator can rationalize around it if obtaining the verdict is framed as optional. The completion gate tiers (CLAUDE.md §Mandatory completion flow) establish that advisor APPROVE is REQUIRED for non-trivial work. This requirement captures the orchestrator's explicit obligation to make that invocation a non-negotiable step, not one it skips under time pressure or when the task "looks good".

- **Fit criterion** — Review the orchestrator's session transcript after a completed non-trivial task and confirm a Task call to groundwork:advisor was made and that the advisor returned an APPROVE verdict before the ledger gate command was recorded.

- **Verification** manual · **Criticality** must · **Source** R-20260726-K4M2QX

- **See also** [VERIFICATION-R-001](#verification-r-001)
