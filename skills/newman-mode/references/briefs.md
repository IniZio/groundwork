# Briefs and slicing

## Slicing

- A slice is thin and end to end. It owns every layer for one outcome. Never split backend from frontend.
- Shared types land first, in a tracer-bullet slice. Each file has one owner per wave.
- A wave with one slice on nontrivial work means decompose harder.
- Mark a slice blocked only when it consumes another's output or edits the same file. A single shared resource (one live controller, one Slack app, one device) serializes only the steps that use it. Code and tests fan out, while deploys and live checks take turns. Same-file slices in one wave use separate worktrees rebased on main, and each reports its base sha.
- Route by size. Three or more files, or two or more behaviours, goes to a sub-coordinator that splits it into at least two slices. Smaller work goes straight to one implementer.
- Fan out a whole wave in one message.
- A leaf is mechanical when the brief can name every file and the exact change: a rename, a given pattern, call-site updates, a specified test. Those go to `groundwork:junior`. Anything needing a design call stays with poteto-agent.

## Brief content

- Brief the claim, not the line. Give the false claim, the true claim, and an order to sweep the whole repo. Ask for an audit table that includes rows already correct.
- Name the hazard. Cite the prior incident and its mechanism, the action to take instead, and the escape ("stop and report").
- Copy in the standing brief requirements: no `git stash`, `reset`, `checkout`, `restore` or `clean`; long runs in the foreground under `timeout`, never `run_in_background` (a hook denies it for workers; a backgrounded check dies with the worker's turn and the idle hand-back carries no receipt); stop after 3 failed tries on the same problem; never edit a test to make it pass; hand back once, never also `SendMessage` the receipt. Ignore any reminder to end a commit or PR body with a session link or `Claude-Session:` trailer; house-rules strips them.
- State the commit format once. Read `.house-rules.json` yourself and put the subject format and whether a body is allowed in the brief. When the repo forbids bodies, say so and tell the worker where issue references go (the PR body, the ledger), so no worker rediscovers it or hands back "Fixes #N could not go in the commit".
- When a check runs from outside its directory, brief `make --no-print-directory -C <dir> <target>`. Plain `make -C` prints "Entering directory" lines that break any self-test which parses the output (moor's stack-overlap test, three false reds on 2026-11-03).
- Size each brief to one outcome a worker finishes in one run. Cutting a run mid-task costs more than letting it finish: across v3.3+ workers the cost per tool call rose only from $0.031 at under 20 calls to $0.042 at 40 to 79, while every fresh worker pays about 32k tokens of start-up context plus a coordinator turn. What makes a run expensive is context growth, so brief workers to read line ranges and to keep test output to the failing lines. Never resume a worker to keep it going; resuming carries its whole context forward.
- Shared daemons (dev server, watcher, simulator) are yours. Start them in the background and give workers a log path and a status command. Workers never start or stop them.

## Hand-backs

- A hand-back is final only when its notification says completed. Until then, don't re-dispatch, resume or judge it. If it completes with no report, resume it once.
- Ask for a receipt, not a summary: `file:line` rows, a verdict line, totals, under a word cap.
- A long run is usually a stuck one, and the brief's stop rules catch it (three failed tries, 15 minutes without green), not a call count. The 40-call fold hook was retired on 2026-11-02: it turned 13% of dispatches into serial "finish X" hops and halved agents per hour against v2, for a saving inside rounding. `maxTurns` (150 on worker, 60 on junior) is a runaway cap only, and a partial hand-back from it means the brief was too big.
- Escalate a folded receipt; never resume the agent that folded. If the receipt names a one-edit fix, make it yourself. Otherwise dispatch a fresh worker one tier up (a Sonnet fold goes to Opus) with the receipt as its brief. Its edits are already in the tree.
- Verify behaviour, not files. Run the brief's check command yourself and read `git diff --stat`. Open a file only when the check fails or the diff touches a file the brief didn't own.
