---
name: continue
description: Resume a paused session — restore ledger state, re-inject run context, continue the fan-out.
---

<!-- token-target: ≤301 -->

## Steps

1. Read `.groundwork/work/<slug>/handoff.md` — extract session_id, open slices, next action.
   If no motive is active, select a motive first; never create `work/default/`.
2. Run `$GW compile` — verify current ledger state matches pause record.
3. Run `$GW slice status` — confirm which slices are pending/complete.
4. Emit resume banner: `GROUNDWORK ▸ resuming: <N> open slices`
5. Continue fan-out from where the prior session stopped.

## If handoff.md missing

Run `$GW compile` to reconstruct state from the event log. Open slices are those with status ≠ complete in `$GW slice status`.

## Stop-gate state

The stop-gate reads live ledger state — no special action needed to re-arm it. If slices are open, the gate is armed automatically.
