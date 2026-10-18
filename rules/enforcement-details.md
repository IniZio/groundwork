# Enforcement details (agent-facing)

Human summary: `doc/enforcement-scope.md`.

## Deployed-path evidence

- Any claim that a hook fires in a real session needs a run through `scripts/proof-harness.sh`. See `rules/proof-harness.md` and `doc/proof-harness.md`.
- `--plugin-dir` silently drops plugins that declare `dependencies`. Never use it as evidence. `doc/proof-harness.md` has the differential and the required install path.

## stop-gate

- Sidecar counter file: `.groundwork/stop-gate.<session_id>.count`.
- Attempt 1-2: normal block message naming `gw slice complete <id>` and `gw hold set`.
- Budget block: an Agent prompt may start with `budget: <N>m` on its first line (default 15). When a running background child exceeds it, Stop blocks with the task, elapsed minutes and budget. It clears only on `$GW event append --type BUDGET --data '{"task":"<id or description>","action":"stop"|"extend","minutes":N,"reason":"<measured reason>"}'`. `extend` adds N minutes once per task; after that only `stop` clears it. The 4-block release does not apply. SubagentStop is not budget-gated.

## slow-command-timeout-guard

- PreToolUse Bash. Denies a foreground call to `moor start|run|close`, `crabbox warmup|run`, `docker build`, `npx agent37`, `ssh`, `scp`, or a `while`/`until` loop with `sleep` or `pgrep`.
- Allowed when the call uses run_in_background or is wrapped in `timeout <dur>`. Wrap it in `timeout 600 …`, or run it in the background with a Monitor until-condition.

## Working tier

- `$GW recipe` prints the working-tier block. It places units under `.groundwork/work/<slug>/`.

## Decision D-21 (no orchestrator write-guard)

- Eval: 8 shipped-path runs. Condition A: 0 orchestrator Write/Edit calls. Condition B: 1 of 8. Fisher exact p ~ 1.0.
- The eval is not the basis for the decision.

## Reinstate triggers

- comment-restate: restatement recurs as a measurable regression across multiple motives.
- broader slop patterns: mid-sentence filler survives at a rate that hurts plan or agent output.

