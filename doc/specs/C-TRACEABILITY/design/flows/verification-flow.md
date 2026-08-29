---
title: "Verification Flow"
concept: "[[C-TRACEABILITY/index]]"
status: "draft"
date_updated: "2026-08-29"
---

# Verification Flow

How a spec requirement travels from `open` to mechanically verified in groundwork.

## Steps

### 1. Requirement authored
A requirement is written in `doc/specs/<concept>/constraints.md` with a unique ID (e.g. `TRACEABILITY-R-002`). It carries a `criticality`, `verification` method, and optionally an `origin_decision_ref` that links it to a journal decision.

### 2. Slice links the requirement
When a ledger slice is created or updated, the implementer declares which requirements it covers:
- Via `--covers-ac "TRACEABILITY-R-002"` on `bin/ledger add` (explicit AC coverage), or
- Via `--decisions "tracking-viz#D-7"` when the requirement's `origin_decision_ref` matches

The SpineAdapter reads these fields to emit `covers` edges.

### 3. Test annotates the requirement
A test file in `test/` carries a `@verifies` annotation:

```ts
// @verifies TRACEABILITY-R-002
it('assembler includes all node types', () => { … })
```

`verifies-scan.mjs` walks `test/` and `tests/` to collect these annotations. The adapter uses them to emit `confirms` edges.

### 4. Verification event recorded
When live verification passes (a screenshot, artifact URL, or CLI output is captured), a VERIFICATION journal event is appended. The event carries:
- The artifact reference (URL or file path)
- The build/data hash at capture time

The adapter reads VERIFICATION events to emit `live-verify` and `artifact-evidence` nodes.

### 5. Gate verdict recorded
The orchestrator runs `bin/ledger gate advisor APPROVE --token <token>` after the advisor issues an APPROVE verdict. This writes a GATE event to the journal.

The adapter reads GATE events to emit `gate` nodes and `seals` edges.

### 6. Assembler produces the chain
The traceability graph assembler calls `NativeSpineAdapter` methods:
- `getSlices()` → slice nodes + `covers` edges
- `getVerificationEvents()` → `live-verify` + `artifact-evidence` nodes
- `getGateEvents()` → `gate` nodes + `seals` edges
- `getSpecRequirements()` → `spec-req` nodes

It classifies every edge (proven/unproven/stale/missing) and serializes the result deterministically.

### 7. Render surfaces display the chain

Two surfaces consume the assembled graph:
- **Ambient file**: auto-regenerated on demand, written to a known path under `.groundwork/`
- **Interactive live view**: served HTML with wave-band topology and semantic edge styling (D-9)

Both surfaces display link classification visibly, satisfying TRACEABILITY-R-003.

## Diagram

Not derivable from current source — the render surface implementation is not yet present in the codebase.
