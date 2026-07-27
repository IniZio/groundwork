---
id: C-VERIFICATION
type: concept
title: Verification
summary: "Non-trivial task completion requires an APPROVE verdict from the advisor agent, recorded in the run ledger before the session can end."
parent: C-GROUNDWORK
origin_rfc: R-20260726-K4M2QX
---

# Verification

Verification is how groundwork establishes that a task is genuinely complete rather than nominally complete. The system uses an evidence-based completion gate enforced by the advisor agent and the Stop hook.

## Advisor gate

The `advisor` agent (`agents-src/advisor.md`) is the sole authority for completion. It issues `APPROVE`, `CORRECTION`, `STOP`, `GAPS`, or `REPLAN` verdicts. An `APPROVE` verdict must be obtained before the orchestrator declares any non-trivial task done. The verdict is recorded in the run ledger via `ledger.mjs gate advisor APPROVE`.

## Evidence requirements

The advisor executes verification commands itself rather than trusting implementer self-reports. Evidence includes: build/type-check output, lint output, test pass/fail with exact counts, and file content checks for specific acceptance criteria. Self-reported summaries are not accepted as evidence.

## Risk-tiered flow

Trivial tasks (≤2 files, ≤1 behaviour, <1h): advisor directly, or skip if truly zero-risk. Small changes (localized, clear, low blast radius): advisor. Feature/non-trivial (≥3 files, ≥2 behaviours, shared code): `[qa if interactive UI] → advisor`.

## Stop hook enforcement

The `stop-gate.mjs` Stop hook blocks session end until the active ledger shows all slices complete and `gate.advisor === "APPROVE"`. This prevents the orchestrator from ending a session before the gate is satisfied.

