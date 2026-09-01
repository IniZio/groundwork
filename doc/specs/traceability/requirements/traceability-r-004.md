---
id: "traceability-r-004"
type: requirement
concept: C-TRACEABILITY
title: "Mechanical links are deterministic"
criticality: must
verification: unverified
status: open
---

## TRACEABILITY-R-004 — Mechanical links are deterministic {#traceability-r-004}

The traceability graph assembler **shall** be a pure function of its input data: given the same ledger slices, journal events, spec requirements, and doc/specs/_generated/coverage.json, it **shall** produce byte-for-byte identical node and edge sets on every invocation, with no timestamps, random ids, or nondeterministic ordering.

- **Why** — Nondeterministic output makes it impossible to diff two regenerations and detect what changed. It also means two viewers of the same motive may see different graphs, breaking the "same input yields same output" contract required by AC-4.
- **Fit criterion** — Running the assembler twice against the same frozen inputs (ledger snapshot, journal snapshot, doc/specs/_generated/coverage.json snapshot) produces identical JSON output both times; diffing the two outputs reports no differences.
- **Verification**: unverified — Automated test asserting deterministic output:
  1. Freeze a set of inputs: ledger slice list, journal event list, spec requirements, doc/specs/_generated/coverage.json.
  2. Run the graph assembler against those frozen inputs twice in succession.
  3. Serialize both outputs to JSON with stable key ordering.
  4. Assert the two outputs are byte-for-byte identical (deep-equal or string comparison).
  5. Test must carry `// @verifies TRACEABILITY-R-004`.
- **Criticality**: must
