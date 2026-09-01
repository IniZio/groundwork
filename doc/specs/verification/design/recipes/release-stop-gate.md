# Recipe: Release the Stop Gate

How to get from a blocked stop gate to a permitted session end.

## Prerequisites

- Active run ledger exists for the current session
- All implementation work is believed complete

## Steps

### 1. Verify all slices are terminal

```bash
gw ledger status --motive <slug>
```

Every slice must show `complete` or `skipped`. If any show `pending` or `in_progress`:
- Mark genuinely complete slices: `gw ledger complete --motive <slug> <id> --token <write_token>`
- For blocked slices, resolve the blocker first

### 2. Invoke the advisor

Invoke the advisor via the native `advisor()` tool if available, otherwise:

```
Task(subagent_type="groundwork:advisor", model="opus", prompt="...")
```

The advisor will execute real-world verification commands. Do not provide self-reports — the advisor runs checks itself.

### 3. Act on the verdict

| Verdict | Action |
|---------|--------|
| `APPROVE` | Proceed to step 4 |
| `CORRECTION` | Fix the blocking issues; re-invoke advisor |
| `STOP` | Re-plan the work; do not record APPROVE |

For tier-2 findings (not CORRECTION): register them as new ledger slices before recording APPROVE.

### 4. Record the APPROVE verdict

```bash
gw ledger gate --motive <slug> advisor APPROVE --token <write_token>
```

This writes `gate.advisor = "APPROVE"` into the run ledger.

### 5. End the session

The stop gate will now allow the session to end. The next Stop hook invocation will pass both checks (all slices terminal + gate.advisor = "APPROVE").

## What can go wrong

- **Subagent writes the gate** — only the orchestrator may call `gw ledger gate` with the write token. A subagent doing this is a security violation (see memory note `stopgate-token-bypass`).
- **Filtered test run** — an advisor verdict based on a filtered test run (named file list, not full suite) must be rejected. Demand a full suite run.
- **Self-reported evidence** — advisor must run commands itself; self-reports from implementers are not accepted.
