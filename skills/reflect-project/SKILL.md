---
name: reflect-project
description: Find what slowed agents down in this project (slow builds, tests that run red, waits inside workers) and fix the worst of it in the project's own files. Use after a merge wave, when a worker hand-back shows a check or wait over 2 minutes, when work in a repo feels slow or will not fan out, or for /reflect-project, "reflect on this project", "what slowed us down".
---

# Reflect on the project

This skill improves the project you are working in. It never edits a skill. Send a learning about how agents should work to the groundwork session, or tell the user to run `/reflect-newman-mode`.

Run it at most once per merge wave, and once per day without one, unless the user asks. Dispatch at most two fixes per run. The fixes compete with feature work for the same host.

## 1. Measure

Run the script in this skill's folder against the main checkout, not a worktree:

```
python3 -I <this skill's folder>/scripts/slow_commands.py --days 3 "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
```

It reads the project's Claude Code transcripts and ranks shell commands by the agent wall time they cost. Read the header line first. When shell commands are under 20% of subagent work time, say so and stop: the time is going somewhere this skill cannot see.

## 2. Pick

Take a row only when it passes one of these tests. Take the three largest by total minutes.

| Test | Kind |
| --- | --- |
| The `wait loops`, `gh pr` or `gh run` family above 2% in the `% work` column | Wait inside a worker |
| 20 or more runs and a red share of 50% or more | Check that fails late |
| A median of 30 seconds or more, run by 10 or more agents | Fixed cost per agent |
| A p90 above three times the median | Contention or a cold start |

State the ceiling for each pick. It is the row's `% work` value, and the fix can save no more than that. Drop a pick under 2%.

No row passes: report the top five rows and stop. Do not invent a fix.

## 3. Fix

Read a few of the real commands and their output in the transcripts before you choose a fix. The row gives the cost, not the cause.

| Kind | Fix to look for |
| --- | --- |
| Wait inside a worker | The worker hands back when the PR is open or the run has started. The lead watches CI or the run in the background and dispatches a fresh worker only on red. |
| Check that fails late | A cheaper check that fails first: a type check or compile-only target before the tests, or a narrower test target. Add it as a named target in the Makefile or task runner. |
| Fixed cost per agent | A cache or warm state shared across worktrees, a narrower target, or a step that runs once per wave instead of once per worker. |
| Contention or a cold start | Fewer concurrent builds on the host, a shared build cache, or a pre-warmed copy for new worktrees. |

Put the fix where humans get it too: the Makefile, a script, CI config or the build config. Add a line to the project's `CLAUDE.md` or `AGENTS.md` only when the fix is a choice of command that no tool can make for the agent. A fix that needs a decision, a new dependency or a change to shared infrastructure goes to the user as a question with a recommendation.

Dispatch each fix as its own worker with the row as evidence. A fix to how the lead briefs workers needs no worker: apply it to the next brief and say so.

## 4. Prove

Each fix reports the command's time before and after, from the same cold state on the same host, with the run count. A fix that changes what agents run is proved by this script's next run, so record the row (total minutes, runs, median, red share) in the PR body as the baseline.

## Reply

- The header line and the picked rows, each with its ceiling.
- Each fix: dispatched, applied to briefs, or asked as a question.
- Rows that passed a test and were left for the next run.
