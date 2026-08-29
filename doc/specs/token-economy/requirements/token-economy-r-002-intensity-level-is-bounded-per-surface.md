---
id: "token-economy-r-002"
title: "Intensity level is bounded per surface"
concept: "[[token-economy/index]]"
criticality: must
verification: manual
ears_pattern: Ubiquitous
verification_method: Inspection
status: open
source: "token-economy#D-2"
---

## Statement

Every agent output surface **shall** apply compression at no more than the intensity level assigned to that surface: leaf agent output prose at `full` intensity (drop articles, fragments permitted); orchestrator sequencing prose — wave ordering, `blocked_by`, and gate sequences — at `lite` intensity at most (drop filler only; keep articles and full sentences); evidence surfaces at `none` (see TOKEN-ECONOMY-R-003). The intensity level `ultra` (strip conjunctions) **shall not** be used on any surface in groundwork.

## Why

`ultra` removes conjunctions, which makes step order ambiguous. Orchestration sequencing depends on unambiguous ordering; a wave that strips `then` and `before` from its sequencing prose can be misread as parallel when it is serial. `lite` is the safety cap for any prose where ordering is semantically load-bearing.

## Fit criterion

Reviewing a diff of orchestrator sequencing prose shows no removed conjunctions; articles are present; sentence fragments are absent. Reviewing a diff of leaf agent output prose shows articles absent and fragments present where appropriate. No output anywhere applies `ultra`.

## Verification procedure

**Manual** — reviewer reads the diff of every sequencing block (wave ordering, gate sequences, `blocked_by` fields) against this rule; a summary of the diff is not sufficient.

1. Identify all orchestrator sequencing prose in the diff: wave-ordering lists, `blocked_by` field values, and gate sequences in `CLAUDE.md` or session-reminder injection.
2. Check each item: conjunctions (`then`, `before`, `after`, `and then`, `so that`) must be present where present in the original; articles (`a`, `an`, `the`) must be present; sentence fragments must be absent.
3. Confirm no output anywhere applies `ultra` intensity (stripped conjunctions in non-sequencing prose is also a violation).
4. If all conditions hold, the requirement is satisfied for that change.
