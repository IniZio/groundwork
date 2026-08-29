---
id: "traceability-r-005"
title: "Semantic classification is sourced from recorded verdicts"
concept: "[[C-TRACEABILITY/index]]"
criticality: must
verification: unverified
ears_pattern: IF-THEN
verification_method: Test
status: open
source: "tracking-viz#D-3"
---

## Statement

The traceability graph assembler **shall** derive all semantic edge classifications (proven, unproven, stale, missing) exclusively from recorded GATE and VERIFICATION journal events; it **shall not** infer or invent a verdict for any edge that has no corresponding recorded event.

## Why

If the assembler synthesizes a "proven" verdict from heuristics rather than from a recorded gate event, the resulting traceability chain misrepresents what was actually approved. The classification must be an auditable trace to a durable recorded event — not a guess.

## Fit criterion

Given a slice with no GATE APPROVE journal event, the assembled edge for that slice is classified as unproven regardless of test-pass state; given a slice with a GATE APPROVE journal event, the assembled edge is classified as proven; no edge is ever classified as proven in the absence of a recorded GATE APPROVE event.

## Verification procedure

Automated test asserting verdict sourcing:
1. Construct a fixture with a slice that has no GATE APPROVE event — assert the edge is unproven.
2. Add a GATE APPROVE event for the same slice — assert the edge becomes proven.
3. Confirm no heuristic path exists in the assembler that can yield proven without the event.
4. Test must carry `// @verifies TRACEABILITY-R-005`.
