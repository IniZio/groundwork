# Vertical-Slice Failure Modes

Six named causal chains from observed incidents.

## fence-slices-by-file-not-ac

Slices fenced by AC (not file ownership) on a shared decision tree leave views unowned. Nobody was assigned the component both ACs touch. Fix: fence by file, not AC.

## ledger-cannot-see-missing-slices

Ledger verifies only registered slices. A forgotten obligation reads N/N complete at gate time. Fix: enumerate ALL impacted files before writing the ledger.

## green-slices-broken-seam

Two-surface contract drifts while both sides stay green. Slice-local tests cannot see the seam (module boundary where responsibilities end and callers begin). Fix: write a cross-slice parity test on the shared contract.

## pipeline-stage-insertion-moves-wiring

Inserting a pipeline stage is not a phrasing edit. Downstream handoff and resource ownership must move too. Grep cannot see dynamic dispatch. Fix: trace the whole call path before assigning ownership.

## redgreen-perturbation-destroys-sibling-work

Perturbing real files to produce a red→green proof silently destroys uncommitted sibling work on that file. Fix: commit every verified wave before starting a perturbation proof.

## agent-git-stash-destroys-run

Prose banning `git stash` in briefs does not prevent it. An agent running `git stash` reverts all prior uncommitted wave work. Fix: commit every verified wave before dispatching the next.
