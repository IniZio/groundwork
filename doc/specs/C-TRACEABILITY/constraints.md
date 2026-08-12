---
type: constraints
id: C-TRACEABILITY
---

# Traceability — Normative Constraints

## TRACEABILITY-R-001 — Traceability chain renders on real motive data {#traceability-r-001}

When the traceability regeneration command is run against a real dogfooded motive (e.g. `groundwork-development`), it **shall** produce both read surfaces — an ambient auto-regenerated file and an interactive live view — each displaying the full chain: objective→spec-req→slice→self-test→live-verify→gate.

- **Why** — Dogfooding on real motive data (not synthetic fixtures) is the only way to confirm that the join engine handles the actual corpus of journal events, ledger slices, and spec requirements without gaps caused by edge cases in real data. Synthetic tests can miss corpus-specific quirks such as partial coverage, missing decision refs, or empty coverage.json entries.
- **Fit criterion** — Running the regeneration command against a real motive with at least one complete slice, one gate event, and at least one spec requirement produces two output artifacts (the ambient file and the served HTML) without error; both display at least one node of each type in the chain (objective, spec-req, slice, gate).
- **Verification**: manual
- **Criticality**: must
- **Source**: tracking-viz#D-3

## TRACEABILITY-R-002 — Full chain is rendered end-to-end {#traceability-r-002}

The traceability graph assembler **shall** include nodes of every type in the chain — objective, spec-req, slice, self-test, live-verify, gate, artifact-evidence — and edges connecting them, so that a consumer rendering the graph can display the full objective→spec-req→slice→self-test→live-verify→gate path without additional data fetching.

- **Why** — If any link in the chain is silently dropped by the assembler, the rendered view shows a broken chain that a user cannot distinguish from a genuinely unproven link. The assembler must surface all discovered links so that the render surface can classify them as proven, unproven, stale, or missing.
- **Fit criterion** — Given a motive with at least one slice (with covers_ac and decisions set), one VERIFICATION event, one GATE APPROVE event, and one spec requirement whose origin_decision_ref matches a slice decision, the assembled graph contains nodes of types: objective, slice, spec-requirement, live-verify, gate; and edges of kinds: covers, confirms, seals.
- **Verification**: automated
- **Criticality**: must
- **Source**: tracking-viz#D-7

## TRACEABILITY-R-003 — Link classification is visibly rendered {#traceability-r-003}

Every edge in the rendered traceability chain **shall** be visibly classified as one of: proven (gate APPROVE and live-verify pass on record), unproven (slice exists but no live-verify or gate), stale (evidence hash does not match current build hash), or missing (required link absent from graph).

- **Why** — A chain with unclassified edges is indistinguishable from one with proven edges. The classification must be visible so a reviewer can immediately identify which links need attention without reading the underlying data.
- **Fit criterion** — In a session with a manual review of the rendered output: at least one edge is labeled/styled as proven (advisor APPROVE present), at least one edge is labeled/styled as unproven (slice with no gate), and the visual distinction between the two states is unambiguous to a reviewer unfamiliar with the data.
- **Verification**: manual
- **Criticality**: must
- **Source**: tracking-viz#D-3

## TRACEABILITY-R-004 — Mechanical links are deterministic {#traceability-r-004}

The traceability graph assembler **shall** be a pure function of its input data: given the same ledger slices, journal events, spec requirements, and coverage.json, it **shall** produce byte-for-byte identical node and edge sets on every invocation, with no timestamps, random ids, or nondeterministic ordering.

- **Why** — Nondeterministic output makes it impossible to diff two regenerations and detect what changed. It also means two viewers of the same motive may see different graphs, breaking the "same input yields same output" contract required by AC-4.
- **Fit criterion** — Running the assembler twice against the same frozen inputs (ledger snapshot, journal snapshot, coverage.json snapshot) produces identical JSON output both times; diffing the two outputs reports no differences.
- **Verification**: automated
- **Criticality**: must
- **Source**: tracking-viz#D-3

## TRACEABILITY-R-005 — Semantic classification is sourced from recorded verdicts {#traceability-r-005}

The traceability graph assembler **shall** source link classification (proven/unproven/stale/missing) from previously recorded GATE and VERIFICATION journal events, never from recomputing an LLM judge at regeneration time; an explicit on-demand re-judge action **may** re-run a judge on a single link when the user invokes it.

- **Why** — Recomputing semantic classification at every regeneration introduces nondeterminism (LLM output varies between calls), inflates cost, and can silently change a "proven" verdict to "unproven" between sessions, making the history untrustworthy. Sourcing from recorded events ensures the verdict is auditable, stable, and reversible.
- **Fit criterion** — In a manual review: the classification of a link does not change between two regenerations of the same motive when no new GATE or VERIFICATION events were appended; the on-demand re-judge action is only invoked when the user explicitly requests it; the regeneration path does not invoke any LLM API.
- **Verification**: manual
- **Criticality**: must
- **Source**: tracking-viz#D-3

## TRACEABILITY-R-006 — Stale evidence is detected via build hash {#traceability-r-006}

Each artifact-evidence node in the traceability graph **shall** carry the build/data hash it was captured against; when the assembler detects that the current build hash differs from the stored hash on an evidence reference, it **shall** mark that edge as stale.

- **Why** — Without a freshness hash, a screenshot or CSV captured against an old build remains "proven" after the build is regenerated, creating false confidence. The hash provides a mechanical signal that human review is needed before re-approving the evidence.
- **Fit criterion** — An artifact-evidence node constructed with `makeArtifactEvidenceNode({ ref, hash: "abc" })` carries `hash: "abc"`; an assembler comparing that node against a current build hash of "xyz" marks the evidences edge as stale; an assembler comparing against "abc" marks it as proven.
- **Verification**: automated
- **Criticality**: must
- **Source**: tracking-viz#D-4
