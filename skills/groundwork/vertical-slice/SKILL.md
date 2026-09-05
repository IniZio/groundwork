---
name: vertical-slice
description: Decompose a task into conflict-free parallel slices, one file owned by exactly one slice per wave. Writes a run ledger when the host supports one.
---

# Vertical-Slice Decomposition

A vertical slice is a **thin end-to-end behavior** cutting through all layers (types → logic → surface → test) for ONE user-facing outcome. It is independently testable and independently delegatable.

## When to use

Mandatory for any task touching ≥3 files OR ≥2 user-facing behaviors OR a large verification surface (real hardware; multi-service or non-trivial live environment; >5 QA scenarios; ≥2 platforms or clients). Skip only when ALL of: ≤2 files AND ≤1 behavior AND <1h AND small verification surface.

Chain: `feature-interview → planner` produces a `motive_ref`; this skill runs next; `plan-review` audits coverage before fan-out.

## Decomposition

1. **List user-facing behaviors** — each observable outcome is one candidate slice.
2. **Identify the tracer bullet** — the simplest behavior exercising every layer; becomes Wave 0.
3. **Map file ownership per slice** — one file, one owner per wave. Resolve conflicts by merging slices, serializing into separate waves, or splitting the file.
4. **Assign waves by dependency** — Wave 0: tracer; Wave N: slices whose blockers are all complete. Make each wave as wide as the DAG permits.
5. **Write the slice table**: Slice | Behavior | Files Owned | Wave | Depends On.

For ledger CLI flag reference and schema: `bin/ledger help`.

## Conflict-free rules

<!-- VERTICAL-SLICE-GATE:BEGIN -->
A vertical slice is a thin end-to-end behavior cutting through all layers (types → logic → surface → test) for ONE outcome. Each file is owned by exactly ONE slice per wave — no shared ownership across siblings.

Shared types needed by multiple slices MUST be defined in the tracer-bullet (first) slice; all slices that depend on those types list the tracer-bullet in `blocked_by` and do not re-define them.

- Test files: each slice owns its own test file; shared harness/fixtures go in Wave 0.
- Generated or schema files: treat as a single-owner file, serialize in Wave 0.

Single-slice waves on non-trivial work are a failure mode — they mean the domain was not decomposed. If you find yourself authoring only one slice, reconsider whether genuine parallelism exists before proceeding.
<!-- VERTICAL-SLICE-GATE:END -->

## Ledger write contract

Each slice carries: `id`, `behavior`, `files`, `wave`, `blocked_by`, `acceptance`, `status`, `kind` (`plan|diagnose|design|impl`, default `impl`), `ticket`, `covers_ac`, `decisions`. Write the ledger once with all slices `pending`; mutate only via the ledger CLI after that.

`blocked_by` is valid when the blocking slice creates a file, type, or artifact the blocked slice must import or execute against. Sequencing preference or a shared-file concern resolvable by splitting ownership is not a valid edge.

`tickets/` is never deleted by tooling. `open-items/` is swept on regeneration — do not place durable work objects there.

## Worktree conflict-fallback

When two slices genuinely overlap on file ownership and serializing would sacrifice real parallel width, the orchestrator may dispatch each via `Task(..., isolation:"worktree")`. Precondition: clean working tree before dispatch. Reconcile after the wave by merging highest-collision branch first, then `git worktree remove --force` and `git worktree prune`. This is a fallback — disjoint file ownership per wave remains the default.

## Rejection KB

Record rejected-scope concepts in `.groundwork/out-of-scope/<concept-slug>.md`. See `reference/rejection-kb.md` for the template and format.

## Failure modes

Six named failure modes from observed incidents. Full causal chain and correction in `reference/failure-modes.md`.

- **fence-slices-by-file-not-ac**: AC-fenced slices on a shared decision tree break the views nobody was assigned.
- **ledger-cannot-see-missing-slices**: the ledger verifies only registered slices; a forgotten obligation reads as N/N complete.
- **green-slices-broken-seam**: a two-surface contract drifts while both sides stay green; slice-local tests cannot see the seam.
- **pipeline-stage-insertion-moves-wiring**: inserting a pipeline stage is not a phrasing edit; downstream handoff and resource ownership must move too.
- **redgreen-perturbation-destroys-sibling-work**: perturbing real files for a red→green proof silently destroys uncommitted sibling work on that file.
- **agent-git-stash-destroys-run**: prose banning `git stash` in briefs does not prevent it; commit every verified wave.
