# Stop Gate

The **stop gate** is the mechanical enforcement layer that prevents a groundwork session from ending while the active run ledger has unfinished work.

## What it is

`src/gw/hook/stop-gate.ts` (invoked via `bin/gw-hook hook stop-gate`) is a Claude Code Stop hook — it fires on every session-end attempt and either allows or blocks the stop. It is the only enforcement point that cannot be bypassed by an LLM rationalization: the hook runs outside the model's context and has final say over whether the session ends.

## What it guarantees

Two conditions must both be true before the gate opens:

1. **All slices terminal** — every slice in the active run ledger has `status: "complete"` or `status: "skipped"`. Pending or in-progress slices block.
2. **Advisor verdict APPROVE** — `gate.advisor` in the ledger equals `"APPROVE"`. Any other value (absent, `"pending"`, `"CORRECTION"`, `"STOP"`) blocks.

## Design invariants

- **Fail-open** — any error, missing ledger, or garbled JSON → allow the stop. A hook must never wedge a session.
- **Session-scoped** — a ledger stamped with a different `session_id` never blocks the current session (prevents cross-session stale-run leakage).
- **Bounded** — a reinforcement counter caps consecutive no-progress blocks. The counter resets whenever the ledger advances (a slice completes, a gate flips), so a genuinely progressing run is never prematurely released.
- **Yield-aware** — a turn-end is not always a stall. When `background_tasks` shows work in flight, or the transcript shows the orchestrator awaiting user input or reporting failure, the stop is allowed without burning a reinforcement count.

## Relationship to the advisor gate

The stop gate is a necessary but not sufficient condition for session end. The advisor gate is the second condition. See [[advisor-gate]] for how APPROVE is obtained and recorded.
