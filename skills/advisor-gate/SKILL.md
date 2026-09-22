---
name: advisor-gate
description: Run the advisor completion gate — evidence verification, verdict issuance, gw gate approve.
---

<!-- token-target: ≤448 (v1 advisor-gate skill was 1345 tokens; 1/3 = 448) -->

## When to invoke

After all slices complete and `$GW slice status` shows 0 pending. Invoke as:
`Task(subagent_type="groundwork:advisor", prompt="completion gate: <summary>; acceptance: <criteria>")`

## What advisor does

1. Runs `bun test` and `bunx tsc --noEmit` unfiltered. Pastes relevant output.
2. Checks each acceptance criterion: VERIFIED / PARTIAL / MISSING with fresh evidence.
3. Issues verdict (APPROVE / CORRECTION / STOP / GAPS / REPLAN).

## After APPROVE

```
$GW gate approve --citation "<file:line from advisor's evidence>" --token T
```

The stop-gate reads the `GATE_APPROVE` event and releases. Without this call the session stays blocked.

## Prove-the-check-can-fail

Before counting a test as evidence: confirm it fails when the behavior is absent.
Swap a correct value for a wrong one, re-run, verify red. A test that always passes is not evidence.

## False-approve cost

A false APPROVE that reaches production costs 10-100x a false CORRECTION that requires
another implementation round. When in doubt, issue CORRECTION with a citation.
