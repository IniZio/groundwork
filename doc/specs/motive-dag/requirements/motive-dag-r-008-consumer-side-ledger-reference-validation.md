---
id: motive-dag-r-008
type: requirement
concept: C-MOTIVE-DAG
title: Consumer-side ledger reference validation against the motive's declared AC set and canonical fold
status: open
verification: automated
criticality: must
design: "[[design/recipes/validate-ac-references]]"
---

## MOTIVE-DAG-R-008 — Consumer-side ledger reference validation against the motive's declared AC set and canonical fold {#motive-dag-r-008}

**When** a ledger operation writes or validates `covers_ac` or `decisions` fields on a slice, the ledger **shall** reject any dangling reference with a named diagnostic identifying the field (`covers_ac` or `decisions`) and the unknown id, then exit with a nonzero status, rather than silently accepting it. The authoritative valid sets are: for `covers_ac`, the union of (a) the motive's declared acceptance-criterion ids in the `## Acceptance criteria` section of `motive.md` and (b) AC nodes in the canonical event-sourced fold; for `decisions`, decision nodes in the canonical event-sourced fold. An AC id is therefore valid at first-time coverage declaration (before any `AC_COVERAGE` event has been emitted for it) provided it is declared in the charter. When no motive is stamped on the ledger, the journal is absent, or fold assembly fails, validation is skipped (graceful degradation — no crash).

- **Why** — A dangling `covers_ac` reference reports false coverage for an AC that does not exist in either the charter or the canonical graph, undermining the coverage guarantee that drives release decisions. A dangling `decisions` reference breaks the rationale audit chain (the link from implementation slice back to the recorded decision), violating the audit guarantee of D-5. Charter ACs that are declared but not yet covered must be accepted for first-time `covers_ac` annotation — rejecting them breaks the normal authoring flow. The canonical fold (per R-001) remains the single source of truth for decision nodes; charter-declared ACs extend the valid set for `covers_ac` without relaxing the decision validation.
- **Fit criterion** — Given a motive whose charter (`motive.md`) declares `AC-1` and `AC-2`, and whose canonical fold contains AC node `AC-1` (from an `AC_COVERAGE` event) and decision node `D-1`:
  
  1. `ledger set <slice-id> --covers-ac "AC-999"` (not in charter, not in fold) exits nonzero and prints a diagnostic naming `covers_ac` and `AC-999`.
  2. `ledger set <slice-id> --decisions "D-999"` exits nonzero and prints a diagnostic naming `decisions` and `D-999`.
  3. `ledger set <slice-id> --covers-ac "AC-1"` (fold node) exits zero.
  4. `ledger set <slice-id> --covers-ac "AC-2"` (charter-declared, no fold node yet) exits zero.
  5. `ledger set <slice-id> --decisions "D-1"` exits zero.
  
  The diagnostic message is machine-readable enough for a human to identify which id is unknown and in which field.
- **Verification**: automated — Unit test: construct a synthetic fold with known node ids plus a charter declaring additional uncovered AC ids. Assert that a charter-only AC causes exit code 0. Assert that an unknown AC (not in charter, not in fold) causes exit code 1 with a diagnostic naming `covers_ac` and the id. Assert that an unknown decision id causes exit code 1 with a diagnostic naming `decisions` and the id.
- **Criticality**: must
