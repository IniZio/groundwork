---
id: pacing-r-002
title: Start-time hard block with exact-reason messaging
concept: "[[enforcement/index]]"
criticality: must
verification: unverified
ears_pattern: IF-THEN
verification_method: Test
design: "[[design/reference/enforcement-hooks-reference]]"
status: implemented
source: groundwork-development#D-28
verifies: []
---

## Statement

If `ledger claim` or `ledger set --status in_progress` is invoked for a slice that belongs to a new unit (a unit other than the lowest-numbered unit holding any non-exempt `in_progress` slice) and `resolved_units >= budget + grant.range`, then the ledger CLI **shall** exit 1 and emit a block message that states all three of: which budget was consumed, which unit was refused, and the two available remedies (`ledger autopilot --range N` or handoff to a new session).

## Why

Enforcing at claim time (before work starts) rather than at completion time stops wasted work before it happens and keeps the ledger truthful: a slice in progress implies budget was available. The in-flight-unit rule preserves unlimited intra-wave parallelism — any number of subagents may claim slices inside the current wave without hitting the block — while closing the bypass where a session claims everything upfront and completes nothing. The three-part message (budget consumed, unit refused, remedies) satisfies P-B (no swallowed signal) and gives the operator exactly the information needed to choose a path forward without guessing. Pacing gates *starting* units of work via `claim` and `set --status in_progress` only; `add` and `complete` are deliberately ungated (P-B: refusing to record finished work would falsify the ledger).

## Fit criterion

With `pacing.budget = 1` and one wave fully resolved, invoking `ledger claim` for a slice in wave 2 exits 1 and the output names: the consumed budget (1 wave), the refused unit (wave 2 slice id), and both remedies (`ledger autopilot --range N` and handoff). Invoking `ledger claim` for a second slice within the in-flight wave exits 0 and succeeds.

## Verification procedure

Automated — invoke `ledger claim` for a wave-2 slice after wave 1 is complete with `budget=1`; confirm exit 1 and message content; invoke `ledger claim` for an in-flight-wave slice and confirm exit 0.
