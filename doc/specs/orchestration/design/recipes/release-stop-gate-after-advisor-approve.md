---
tags: [recipe, how-to, orchestration, stop-gate]
---

# How to release the stop-gate after advisor APPROVE

> **How-to guide.** Follow these steps to cleanly close an active run once all slices are complete and the advisor has approved. For a conceptual explanation of what the gate checks, see [[../concepts/stop-gate]]. For the full decision flowchart, see [[../flows/stop-gate-decision-path]].

---

## Goal

End a session cleanly, with the stop-gate allowing the stop rather than blocking it.

---

## Before you start

- All implementation slices must be `complete` or `skipped`
- The advisor (`groundwork:advisor`) has been invoked with real evidence — not a filtered test run
- You have the `write_token` (printed at `ledger init`; re-surfaced in the SessionStart injection)
- The `write_token` must remain orchestrator-only — never pass it to a subagent

---

## Steps

**1. Confirm no incomplete slices remain**

```
bin/ledger frontier
```

Expected output when done: empty (no lines).

If slices appear here, they are still `pending` or `in_progress`. Complete or skip them before proceeding.

---

**2. Check the current gate state**

```
bin/ledger view
```

Look at the `gate` section. If `advisor` is already `APPROVE`, skip to step 4.

---

**3. Record the advisor APPROVE verdict**

Only after the advisor agent has returned an APPROVE with real evidence:

```
bin/ledger gate advisor APPROVE --token <write_token>
```

With evidence citation (recommended):
```
bin/ledger gate advisor APPROVE \
  --token <write_token> \
  --citation "test/orchestration.test.ts — 41 pass, unfiltered" \
  --rubric "All ACs confirmed against source; no parity gaps; spec matches implementation"
```

Expected output:
```
✓ gate.advisor = APPROVE
```

> Do not write APPROVE yourself if the advisor returned CORRECTION or GAPS. The stop-gate will continue to block until a genuine APPROVE is recorded.

---

**4. Verify gate state**

```
bin/ledger view
```

Confirm:
- `active: true`
- `gate.advisor: APPROVE` (or the object form with `verdict: APPROVE`)
- All slices show `complete` or `skipped`

---

**5. End the session**

The next time the session naturally stops (the orchestrator completes its last action, or you close the terminal), the stop-gate reads:

1. `active === true` ✓
2. `session_id` matches ✓
3. `awaiting_human === false` ✓
4. `incomplete.length === 0` ✓
5. `advisorVerdict === APPROVE` ✓

→ **ALLOW** — emits `SESSION_END` journal event and releases.

---

## If the gate still blocks after APPROVE

Check the seal. The gate now enforces a cryptographic seal (`gate.seal`) on the ledger. If the seal is invalid (the ledger was edited manually after sealing), the block message will say "seal invalid on completion path".

In that case, do not edit the ledger file directly. Contact the session owner for the `write_token` and re-record the verdict through the CLI.

---

## Abandoning a run instead

If the work is genuinely cancelled:

```
bin/ledger abandon
```

This sets `active: false` and triggers `reSeal()`. The stop-gate will allow on the next stop.

---

## Related notes

- [[../concepts/stop-gate]] — what the gate is
- [[../flows/stop-gate-decision-path]] — the full decision flowchart
- [[../components/gate-note]] — anatomy of the `gate` object
- [[add-slice-with-acceptance-criteria]] — what to do before reaching this step
- [[../reference/ledger-cli-reference]] — all commands at a glance
