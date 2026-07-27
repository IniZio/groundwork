---
id: C-VERIFICATION
type: concept
title: Verification
summary: "Non-trivial tasks require advisor validation — confirming real-world completeness — before the session ends."
parent: C-GROUNDWORK
origin_rfc: R-20260726-K4M2QX
---

# Verification

Verification is how groundwork establishes that a task is genuinely complete rather than nominally complete. The system distinguishes two complementary guarantees:

- **Verification** (automated): tests pass, slices are marked complete, the build is green.
- **Validation** (human/advisor): the work is genuinely done in the real world — API changes tested against a real server or docker-compose, UI changes pixel-checked against the design, PRs CI-watched to completion.

## Advisor as validator

The `advisor` agent (`agents-src/advisor.md`) is invoked as a real-world validator, not a gatekeeper. When the orchestrator believes a non-trivial task is complete, it **shall** invoke the advisor (native `advisor()` tool if available, else `groundwork:advisor`) to confirm that the work holds up under real-world conditions. The advisor executes verification commands itself — it does not trust implementer self-reports.

The advisor gates the ledger for real-world validation failures. CORRECTION and REPLAN verdicts block session end; only APPROVE releases the gate. The advisor's own judgment distinguishes hard-blocking issues (UI untested, missing e2e coverage, unresolved clarifications needed from the user, similar project references not consulted) from tier-2 issues. Tier-2 issues must still be addressed in the same session but may be prioritized — the orchestrator registers them as new ledger slices before recording APPROVE, so the stop-gate keeps the session open until those slices are done.

## Evidence requirements

The advisor executes verification commands itself rather than trusting implementer self-reports. Evidence includes: build/type-check output, lint output, test pass/fail with exact counts, and file content checks for specific acceptance criteria. Self-reported summaries are not accepted as evidence.

## Risk-tiered invocation

Trivial tasks (≤2 files, ≤1 behaviour, <1h): advisor optional, or skip if truly zero-risk. Small changes (localized, clear, low blast radius): advisor required. Feature/non-trivial (≥3 files, ≥2 behaviours, shared code): `[qa if interactive UI] → advisor`.

## Stop hook enforcement

The `stop-gate.mjs` Stop hook blocks session end while the active run ledger has any slices in a non-terminal state (`pending` or `in_progress`) OR the advisor gate verdict is not `APPROVE`. Both conditions must be satisfied — all slices terminal AND gate.advisor = "APPROVE" — before the hook releases. This prevents the orchestrator from ending a session before all delegated work has landed and been validated.
