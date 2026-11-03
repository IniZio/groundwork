---
name: newman-mode
description: "Newman's working conventions: numbered decisions, act through to the milestone, reuse before building, reviewer-facing prose, proof that can fail, time-boxed agents, stacked PRs. Use for Newman, /newman-mode, or requests to work in Newman's style."
disable-model-invocation: true
allowed-tools: Bash(bun "${CLAUDE_PLUGIN_ROOT}/scripts/poteto-mode.ts" "${CLAUDE_PLUGIN_ROOT}")
---

# Newman mode

This file layers on pstack's poteto-mode, loaded in full under "Base: poteto-mode" at the end. Where the two conflict, this file wins. Read the reference files below when their trigger fires.

| Trigger | File |
| --- | --- |
| Writing a PR body, `doc/` page, README or commit | `references/human-prose.md` |
| Claiming a test, check or fix works, or reviewing a worker's claim | `references/proof.md` |
| Briefing, slicing or dispatching subagents | `references/briefs.md` |
| Creating a Rust or Go project, or setting up its lint, format or CI | `playbooks/<lang>-project.md` |
| A stack merged, disk above 80%, or asked to clean up worktrees | `playbooks/worktree-cleanup.md` |

## Questions and replies

- Record every question for the user with `mcp__groundwork__ask` (question, recommended answer, `source`: your agent name or `lead`), because prose questions get buried under Monitor events and hand-backs. It shows above the prompt with one-click answers, so don't wait: keep working on what it doesn't block. Never act on a recommended default that touches a live resource or credentials until the user answers. End the reply with each as `#N <question>? Recommend: <answer>` and `Open: #12, #15`, so the user can answer "#12 y". Never re-ask one in prose. Relay a subagent's question through the same tool with its name as `source`. The `question-ledger` Stop hook blocks a reply that asks without recording. Without the tool, use a numbered list with a recommendation each.
- Only ask what a word can answer. If the user replies "elaborate", the question was unclear. Restate it with the concrete tradeoff.
- Give the exact command or value, not a pointer to where to find it.
- Show plans and specs as flows and diagrams with few words. When alignment is in doubt, produce a concrete artifact (a spec, a throwaway prototype, a draft PR) rather than asking more questions.
- When steering repeats across several turns, stop and write a spec that settles the open points.
- Before a multi-session effort, write its charter (objective, decisions with a one-line reason each, open questions) into a committed spec, issue or PR, and link it. Reply text gets lost. If you can't post it, record that as a question. Interview first if the objective is unclear.
- Fold Monitor status (stream lost, reconnected) into the next substantive reply unless it changes what the user should do.

## Autonomy

- After a plan is approved ("go", "proceed", "yes start"), run it to the milestone. Commit, push, open PRs and restack without checking in.
- Read a user's order ("1 first, then 3 and 4") as priority, not dependency. On start or resume, check the whole list before deep-diving item 1. For each pair of items, look for shared files, symbols, an open design call or a single live resource, and state the result in one line. Start every item with no overlap in the same wave. Announce it ("starting 2 and 3 in parallel; say stop if not") and go. Never ask whether to start independent work, because a queue the user didn't ask for wastes their time.
- Stop only at stop points the user named ("stop at a local commit", "then /pause"). Use the pstack pause flow when asked to pause. The handoff lists next actions by priority, each with `blocked by:` (an item, a file, a shared resource, or `none`), and quotes the user's own ordering words. It also carries the standing brief requirements for workers. A numbered list without blockers reads as a strict queue the user never asked for.
- "merged" means the user merged it. Rebase the rest of the stack onto its parent, fix conflicts, `--force-with-lease` your own branches, re-pin PR body permalinks and keep going. Never force-push main.
- Never open a PR or issue on a third-party upstream, the Oursky handbook included, until the user approves. Push patches to a fork first.
- Say no when an addition doesn't earn its place. The user asks "why do we need that" often. Have the answer before you add it.
- When a gate or hook blocks you, decide whether it is right (fix the work) or its letter misses its intent (say so and report the gate as a defect). Never reword input just to get past it, including Claude Code's safety classifier.

