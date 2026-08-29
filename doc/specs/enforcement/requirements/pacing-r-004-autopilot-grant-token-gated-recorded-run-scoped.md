---
id: pacing-r-004
title: Autopilot grant is token-gated, recorded in the ledger, and run-scoped
concept: "[[enforcement/index]]"
criticality: must
verification: unverified
ears_pattern: Event-driven
verification_method: Test
design: "[[design/recipes/authorize-autopilot-grant]]"
status: implemented
source: groundwork-development#D-28
verifies: []
---

## Statement

When `ledger autopilot --range N` is invoked, the ledger CLI **shall** write `pacing.grant = {range: N, granted_at: <ISO-8601 timestamp>, granted_by: <session-id, falling back to "orchestrator">, reason: <reason string>}` to the active run ledger and emit a MILESTONE journal event; the grant **shall** expire automatically with the run because it is stored in the session-scoped ledger file. A second invocation of `ledger autopilot --range N` overwrites the existing grant (one-shot cap raise, not cumulative).

## Why

The autopilot grant is an explicit, auditable escape hatch for sessions that legitimately need to resolve more units than the default budget allows. Recording the grant in the ledger (with timestamp and reason) makes every overage visible in the audit trail and prevents silent budget inflation. Emitting a MILESTONE journal event makes the grant discoverable in the motive history. Scoping the grant to the run (rather than a global config) means each session's overage is independent and intentional — a new session always starts fresh from the configured budget.

## Fit criterion

After `ledger autopilot --range 2 --reason "multi-wave emergency"`, the active ledger's `pacing.grant` equals `{range:2, granted_by:<session-id or "orchestrator">, reason:"multi-wave emergency"}` and contains a valid `granted_at` ISO timestamp; `ledger claim` for a slice in the next new unit exits 0; the journal for the current motive contains a MILESTONE event referencing the autopilot grant.

## Verification procedure

Automated — run `ledger autopilot --range 2 --reason "test"` and inspect the ledger `pacing.grant` field and the journal MILESTONE event; confirm a subsequent `ledger claim` for a new unit exits 0.
