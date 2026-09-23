---
name: implement
description: Fan-out implementation protocol with ledger tracking. Supersedes mattpocock-skills:implement by adding gw slice ledger and stop-gate integration.
---

<!-- token-target: ≤377 (v1 implement skill was 1131 tokens; 1/3 = 377) -->

## When to use

Feature work: ≥3 files OR ≥2 behaviors OR large verification surface. For simpler work, delegate directly to `groundwork:implementer`.

## Protocol

1. Run `$GW init` → capture write token T.
2. Decompose into vertical slices (load `/vertical-slice` for non-trivial fan-out).
   Each slice: single domain, independent, owns its files exclusively.
3. Add slices: `$GW slice add <id> --desc "..." --wave N --blocked-by <deps> --acceptance "crit1;crit2" --token T`
4. Emit banner: `GROUNDWORK ▸ <N> slices, <M> waves → token: T`
5. Fan out: one `groundwork:implementer` per leaf slice in ONE message.
   Use brief template (`reference/brief-template.md`). Never pass token T to implementers.
   Orchestrator marks slices complete.
6. As waves complete: verify receipts (bite proof required, not argued).
   Run full suite + `bunx tsc --noEmit`, then `$GW slice complete <id> --token T`.
   Commit before next wave.
7. Completion gate: `[groundwork:qa if UI] → groundwork:advisor` → APPROVE
   → `$GW gate approve --citation "file:line" --token T`

## Worktree fallback

Slices in one wave that edit the same file run with `Agent({ isolation: "worktree" })`.
Merge branches after wave, run full suite.
Hard-size-limit files (e.g. `agents/orchestrator.md`) get one owner per wave.

## Upstream coverage

For interview/planning: `mattpocock-skills:grilling`.
For tickets: tell user to run `/to-tickets` (model can't invoke it),
then run `/vertical-slice` yourself without asking.
For TDD: `mattpocock-skills:tdd`.
For research: `mattpocock-skills:research`.
For arch review: `mattpocock-skills:codebase-design`.
