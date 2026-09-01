---
title: "Recipe: Link a Slice to a Requirement"
concept: "[[traceability/index]]"
status: "draft"
date_updated: "2026-08-29"
---

# Recipe: Link a Slice to a Requirement

Two mechanisms connect a ledger slice to a spec requirement. Use direct linkage when possible; fall back to decision-mediated when the requirement predates the slice schema.

## Option A — Direct: `--covers-ac`

When the requirement ID is known at slice creation time, declare it explicitly:

```bash
gw ledger add --motive <slug> S3 \
  --wave 1 \
  --desc "Implement graph assembler node types" \
  --covers-ac "TRACEABILITY-R-002,TRACEABILITY-R-004" \
  --decisions "tracking-viz#D-7"
```

The `covers_ac` field on the slice is read by `NativeSpineAdapter.getSlices()` and emitted as `covers` edges in the assembled graph.

To update an existing slice:

```bash
gw ledger set --motive <slug> S3 --covers-ac "TRACEABILITY-R-002,TRACEABILITY-R-004"
```

## Option B — Decision-mediated: `--decisions`

If the requirement carries an `origin_decision_ref` (e.g. `tracking-viz#D-7`), and the slice declares the same decision:

```bash
gw ledger add --motive <slug> S3 --decisions "tracking-viz#D-7"
```

The adapter cross-joins `slice.decisions` against `requirement.origin_decision_ref` via `doc/specs/_generated/coverage.json`. This path is coarse (one slice may cover multiple requirements sharing the same decision ref) and labeled as decision-mediated in the graph.

Prefer `--covers-ac` for precision; use `--decisions` only when the requirement set is not known at slice authoring time.

## Adding `@verifies` to a test

To emit a `confirms` edge from a test file to a requirement, add the annotation anywhere in the test file (comment or string):

```ts
// @verifies TRACEABILITY-R-002
describe('graph assembler', () => {
  it('includes all required node types', () => { … })
})
```

A single annotation line may cover multiple requirements:

```ts
// @verifies TRACEABILITY-R-004, TRACEABILITY-R-005
```

`verifies-scan.mjs` walks `test/` and `tests/` for these annotations. No other registration is needed.

## Adding `test_paths` to a slice (direct self-test linkage)

For the most precise linkage, set `test_paths` on the slice:

```bash
gw ledger set --motive <slug> S3 --test-paths "test/hooks/traceability-assembler.test.ts"
```

This emits a direct `confirms` edge without requiring the decision-mediated cross-join.

## Verification

After linking, inspect the slice:

```bash
gw ledger show --motive <slug> S3
```

Confirm `covers_ac`, `decisions`, and (if set) `test_paths` are present. The traceability assembler will pick them up on next regeneration.
