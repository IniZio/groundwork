---
type: constraints
id: C-VERIFICATION
---

# Verification — Normative Constraints

## VERIFICATION-R-001 — Stop hook blocks session end while slices are incomplete {#verification-r-001}

If the Stop hook fires and the active run ledger contains any slices whose status is not `complete` or `skipped`, or the advisor gate verdict is not `APPROVE`, then the Stop hook **shall** block session end.

- **Why** — Without mechanical enforcement at the Stop boundary, an orchestrator (an LLM) can rationalize ending the session before all delegated slices have landed, leaving work unfinished and no audit trail. The Stop hook forces every session-end attempt through a ledger check, making incomplete delegations visible and preventing accidental completions that bypass the fan-out model.
- **Fit criterion** — Run the Stop hook against a ledger with one or more pending slices and confirm it emits a block. Run it with all slices complete but `gate.advisor` not `APPROVE` and confirm it still blocks. Run it with all slices complete AND `gate.advisor = "APPROVE"` and confirm the session is permitted to end.
- **Verification**: automated — the Stop hook enforces this mechanically on every session-end attempt.
- **Criticality**: must

See also: [VERIFICATION-R-002](#verification-r-002)

## VERIFICATION-R-002 — Orchestrator invokes advisor to validate completion {#verification-r-002}

When a non-trivial task is complete, the orchestrator **shall** invoke the advisor (native `advisor()` tool, or `groundwork:advisor` if unavailable) to validate that the work is genuinely complete in the real world.

- **Why** — Tests passing and slices marked complete establish internal consistency, not real-world validity. A working API must be tested against a real server; a UI change must be pixel-checked against the design; a PR must be CI-watched to completion. The advisor executes these checks itself rather than trusting self-reports. This requirement captures the orchestrator's explicit obligation to perform that validation step, not to treat green tests as sufficient evidence of done.
- **Fit criterion** — Review the orchestrator's session transcript after a completed non-trivial task and confirm the advisor was invoked (via `advisor()` or a Task call to `groundwork:advisor`) before the session ended, and that the advisor performed real-world verification commands rather than accepting a self-report.
- **Verification**: manual — confirmed by reviewing the orchestrator's session transcript to ensure advisor invocation occurred before session end and that real-world verification commands were performed.
- **Criticality**: must

### Manual procedure

1. At the end of a non-trivial session, open the session transcript.
2. Search for an `advisor()` call or a `Task(subagent_type="groundwork:advisor", …)` call. Confirm it appears before the final session-end message.
3. In the advisor's response, confirm that at least one real-world verification command was executed (e.g. `npx vitest run`, `node hooks/spec-lint.mjs`, a live API call, or a browser check) rather than a self-report.
4. If both conditions hold, the requirement is satisfied for that session.

See also: [VERIFICATION-R-001](#verification-r-001)

## VERIFICATION-R-003 — Stop hook emits non-blocking advisory for DECISION events lacking research {#verification-r-003}

If the Stop hook fires and any journal DECISION event for the current motive carries `data.blast` of `"high"` or `"medium"` (case-insensitive) and no `data.research` field, then the Stop hook **shall** append a non-blocking advisory message naming the ids of those DECISION events.

- **Why** — high-blast decisions without documented research findings leave future reviewers unable to assess whether the choice was informed; surfacing the gap as a non-blocking advisory at session-end gives the orchestrator the option to add research before closing without preventing completion of sessions where research is intentionally deferred.
- **Fit criterion** — with a DECISION event carrying `data.blast: "high"` and no `data.research`, the Stop hook output contains an advisory line naming the decision id and the session is permitted to end (the gate is not blocked); when `data.research` is present on all high/medium-blast DECISION events, no advisory is emitted.
- **Verification** manual · **Criticality** should · **Source** groundwork-development#D-13
