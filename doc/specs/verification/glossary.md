# Verification — Glossary

## stop gate

The mechanical enforcement layer implemented by `hooks/stop-gate.mjs`. Fires on every session-end attempt. Blocks the session from ending while any ledger slice is non-terminal or the advisor gate verdict is not `APPROVE`. Fail-open: errors allow the session to end rather than wedge it. See [[design/concepts/stop-gate]].

## advisor gate

The second condition the stop gate checks. The orchestrator must invoke the advisor (native `advisor()` tool or `groundwork:advisor` agent) after a non-trivial task is believed complete. The advisor executes real-world verification commands and returns a verdict. Only `APPROVE` releases the gate. See [[design/concepts/advisor-gate]].

## advisor verdict

The scored output of an advisor invocation. One of: `APPROVE` (gate opens), `CORRECTION` (blocking issues; gate stays blocked), `STOP` (re-planning required; gate stays blocked). Recorded in the run ledger by the orchestrator via `bin/ledger gate advisor APPROVE --token <write_token>`.

## APPROVE

The advisor verdict that permits the stop gate to open. Means the advisor has confirmed real-world completeness — not just that tests pass locally.

## CORRECTION

An advisor verdict indicating specific blocking issues that must be fixed before the session can end. The gate stays blocked until the issues are resolved and the advisor re-approves.

## STOP

An advisor verdict indicating a fundamental problem requiring re-planning. The gate stays blocked.

## slice incomplete

A ledger slice whose `status` is `pending` or `in_progress`. An incomplete slice blocks the stop gate. A slice becomes terminal when its status is set to `complete` or `skipped`.

## awaiting_human

An informal state (not a formal ledger status) where the orchestrator has deliberately yielded the session to await user input. The stop gate's yield-aware logic detects this and allows the stop without burning a reinforcement count, so the session can be re-invoked rather than busy-looping against the gate.
