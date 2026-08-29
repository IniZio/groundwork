# Stop Gate — Decision Path

How `hooks/stop-gate.mjs` decides whether to block or allow a session-end attempt.

## Step-by-step

```
Stop hook fires
│
├─ Error reading ledger / no ledger found?
│   └─ ALLOW (fail-open)
│
├─ Ledger session_id ≠ current session?
│   └─ ALLOW (session-scoped; stale run from another session)
│
├─ background_tasks shows work in flight?
│   └─ ALLOW (yield-aware; orchestrator is awaiting background agents)
│
├─ Transcript shows awaiting user input / just launched delegation / reporting failure?
│   └─ ALLOW without burning reinforcement count
│
├─ Any slice status is "pending" or "in_progress"?
│   └─ BLOCK — emit incomplete-slices message; increment reinforcement counter
│
├─ gate.advisor ≠ "APPROVE"?
│   └─ BLOCK — emit advisor-gate message; increment reinforcement counter
│
├─ Reinforcement count ≥ cap?
│   └─ ALLOW (bounded; prevents trapping user in stuck session)
│
├─ Any high/medium-blast DECISION events with no data.research?
│   └─ Append non-blocking advisory (session still ALLOWED)
│
├─ Any DECISION events with empty alternatives or unmarked id collisions?
│   └─ Append non-blocking advisory (session still ALLOWED)
│
└─ ALLOW — all slices terminal AND gate.advisor = "APPROVE"
```

## Reinforcement counter behaviour

The counter measures **consecutive no-progress blocks**. It resets to 0 whenever the ledger advances (a slice completes, a gate verdict flips). A run that is genuinely progressing will never hit the cap; only a truly stuck run eventually releases.
