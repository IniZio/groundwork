---
id: "traceability-r-002"
title: "Full chain is rendered end-to-end"
concept: "[[C-TRACEABILITY/index]]"
criticality: must
verification: unverified
ears_pattern: IF-THEN
verification_method: Test
status: open
source: "tracking-viz#D-7"
---

## Statement

The traceability graph assembler **shall** include nodes of every type in the chain — objective, spec-req, slice, self-test, live-verify, gate, artifact-evidence — and edges connecting them, so that a consumer rendering the graph can display the full objective→spec-req→slice→self-test→live-verify→gate path without additional data fetching.

## Why

If any link in the chain is silently dropped by the assembler, the rendered view shows a broken chain that a user cannot distinguish from a genuinely unproven link. The assembler must surface all discovered links so that the render surface can classify them as proven, unproven, stale, or missing.

## Fit criterion

Given a motive with at least one slice (with `covers_ac` and `decisions` set), one VERIFICATION event, one GATE APPROVE event, and one spec requirement whose `origin_decision_ref` matches a slice decision, the assembled graph contains nodes of types: objective, slice, spec-requirement, live-verify, gate; and edges of kinds: covers, confirms, seals.

## Verification procedure

Automated test covering the assembler output contract:
1. Construct a frozen fixture with a ledger slice (`covers_ac`, `decisions`), a VERIFICATION event, a GATE APPROVE event, and a spec requirement with matching `origin_decision_ref`.
2. Run the graph assembler against the fixture.
3. Assert the output contains nodes of every required type and edges of kinds covers, confirms, seals.
4. Test must carry `// @verifies TRACEABILITY-R-002`.
