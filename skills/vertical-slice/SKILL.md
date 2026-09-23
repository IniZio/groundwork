---
name: vertical-slice
description: Decompose a feature into conflict-free vertical slices and register them in the gw ledger.
---

<!-- token-target: ≤406 (v1 vertical-slice skill was 1217 tokens; 1/3 = 406) -->

## What is a vertical slice

Thin end-to-end behavior cutting through all layers (types→logic→surface→test) for ONE outcome.
Each file is owned by exactly ONE slice per wave. Shared types go in Wave 0 (tracer bullet)
so parallel implementers never race on an undefined type.

## Decomposition rules

- Single-slice wave on non-trivial work = failure. Decompose harder.
- Slice owns ALL layers for its behavior — not split by layer (no "backend slice" + "frontend slice" for the same feature).
- Acceptance criteria: string[] of verifiable done-conditions, written before implementation starts.
- Blocked-by: the dependency slice id that must complete first. Only add when one slice consumes another's output or edits the same file.

## Registration

```
$GW init                                  # get token T
$GW slice add S0 --desc "tracer bullet: shared types" --wave 0 --acceptance "types compile" --token T
$GW slice add S1 --desc "..." --wave 1 --blocked-by S0 --acceptance "..." --token T
$GW slice add S2 --desc "..." --wave 1 --blocked-by S0 --acceptance "..." --token T
```

## Wave template

```
Wave 0: tracer bullet (1–2 slices) — shared types, E2E path proof
Wave 1: parallel implementation — one implementer per slice
Wave 2: verification — [qa] → advisor → APPROVE
```

## Failure modes

Six named causal chains — full details in `reference/failure-modes.md`:

- **fence-slices-by-file-not-ac** — AC-fenced slices on shared decision tree leave views unowned.
- **ledger-cannot-see-missing-slices** — forgotten obligation reads N/N complete at gate time.
- **green-slices-broken-seam** — two-surface contract drifts while both sides stay green.
- **pipeline-stage-insertion-moves-wiring** — inserting a stage moves downstream handoff + ownership.
- **redgreen-perturbation-destroys-sibling-work** — perturbation proof silently destroys uncommitted sibling work.
- **agent-git-stash-destroys-run** — prose banning `git stash` in briefs does not prevent it.
