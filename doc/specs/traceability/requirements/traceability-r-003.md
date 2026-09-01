---
id: "traceability-r-003"
type: requirement
concept: C-TRACEABILITY
title: "Link classification is visibly rendered"
criticality: must
verification: manual
status: open
---

## TRACEABILITY-R-003 — Link classification is visibly rendered {#traceability-r-003}

Every edge in the rendered traceability chain **shall** be visibly classified as one of: proven (gate APPROVE and live-verify pass on record), unproven (slice exists but no live-verify or gate), stale (evidence hash does not match current build hash), or missing (required link absent from graph).

- **Why** — A chain with unclassified edges is indistinguishable from one with proven edges. The classification must be visible so a reviewer can immediately identify which links need attention without reading the underlying data.
- **Fit criterion** — In a session with a manual review of the rendered output: at least one edge is labeled/styled as proven (advisor APPROVE present), at least one edge is labeled/styled as unproven (slice with no gate), and the visual distinction between the two states is unambiguous to a reviewer unfamiliar with the data.
- **Verification**: manual — Manual inspection of the rendered traceability view:
  1. Prepare a motive with at least one complete gate-approved slice and one slice with no gate event.
  2. Render the traceability view.
  3. Confirm that the proven edge is visibly distinct (e.g. different color, label, or icon) from the unproven edge.
  4. Confirm the distinction is unambiguous to a reviewer who has not seen the underlying data.
  5. Record inspector's initials and date as evidence.
- **Criticality**: must
