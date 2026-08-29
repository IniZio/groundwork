---
id: "verification-r-001"
title: "Stop hook blocks session end while slices are incomplete"
concept: "[[verification/index]]"
criticality: must
verification: unverified
ears_pattern: IF-THEN
verification_method: Test
status: open
source: "groundwork-development"
---

## Statement

If the Stop hook fires and the active run ledger contains any slices whose status is not `complete` or `skipped`, or the advisor gate verdict is not `APPROVE`, then the Stop hook **shall** block session end.

## Why

Without mechanical enforcement at the Stop boundary, an orchestrator (an LLM) can rationalize ending the session before all delegated slices have landed, leaving work unfinished and no audit trail. The Stop hook forces every session-end attempt through a ledger check, making incomplete delegations visible and preventing accidental completions that bypass the fan-out model.

## Fit criterion

Run the Stop hook against a ledger with one or more pending slices and confirm it emits a block. Run it with all slices complete but `gate.advisor` not `APPROVE` and confirm it still blocks. Run it with all slices complete AND `gate.advisor = "APPROVE"` and confirm the session is permitted to end.

## Verification procedure

**Automated** — the Stop hook enforces this mechanically on every session-end attempt.

1. Invoke the Stop hook with a ledger containing a slice with `status: "pending"`. Confirm the hook exits non-zero (blocked).
2. Invoke the Stop hook with all slices `complete` but `gate.advisor` absent or not `"APPROVE"`. Confirm blocked.
3. Invoke the Stop hook with all slices `complete` and `gate.advisor = "APPROVE"`. Confirm the hook exits zero (allowed).

See also: [[verification-r-002-orchestrator-invokes-advisor-to-validate-completion|R-002]]
