---
tags: [concept, orchestration, stop-gate]
source: src/gw/hook/stop-gate.ts
---

# Stop-Gate

> **Concept note.** This explains *what* the stop-gate is and *why* it exists. For the exact decision path it follows, see [[../flows/stop-gate-decision-path]]. To close out a run, see [[../recipes/release-stop-gate-after-advisor-approve]].

---

## Overview

The stop-gate is a `Stop` hook (`src/gw/hook/stop-gate.ts`, invoked via `bin/gw-hook hook stop-gate`) that fires every time a session tries to end. It reads the active run ledger and decides whether to **allow** the stop or **block** it with a re-injected directive.

Its purpose: prevent a session from ending while there are still incomplete vertical slices, or while the advisor has not yet approved. Without it, an orchestrator could stop between waves and leave the run stranded.

---

## What triggers it

The hook fires on every `Stop` event — including:
- The user closing the terminal
- The orchestrator completing its last planned action
- Claude Code's built-in session timeout

It does **not** fire mid-session. It only has power at the moment of stop.

---

## The four design guarantees

Derived from the header comment in `src/gw/hook/stop-gate.ts`:

| Guarantee | What it means |
|-----------|--------------|
| **FAIL-OPEN** | Any error, missing ledger, or garbled parse → allow the stop. The hook must never wedge a session. |
| **SESSION-SCOPED** | A ledger stamped with a different `session_id` never blocks the current session. |
| **BOUNDED** | A reinforcement counter caps consecutive no-progress blocks. Resets whenever the ledger advances (a slice completes, a gate flips). |
| **YIELD-AWARE** | Background tasks in flight (orchestrator awaiting subagent completion) → allow without burning a reinforcement. |

---

## What the gate checks

In priority order (first matching condition wins):

1. No ledger, or parse error → **allow**
2. `active === false` (abandoned) → **allow** (after seal check)
3. `session_id` mismatch → **allow**
4. `awaiting_human === true` → **allow** (session is correctly paused)
5. All slices complete **and** `gate.advisor === APPROVE` → **allow** (emit `SESSION_END`)
6. Pacing exhausted → **allow** (emit `DIRECTIVE` handoff)
7. Background tasks in flight → **allow**
8. Reinforcement cap exceeded → **allow** (release stuck session)
9. Otherwise → **block**, increment reinforcement counter

For the full branching diagram, see [[../flows/stop-gate-decision-path]].

---

## The advisor verdict

The gate reads `gate.advisor` from the ledger. The field accepts two forms:

- **Legacy string:** `"APPROVE"` / `"CORRECTION"` / `"STOP"` / `"GAPS"` / `"REPLAN"`
- **Object form:** `{ "verdict": "APPROVE", "rubric": "...", "axes": { "correctness": 0, ... } }`

`APPROVE` is the only terminal verdict that satisfies the gate. All others are treated as not-yet-approved.

The orchestrator writes this field with:
```
gw ledger gate --motive <slug> advisor APPROVE --token <write_token>
```

The `write_token` is orchestrator-only — subagents must never receive it.

---

## What the gate cannot do

- It cannot observe what happened inside a subagent's context
- It cannot detect 1:1 forwarding by a junior-orchestrator
- It cannot run tests or evaluate acceptance criteria
- It can only READ the ledger and BLOCK or ALLOW the stop

---

## Related requirements

- [[../../requirements/orchestration-r-001-orchestrator-delegates-non-trivial-implementation|R-001]] — the gate enforces that work was genuinely done, not just declared

## Related notes

- [[delegation-hierarchy]] — what produces the slices the gate checks
- [[vertical-slice]] — how slices get their acceptance criteria
- [[../flows/stop-gate-decision-path]] — the full decision flowchart
- [[../components/gate-note]] — anatomy of the `gate` object in the ledger
- [[../recipes/release-stop-gate-after-advisor-approve]] — how-to close a run cleanly