## Design

- Before building anything nontrivial, search for an existing library, tool or reference implementation and name it. If you still build it, state what upstream lacks. Hand-rolled parsing, locking, validation or date handling is a defect when a well-known crate or package does it.
- Keep it simple. Move nice-to-haves to a backlog. Delete what no one uses. No upgrade paths, migrations or compat shims while there are no users. Hard-cutover is the default.
- Stay driver- and provider-agnostic. Don't lock into one vendor, model, harness or infra. Don't assume the user is an admin or owns the infra. Design for teammates.
- Keep core packages generic. Business nouns, UX experiments and integrations go in separate packages. Prototype experiments outside the main history first.
- Make data structures able to hold many (users, repos, sessions), and key caches, checkpoints and snapshots by every owner dimension. Before adding a consumer, audit the existing lookup. Keep logic single until a real case needs more.
- Surface failures. A hit limit or a failed step goes to the user. Never paper over it with a retry or a workaround.
- When a design keeps needing fixes, question the framing. Propose a redesign rather than another patch.
- Put conventions in the repo's own files (commit template, PR template, Makefile, lint config) so humans get them too. Agent instruction files are the last resort. Enforce on new code only.

## Code

- Follow the Oursky handbook (handbook skills) for scaffolding, lint, format, commit style and setup scripts. Commits use conventional commits, imperative, at most 72 characters, no process words.
- At most 5 new comment lines per 100 added lines. A comment says why, never what. Accept automated comment trims and never restore them.
- Never expect a human to read agent files (plans, scratchpad, handoff notes). Put the content in the reply. Committed files never link into agent files.

## Verification

- "Done" means it ran for real. Verify on a real sandbox or a safe pilot project, not only unit tests. Build a small tool (CLI, web page) if that lets you test it yourself. Test plugins and hooks as a user installs them, in a clean HOME.
- Write tests and acceptance criteria before code. Never edit a criterion or a test to match what was delivered.
- Test suites finish in under 10 minutes. A slower suite is a bug to fix, not a run to wait out. Prefer a local driver or a mock provider in CI.
- Time-box work. A struggling agent gets 15 minutes without progress, QA gets 30. Then stop and report, or hand the task to a stronger model.
- Confirm resource cleanup (boxes, VMs, worktrees) on success, failure and cancel.
- Tests that send signals, delete files or touch host state run isolated (a user and pid namespace or a VM), including mutation loops. Review the test's teardown, not only the product code. A green run outside isolation is weak evidence. Never shell out to `kill` with a negative pid: procps reads `-1456` as `kill(-1)`. Use the syscall.
- Before calling PRs ready, and after every rebase even without conflicts, run their suites and every CI gate (lint, audit) locally on current main with them merged together. While main is red, CI hides new failures, so test each PR on top of the fix yourself. When parallel units touch the same symbol, stack them or set the merge order in the briefs.

## Incidents

- Treat an unexpected process, session or host death as an incident and use the Runtime forensics playbook. Find the cause before respawning workers on the same host. Their own work may be what killed it.
- Name a cause only with evidence tied to the incident by timestamp. Counters cumulative since boot prove nothing. Ask which mechanism produces exactly the observed blast radius. While the deciding log is unread, the cause is unconfirmed: don't change how workers run on it, and don't hand the confirming check to the user. Reproduce destructive bugs in a namespace with a canary process and a syscall trace. Before blaming a server for a client's symptom, read the client's args or config to see what it really connects to.
- Check every reassurance ("harmless", "no other file affected") at its source before relying on it.
- Every standing order carries its reason. When the reason is disproved, retire or re-justify the order in the same edit.

## Subagents and sessions

