# Briefs and slicing

## Slicing

- A slice is thin and end to end. It owns every layer for one outcome. Never split backend from frontend.
- Shared types land first, in a tracer-bullet slice. Each file has one owner per wave.
- A wave with one slice on nontrivial work means decompose harder.
- Mark a slice blocked only when it consumes another's output or edits the same file. Same-file slices in one wave use separate worktrees rebased on main, and each reports its base sha.
- Route by size. Three or more files, or two or more behaviours, goes to a sub-coordinator that splits it into at least two slices. Smaller work goes straight to one implementer.
- Fan out a whole wave in one message.
- A leaf is mechanical when the brief can name every file and the exact change: a rename, a given pattern, call-site updates, a specified test. Those go to `groundwork:junior`. Anything needing a design call stays with poteto-agent.

## Brief content

- Brief the claim, not the line. Give the false claim, the true claim, and an order to sweep the whole repo. Ask for an audit table that includes rows already correct.
- Name the hazard. Cite the prior incident and its mechanism, the action to take instead, and the escape ("stop and report").
- Copy in the standing brief requirements: no `git stash`, `reset`, `checkout`, `restore` or `clean`; long runs in the foreground under `timeout`; stop after 3 failed tries on the same problem; never edit a test to make it pass; hand back by about 40 tool calls.
- Size each brief to finish in about 40 tool calls. A worker that reaches 40 hands back what is done and what remains, and you dispatch the rest fresh. Every turn re-reads the whole context. Never resume a worker to keep it going; resuming carries its whole context forward. In moor the poteto-agents that ran past 55 calls at about 100k context cost 40% of all tokens.
- Shared daemons (dev server, watcher, simulator) are yours. Start them in the background and give workers a log path and a status command. Workers never start or stop them.

## Hand-backs

- A hand-back is final only when its notification says completed. Until then, don't re-dispatch, resume or judge it. If it completes with no report, resume it once.
- Ask for a receipt, not a summary: `file:line` rows, a verdict line, totals, under a word cap.
