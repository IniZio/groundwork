---
id: "traceability-r-006"
type: requirement
concept: C-TRACEABILITY
title: "Stale evidence is detected via build hash"
criticality: must
verification: unverified
status: open
---

## TRACEABILITY-R-006 — Stale evidence is detected via build hash {#traceability-r-006}

Each artifact-evidence node in the traceability graph **shall** carry the build/data hash it was captured against; when the assembler detects that the current build hash differs from the stored hash on an evidence reference, it **shall** mark that edge as stale.

- **Why** — Without a freshness hash, a screenshot or CSV captured against an old build remains "proven" after the build is regenerated, creating false confidence. The hash provides a mechanical signal that human review is needed before re-approving the evidence.
- **Fit criterion** — An artifact-evidence node constructed with `makeArtifactEvidenceNode({ ref, hash: "abc" })` carries `hash: "abc"`; an assembler comparing that node against a current build hash of "xyz" marks the evidence edge as stale; an assembler comparing against "abc" marks it as proven.
- **Verification**: unverified — Automated test asserting hash-based staleness detection:
  1. Construct an artifact-evidence node with hash `"abc"`.
  2. Run the assembler with current build hash `"xyz"` — assert the evidence edge is stale.
  3. Run the assembler with current build hash `"abc"` — assert the evidence edge is proven.
  4. Assert the node itself carries the stored hash as a field.
  5. Test must carry `// @verifies TRACEABILITY-R-006`.
- **Criticality**: must
