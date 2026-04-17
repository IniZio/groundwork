---
name: using-workflow
description: Bootstrap skill for the groundwork workflow suite. Loaded at every conversation start. Establishes core rules and lists all available skills with triggers. ALWAYS load this first.
---

# Using Groundwork Workflow

**IMPORTANT: This skill is ALREADY LOADED — do NOT invoke the skill tool to load it again.**

## Core Rules (Non-Negotiable)

1. **Always use `question` tool** instead of ending the conversation. Never leave the user without a next step.
2. **ALWAYS use `background_task` instead of `task` or `delegate`.** Never call the `task` or `delegate` tools. For ALL subagent work — exploration, coding, research, parallel tasks — use `background_task`. Then use `background_list` to monitor progress and `background_output` to retrieve results after `<system-reminder>` notification. The ONLY exception: if you absolutely must block until the result arrives before proceeding, use `delegate` as a last resort.
3. **No worktrees.** For new work, continue in the same session OR offer `/handoff` via `session-continue` skill. User chooses.
4. **Never commit PRDs** to git. Spec docs live in `docs/` but are never staged.
5. **Advisor nod required before declaring done.** Always invoke the `advisor-gate` completion gate before telling the user a task is complete.
6. **No self-review.** Use `advisor` subagent via `background_task` for any technical uncertainty, not internal reasoning loops.
7. **BDD over unit tests for UI.** For any visible UI change or bug, validate with actual visual inspection (XCUITest, Playwright) before and after — not just code assertions.
8. **Use PTY tools for long-running and interactive commands.** Never use `bash` for commands that serve, watch, or require interactive input. Use `pty_spawn`/`pty_write`/`pty_read`/`pty_kill` instead. Examples that MUST use PTY: `npm run dev`, `npm start`, `yarn dev`, `docker-compose up`, `docker compose up`, `make watch`, any `--watch` flag, `git rebase -i`, `git add -p`, `vim`, `less`, `top`, `ssh`. Rule of thumb: if the command doesn't exit on its own within ~5 seconds, use PTY.
9. **Prefer watch/follow variants of commands** when available, now that PTY makes it practical. Examples: use `gh pr checks --watch` instead of polling `gh pr checks`; use `jest --watch` instead of one-shot `jest`; use `kubectl get pods --watch` instead of repeated calls. If a CLI tool has a `--watch`, `--follow`, `-f`, or `--tail` flag, prefer it over running the command repeatedly.
10. **Use `/handoff` for session transitions.** When context gets long or a fresh session is needed, use `/handoff` — it creates a focused continuation prompt with file references auto-loaded. The new session can read the source transcript via `read_session`.

## Background Task Quick Reference

```
background_task(description="...", prompt="...", agent="explore")  → Launch
background_list()                                                    → Check status (like pty_list)
background_output(task_id="bg_xxx")                                  → Get result (after notification)
background_cancel(task_id="bg_xxx")                                  → Cancel one
background_cancel(all=true)                                          → Cancel all
```

**Workflow:**
1. Launch with `background_task`
2. Continue working — do NOT poll
3. When `<system-reminder>` notification arrives, call `background_output`
4. You can launch MULTIPLE tasks in parallel for max throughput

## Skill Triggers

Invoke the relevant skill tool BEFORE any response or action. 1% chance = invoke it.

| Skill | Invoke when... |
|-------|----------------|
| `advisor-gate` | Any technical decision with uncertainty; ALWAYS at task completion for finishness gate |
| `bdd-implement` | Any bug fix, UI change, or feature involving visible UI (macOS, web) |
| `nested-prd` | Master plan needs significant change during implementation; scope creep detected |
| `consolidate-docs` | Cleaning up PRDs after iterations; preparing for handoff or release |
| `session-continue` | Context window growing long; user wants fresh session; losing track of earlier context |
| `commit` | Creating git commits (ensures consistent style) |
| `opencode-acp` | Controlling another OpenCode instance via ACP protocol |

## What NOT to Do

- **NEVER call `task` or `delegate` — always use `background_task` instead**
- Do not use worktrees (`git worktree add` etc.)
- Do not commit PRD or spec markdown files
- Do not declare "done" without advisor completion gate
- Do not end the conversation — use `question` tool to keep going
- Do not run self-review in place of advisor escalation
- Do not use `bash` for long-running/interactive commands — use `pty_spawn` and friends
- Do not poll `background_output` — wait for `<system-reminder>` notification

## Skill Invocation Pattern

```
digraph flow {
  "User message" -> "Check: does any groundwork skill apply?";
  "Check: does any groundwork skill apply?" -> "Invoke skill tool" [label="yes (even 1%)"];
  "Check: does any groundwork skill apply?" -> "Proceed" [label="definitely not"];
  "Invoke skill tool" -> "Follow skill exactly";
  "Follow skill exactly" -> "advisor-gate completion gate";
  "advisor-gate completion gate" -> "Get APPROVE";
  "Get APPROVE" -> "Use question tool to present result";
}
```

Base directory for this skill: file:///Users/newman/.config/opencode/skills/groundwork/using-workflow
