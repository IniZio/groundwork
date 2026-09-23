---
name: continue
description: Resume a paused session — restore ledger state, re-inject run context, continue the fan-out.
---

<!-- token-target: ≤301 (v1 continue skill was 903 tokens; 1/3 = 301) -->

## Steps

1. Read `.groundwork/pause-state.md` — extract session_id, open slices, next action (no token stored there).
2. Run `$GW token` — prints `token: <T>`. Capture T for this session's mutations.
3. Run `$GW compile` — verify current ledger state matches pause record.
4. Run `$GW slice status` — confirm which slices are pending/complete.
5. Emit resume banner: `GROUNDWORK ▸ resuming: <N> open slices, token: <T>`
6. Continue fan-out from where the prior session stopped. Use token T.

## If pause-state.md missing

Run `$GW compile` to reconstruct state from the event log. Open slices are those with status ≠ complete in `$GW slice status`.

## Stop-gate state

The stop-gate reads live ledger state — no special action needed to re-arm it. If slices are open, the gate is armed automatically.
