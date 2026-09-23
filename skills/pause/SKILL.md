---
name: pause
description: Capture current session state so a successor session can resume exactly where this one stopped.
---

<!-- token-target: ≤235 (v1 pause skill was 706 tokens; 1/3 = 235) -->

## Steps

1. Run `$GW compile` — capture objective, open slices, gate state.
2. Run `$GW event append --type PAUSE --msg "Pausing: <reason>" --token T`
3. Record in `.groundwork/pause-state.md`:
   - session_id (from SessionStart injection)
   - transcript_path (from SessionStart injection)
   - open slice ids and statuses
   - next action for successor
   - **do NOT record the write token** — successor retrieves it fresh via `$GW init`

4. Tell user: "Paused. Successor session: load `/continue` and read `.groundwork/pause-state.md`."

## After pausing

Stop-gate stays armed if slices are open. Successor must call `$GW slice complete` and `$GW gate approve` to release.
