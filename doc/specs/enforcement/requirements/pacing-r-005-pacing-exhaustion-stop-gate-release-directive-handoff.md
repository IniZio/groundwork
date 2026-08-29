---
id: pacing-r-005
title: Pacing exhaustion is a sanctioned stop-gate release with directive handoff
concept: "[[enforcement/index]]"
criticality: must
verification: unverified
ears_pattern: IF-THEN
verification_method: Test
design: "[[design/flows/stop-gate-decision-path]]"
status: implemented
source: groundwork-development#D-29
verifies: []
---

## Statement

If the Stop hook fires and pacing is exhausted (no claimable unit remains for the current session) and one or more incomplete slices remain in the ledger, the Stop hook **shall** allow the session to end and **shall** emit a directive (not an advisory) instructing the operator to run the handoff skill and open a new session, naming the motive MAP.md path and the exact ids of all remaining incomplete slices.

## Why

Pacing blocks starting work; the stop-gate blocks ending a session with work remaining. Composed naively these two rules deadlock a session that can neither claim new slices nor exit — this is the single failure mode that would make the pacing feature unusable. Making exhaustion a release path resolves the deadlock. Emitting a directive (not an advisory) satisfies P-B (no swallowed signal) and ensures the operator receives an unambiguous instruction rather than a hint. The pacing release does not bypass the advisor gate for work that was completed in the session — the advisor requirement is unchanged.

## Fit criterion

With pacing exhausted and two incomplete slices remaining, the Stop hook exits 0 (session is permitted to end) and its output contains a directive line naming: the motive MAP.md path and both incomplete slice ids. With pacing active (budget not exhausted) and incomplete slices remaining, the Stop hook still blocks as before (unchanged behaviour).

## Verification procedure

Automated — with pacing exhausted and two incomplete slices, confirm Stop hook exits 0 and its output includes a directive naming the MAP.md path and both slice ids; with budget remaining, confirm Stop hook still blocks on incomplete slices.
