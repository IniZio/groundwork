---
name: reflect-project
description: Find what slowed agents down in this project (slow builds, tests that run red, waits inside workers) and fix the worst of it in the project's own files. Use after a merge wave, when a worker hand-back shows a check or wait over 2 minutes, when work in a repo feels slow or will not fan out, or for /reflect-project, "reflect on this project", "what slowed us down".
---

# Reflect on the project

This skill improves the project you are working in. It never edits a skill. Send a learning about how agents should work to the groundwork session, or tell the user to run `/reflect-newman-mode`.

Run it at most once per merge wave, and once per day without one, unless the user asks. Dispatch at most two fix workers per run. The fixes compete with feature work for the same host.

## 1. Measure

Run the script in this skill's folder against the main checkout, not a worktree:

```
python3 -I <this skill's folder>/scripts/slow_commands.py --days 3 "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
```

It reads the project's Claude Code transcripts and ranks shell commands by the agent wall time they cost. Read the `subagents:` line first. When it shows shell commands under 20% of subagent work time, say so and stop. The time is going somewhere this skill cannot see.

The output has three tables. The family table sums the command rows that share a program, so a family and its commands are the same minutes. The command table has one row per command. The last table lists tests that failed for three or more agents, one row per test module.

## 2. Pick

Take a row only when it passes one of these tests. Each test names the table it reads. Take every broken test, then the three largest other rows by `sub min` plus `lead min`. Never take a family together with one of its own commands. A family that passes both wait tests is one pick with two fixes.

| Test | Table | Kind |
| --- | --- | --- |
| A test listed there | Failed tests | Broken test |
| `wait loops`, `gh pr checks` or `gh run watch` at 2% or more in `% sub` | Family | Wait inside a worker |
| `wait loops`, `gh pr checks` or `gh run watch` at 2% or more in `% lead` | Family | Wait in the lead |
| 20 or more runs and `red %` of 50 or more | Command | Check that fails late |
| A median of 30 seconds or more, run by 10 or more agents | Command | Fixed cost per agent |
| 20 or more runs, a median of 5 seconds or more and a p90 above three times the median | Command | Contention or a cold start |

State the ceiling for each pick. It is the row's `% sub` value, or `% lead` for a wait in the lead, and the fix can save no more than that. Drop a pick under 2%. A broken test has no ceiling in the table, so state its agent and red-run counts.

A row with a high `cut` count ran longer than its time shows. A timeout stopped those runs, or the harness moved them to the background.

No row passes: report the top five rows and stop. Do not invent a fix.

## 3. Fix

Read a few of the real commands and their output in the transcripts before you choose a fix. The row gives the cost, not the cause.

| Kind | Fix to look for |
| --- | --- |
| Broken test | Many agents fail the same test, so the project is at fault, not their changes. Look first for an open PR or branch that already fixes it, and ask the user to merge that one. Otherwise reproduce it on the default branch inside an agent worktree, then fix the test or the code. Do this before any other pick, because it also inflates `red %` in the command rows. |
| Wait inside a worker | Read what the loops wait for. For CI or a remote run, the worker hands back when the PR is open or the run has started. The lead watches it in the background and dispatches a fresh worker only on red. For a job the worker started itself, the brief says to run it in the foreground under a timeout and never to poll it. A start-up script that returns before the service is ready gets a flag that blocks until ready. |
| Wait in the lead | The lead starts the watch in the background and keeps dispatching. It reads the result when the notification arrives. |
| Check that fails late | Read what the red runs printed first. Compile errors want a cheaper check that fails first, such as a type check or a compile-only target before the tests. Real test failures want a narrower test target. Add either as a named target in the Makefile or task runner. |
| Fixed cost per agent | A cache or warm state shared across worktrees, a narrower target, or a step that runs once per wave instead of once per worker. |
| Contention or a cold start | Fewer concurrent builds on the host, a shared build cache, or a pre-warmed copy for new worktrees. |

Put the fix where humans get it too: the Makefile, a script, CI config or the build config. Add a line to the project's `CLAUDE.md` or `AGENTS.md` only when the fix is a choice of command that no tool can make for the agent. A fix that needs a decision, a new dependency or a change to shared infrastructure goes to the user as a question with a recommendation.

Dispatch the two largest fixes that need a worker, each as its own worker with the row as evidence. Report the rest as left for the next run. A fix to how the lead briefs workers or runs its own waits needs no worker: apply it to the next brief or the next wait and say so.

## 4. Prove

Each fix reports the command's time before and after, from the same cold state on the same host, with the run count. A fix that changes what agents run is proved by this script's next run, so record the row (minutes, runs, median, red share) in the PR body as the baseline.

## Reply

- The `subagents:` and `leads:` lines and the picked rows, each with its ceiling.
- Each fix: dispatched, applied to briefs, or asked as a question.
- Rows that passed a test and were left for the next run.
