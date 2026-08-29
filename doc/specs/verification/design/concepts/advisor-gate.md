# Advisor Gate

The **advisor gate** is the real-world validation layer. It is the second condition the stop gate checks before allowing a session to end.

## What it is

The advisor is the `groundwork:advisor` agent (or native `advisor()` tool). When the orchestrator believes a non-trivial task is complete, it invokes the advisor to confirm that the work holds up under real-world conditions — not just that tests pass locally.

## Verdicts

| Verdict | Meaning | Gate effect |
|---------|---------|-------------|
| `APPROVE` | Work is genuinely complete; real-world checks passed | Gate opens |
| `CORRECTION` | Specific blocking issues found; must be fixed this session | Gate stays blocked |
| `STOP` | Fundamental problem; re-planning required | Gate stays blocked |

## How APPROVE is recorded

The orchestrator runs `bin/ledger gate advisor APPROVE --token <write_token>` after receiving an APPROVE verdict. This writes `gate.advisor = "APPROVE"` into the active run ledger, which the stop gate reads on the next session-end attempt.

**APPROVE must be recorded in the ledger by the orchestrator.** A subagent writing the gate without the orchestrator's write token is a stop-gate token bypass (see memory note `stopgate-token-bypass`).

## What the advisor checks

The advisor executes verification commands itself — it does not trust implementer self-reports. Evidence includes: build/type-check output, lint output, test pass/fail with exact counts, and file content checks for specific acceptance criteria. A self-reported summary is not accepted as evidence.

## Tier-2 issues

Findings that do not rise to CORRECTION must still be addressed. The orchestrator registers them as new ledger slices before recording APPROVE, so the stop gate keeps the session open until those slices complete.
