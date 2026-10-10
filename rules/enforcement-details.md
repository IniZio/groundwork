# Enforcement details (agent-facing)

Human summary: `doc/enforcement-scope.md`.

## Deployed-path evidence

- Any claim that a hook fires in a real session needs a run through `scripts/proof-harness.sh`. See `rules/proof-harness.md` and `doc/proof-harness.md`.
- `--plugin-dir` silently drops plugins that declare `dependencies`. Never use it as evidence. `doc/proof-harness.md` has the differential and the required install path.

## stop-gate

- Sidecar counter file: `.groundwork/stop-gate.<session_id>.count`.
- Attempt 1-2: normal block message naming `gw slice complete <id>` and `gw hold set`.

## Working tier

- `$GW recipe` prints the working-tier block. It places units under `.groundwork/work/<slug>/`.

## Decision D-21 (no orchestrator write-guard)

- Eval: 8 shipped-path runs. Condition A: 0 orchestrator Write/Edit calls. Condition B: 1 of 8. Fisher exact p ~ 1.0.
- The eval is not the basis for the decision.

## Reinstate triggers

- comment-restate: restatement recurs as a measurable regression across multiple motives.
- broader slop patterns: mid-sentence filler survives at a rate that hurts plan or agent output.

## Intent-gate dispatch refusal (spawn-model-guard)

- Source: `src/hooks/spawn-model-guard.ts` (`INTENT_GATED`, `intentRefusal`); message built by `refusalMessage` in `src/cli/gate-status.ts`.
- Denies spawning `groundwork:implementer`, `groundwork:junior-orchestrator`, `groundwork:designer`.
- Applies while the active motive's intent gates apply (`doc/<slug>/motive.md` or `doc/<slug>/spec.md` exists) and H1 (charter) or H2 (spec) approval is missing or void.
- Message starts `intent gate: implementation dispatch refused — `.
- Fails open: no `.groundwork/work.db`, no project dir, or any error → allow.
