# How to Authorize an Autopilot Grant

> **Type:** recipe (how-to)
> **Related requirements:** [[../../requirements/pacing-r-004-autopilot-grant-token-gated-recorded-run-scoped|PACING-R-004]], [[../../requirements/pacing-r-006-autopilot-grant-requires-nonempty-reason|PACING-R-006]]

## Goal

Authorize a pacing budget extension for the current session when the default wave budget is exhausted and additional implementation waves are needed.

## Before you start

- You must be the **operator** — the orchestrator (agent) cannot self-grant; the block message routes this action through you deliberately.
- You need the active session's `write_token` (printed at `ledger init`, re-surfaced in the SessionStart injection).
- Determine how many additional waves (`N`) you need.
- Prepare a non-empty reason string explaining why the extension is warranted.

## Steps

**1. Confirm pacing is exhausted.**

The agent will surface a block message when it tries `ledger claim` for a new wave. The message names: the consumed budget, the refused unit, and both remedies (autopilot or handoff).

**2. Decide: extend or hand off?**

- **Extend (autopilot)** — if the work can be completed this session and the extension is warranted.
- **Hand off** — if a new session is more appropriate (e.g. scope has grown, it's a natural checkpoint).

For handoff, run `/groundwork:pause` and open a new session. For extension, continue to step 3.

**3. Run `ledger autopilot`.**

```bash
bin/ledger autopilot --range N --reason "your reason here" --token <write_token>
```

- `--range N` — the number of additional waves to allow (cumulative cap raise from the current budget; a second invocation overwrites the first, not cumulative addition).
- `--reason` — REQUIRED; non-empty string; whitespace-only is rejected.
- `--token` — the orchestrator `write_token`.

**4. Confirm the grant.**

```bash
bin/ledger view | grep pacing
```

The ledger should show `pacing.grant` with `range`, `reason`, `granted_by`, and `granted_at`.

A MILESTONE journal event is also emitted — visible in the motive journal.

**5. Notify the agent.**

Tell the agent the grant is in place. It can now proceed with `ledger claim` for the next wave.

## What the ledger records

```json
{
  "pacing": {
    "policy": "wave",
    "budget": 1,
    "grant": {
      "range": 2,
      "reason": "your reason here",
      "granted_by": "<session-id>",
      "granted_at": "2026-08-29T10:00:00.000Z"
    }
  }
}
```

## At session end

When the Stop hook fires on a session with an active grant, it emits a non-blocking summary line mentioning the grant's range, reason, and `granted_by` session. This is informational — it does not block the session from ending.