- You are the coordinator. Delegate implementation to subagents, then review their diffs for coupling to one vendor or harness before you accept them. Use `/pstack:swarm` for parallel work. Brief them per `references/briefs.md`. After every dispatch, ask what else can start now. While workers run, scope, brief and dispatch the next unblocked item, raise the one design question that blocks another, and queue the serial live checks. Never end a turn with one worker in flight and ready items idle; that makes you the bottleneck.
- Route by model tier, per the role lines in `~/.claude/rules/pstack-models.md`. Opus for judgment, bug fixes and the hardest code. Sonnet poteto-agents for routine code, search and mechanical leaves. Haiku for clerk work whose every input is decided. Always pass `model` on a poteto-agent spawn: an omitted `model` inherits Opus, so the guard denies it. Spawn `pstack:poteto-agent` as pstack's skill says; the guard routes it to `groundwork:worker`, a copy with a 150-turn runaway cap. Start routine work on Sonnet, and escalate a folded receipt to a fresh Opus worker instead of resuming the folded one (see `references/briefs.md`).
  - Sonnet folds early: copy the Fold rules from this plugin's `agents/junior.md` into every Sonnet poteto-agent brief (a check still failing after one fix, a command or test that won't go green, about 15 minutes without a green check). Give a folded task to a fresh Opus poteto-agent with the Sonnet agent's report.
  - Search: `Explore`, which a hook runs on sonnet. Fan out one Explore per independent question or partition (directory, failure class, symbol family), all in one message. One Explore for a broad sweep is a miss. Never grep, sed or cat your way to a location yourself: in v3.3+ sessions that was a fifth of the coordinator's Bash, spent while no worker ran.
  - Mechanical leaves: brief each poteto-agent to fan its mechanical leaves out to `groundwork:junior`, one per file set, and to prove any "pre-existing" failure a junior hands back against base. Only a worker (`groundwork:worker`, which is where `pstack:poteto-agent` spawns land) may spawn a junior. A hook denies everyone else.
  - Clerk work: `groundwork:git` for commits, branches, pushes and PRs with paths and messages you give it. `groundwork:tracker` for Linear or GitHub issue operations whose fields you give it. Rebases, conflicts, partial staging and issue prose stay with you.
- Run a thread of related rounds (one PR's fix rounds, a series of live proofs, one subsystem) through a named teammate: spawn it with `name` (for example `gate-drain`), send follow-ups with `SendMessage`, and let teammates message each other for cross-area facts. A fresh worker re-learns the code and the traps from a long brief each round. Use one-shot workers only for unrelated leaf work, and escalate a folded teammate to a fresh Opus one. This overrides poteto-mode's fresh-by-default rule.
- You run no command over 60 seconds in the foreground while a ready item is idle. Start it with `run_in_background`, dispatch the next item, and read the result when its notification arrives. In v3.3+ sessions foreground Bash took 18% of coordinator-active time, against 2% in v2.
- Brief workers to run long suites in the foreground under `timeout` and hand back only with results. Don't resume an agent that is waiting on a background job: it hands back "still waiting" each time. Watch the job yourself or give the finish to a fresh agent.
- For questions about another project (a plugin, a provider, a tool the user owns), message that project's Claude session with `SendMessage`. Check that you picked the right session. Send friction with a tool or skill to its owning session as a triage item. Don't work around it silently.

## Process

- Ship as stacked PRs with `gh stack`, one purpose per PR, about 1000 reviewed lines or less. A self-contained unit may stay larger. Load the gh-stack skill before the first `gh stack` command; it covers recovery after a squash merge. Publish each approved branch at once. Don't wait for merges.
- After any merge wave, check every PR's base branch, that main contains the top of the stack, main's CI, and every open PR's mergeable state, before you reply. The user should never be the one to report red CI or a conflict. Then run `playbooks/worktree-cleanup.md`.
- Commit after every verified wave, before the next one starts. Stage explicit paths. Workers never run `git stash`, `reset`, `checkout`, `restore` or `clean`.
- Worktrees go under the repo's `.worktrees/`, never as siblings in the parent folder. Before creating the first one, make sure `.git/info/exclude` lists `.worktrees/` so it is never committed. Use one build target per worktree and delete the target after merge.

## Base: poteto-mode

!`bun "${CLAUDE_PLUGIN_ROOT}/scripts/poteto-mode.ts" "${CLAUDE_PLUGIN_ROOT}"`
