---
name: implement
description: Fan-out implementation protocol with ledger tracking. Supersedes mattpocock-skills:implement by adding gw slice ledger and stop-gate integration.
---

<!-- token-target: ≤377 -->

## When to use

Feature work: ≥3 files OR ≥2 behaviors OR large verification surface. For simpler work, delegate directly to `groundwork:implementer`.

## Protocol

1. Run `$GW init` → prints `token: T` on first run only. Capture T for this session; store nowhere persistent. On resume use `$GW token`.
2. Decompose into vertical slices (load `/vertical-slice` for non-trivial fan-out).
   Each slice: single domain, independent, owns its files exclusively.
3. Add slices: `$GW slice add <id> --desc "..." --wave N --blocked-by <deps> --acceptance "crit1;crit2" --token T`
4. Emit banner: `GROUNDWORK ▸ <N> slices, <M> waves → token: T`
5. Fan out in ONE message. Route each slice by size:
   - Multi-file (≥3 files or ≥2 behaviors) → `groundwork:junior-orchestrator`
   - Leaf (≤2 files, one behavior) → `groundwork:implementer`
   Use brief template (`reference/brief-template.md`). Never pass token T to children.
   Orchestrator marks slices complete.
6. As waves complete: verify receipts (bite proof required, not argued).
   Run full suite + `bunx tsc --noEmit`, then `$GW slice complete <id> --token T`.
   Commit before next wave.
7. Completion gate: `[groundwork:qa if UI] → groundwork:advisor` → APPROVE
   → `$GW gate approve --citation "file:line" --token T`

## Worktree fallback

Slices in one wave that edit the same file run with `Agent({ isolation: "worktree" })`.
A worktree branches from the pushed base, not local HEAD; the brief's first step is `git rebase main`.
Receipt reports the base sha (`git rev-parse HEAD` after rebase).
Orchestrator checks `git merge-base <branch> main` equals that sha before merging.
Merge branches after wave, run full suite.
Hard-size-limit files (e.g. `agents/orchestrator.md`) get one owner per wave.

## Separate-session dispatch

For a slice sent to another session in an isolated tree (another Claude session, sandbox, `claude -p` in a worktree):

1. Before dispatch, on the host: `$GW scope link <tree> --slice S --mode delegate --token T`.
   Use `--mode direct` when the host verifies before merging; after verifying, run
   `$GW scope verify --slice S --citation file:line --token T`.
2. Delegate brief's first child step: run `$GW init` in the tree.
3. `$GW slice complete S` refuses until child approval (delegate) or host verification (direct) is recorded.
   Read the refusal and act on it.
4. Abandoned child: link a fresh tree, or `$GW scope unlink --slice S --reason "..." --token T`.

`Agent({ isolation: "worktree" })` subagents are exempt: subagents cannot run `$GW init`
(store-write-guard denies it) and stay in the host ledger.

## Upstream coverage

For interview/planning: `mattpocock-skills:grilling`.
For tickets: tell user to run `/to-tickets` (model can't invoke it),
then run `/vertical-slice` yourself without asking.
For TDD: `mattpocock-skills:tdd`.
For research: `mattpocock-skills:research`.
For arch review: `mattpocock-skills:codebase-design`.
