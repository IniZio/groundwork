# Groundwork Universal Rules

These rules apply to ALL agents in the groundwork workflow.

## Core Rules (Non-Negotiable)

1. **No worktrees.** For new work, continue in the same session. Do not use `git worktree add` or similar.
2. **Never commit PRDs** to git. Spec docs live in `docs/prds/` but are never staged.
3. **`advisor-gate` is MANDATORY before declaring done.** Any agent declaring work complete must invoke the `advisor-gate` completion gate and receive APPROVE. No exceptions. Confidence without verification is an anti-pattern.
4. **Skill tool invocation (progressive disclosure).** Load skills when routing names them — they contain instructions not present in the bootstrap. If you start direct and hit ambiguity, stop and load the matching skill. If you load a skill unnecessarily, that's fine — better to have too much structure than too little. Skills are tools, not gatekeepers.
<!-- PTY-SECTION-START -->
5. **Use PTY for interactive and long-running commands; use `bash` for one-shot builds.** Use `pty_spawn`/`pty_write`/`pty_read`/`pty_kill` for: interactive commands (editors, `git rebase -i`, `git add -p`, `ssh`, `top`, `less`, `vim`); watch/long-running dev commands (`npm run dev`, `npm start`, `yarn dev`, `docker-compose up`, `docker compose up`, `make watch`, any `--watch` flag); CI babysitting (`gh pr checks --watch`, `gh run view --log-failed`). Use **`bash`** for one-shot commands that exit on their own: `npm run build`, `cargo build`, `go build`, `make` (non-watch), `tsc`, test runners that finish, linters, and similar.
6. **Prefer watch/follow variants with PTY. Never poll-repeat.** NEVER poll-repeat a command — always use `--watch`/`--follow`/`-f`/`--tail` in a PTY session instead. Examples: `gh pr checks --watch`, `gh run view --log`, `jest --watch`, `kubectl get pods --watch`. **Babysitting CI is a MUST-use-PTY pattern**: spawn a PTY for `gh pr checks --watch` or `gh run view --log-failed` and wait for it, rather than calling `gh pr checks` or `gh run view` repeatedly in bash. If a command has a `--watch` flag, use it with PTY — period. Repeated one-shot calls waste tokens and risk missing state changes.
<!-- PTY-SECTION-END -->

## The 1% Escalation Heuristic

**If there is even a 1% chance the current decision is high-impact, irreversible, ambiguous, or likely to cause rework — invoke `advisor-gate`.** When in doubt, escalate once early rather than discover a wrong path late.

**Progressive disclosure principle:** Default to direct, escalate when blocked. Load skills when routing names them, but don't force a heavy classification phase before every action. If you're already implementing and hit uncertainty, load the skill then.

**Hard rule — always at task completion:** The `advisor-gate` completion gate is never optional. Every path converges here. Never declare done without it. This is the single most important compliance rule.

This applies to:
- Any architectural trade-off or destructive operation
- **ALWAYS at task completion** — the advisor-gate completion gate is never optional

Invoke the `advisor-gate` skill before declaring any task complete. 1% chance = invoke it. **No exceptions at completion.**

## Skill Triggers

| Skill | Invoke when... |
|-------|----------------|
| `interview` | **Before `create-prd` for features.** Before `diagnose` for complex bugs. Standalone for small changes. Anytime understanding is incomplete before action. Actively updates CONTEXT.md and ADRs inline |
| `diagnose` | **Any bug or regression.** Something broken that needs root cause analysis. Replaces `create-prd` + `bdd-implement` for bugs |
| `advisor-gate` | **MANDATORY at every task completion.** Also: any technical decision with uncertainty, architectural trade-off, or high-risk operation — even 1% chance of impact |
| `bdd-implement` | **After PRD approval (features) or interview (small changes).** NOT for bugs — use `diagnose` instead. Always delegate to parallel `coder` agents |
| `create-prd` | After `interview` for features (≥1 day); no master PRD exists; about to implement non-trivial work |
| `prototype` | **Design exploration.** Spike on uncertain approaches, test state models (logic TUI), explore UI layouts (variant switcher). Throwaway |
| `commit` | Creating git commits (ensures consistent style) |
| `opencode-acp` | Controlling another OpenCode instance via ACP protocol |
| `goal` | **Multi-step work needing focus tracking.** Set before testing multiple flows, multi-wave implementation, or any task where losing the objective causes rework. Persisted across sessions |

## Session Conventions

### Session Goal

**For multi-step work, use the `goal` skill (`set_goal` tool).** It persists across context compression and session restarts, and injects a reminder into every message.

For quick in-session tracking, pin the goal as the **first `todowrite` item**. Derived from the PRD's Acceptance Criteria or the interview spec's resolutions.

**When to use `set_goal` vs todowrite:**
- `set_goal`: Testing multiple flows, multi-wave features, any work where losing focus across compression/restart has consequences
- `todowrite`: Quick in-session task tracking within a single unbroken session

### Learnings (docs/learnings.md)

Capture non-obvious gotchas discovered during any work session. Lazy-created at project root. Append-only.

**Add learnings when:**
- Surprising framework behavior encountered
- Non-obvious configuration required
- Integration pitfall discovered
- Test setup complexity that would trip up future sessions
- Anything that made you say "I didn't expect that"

**Format:**
```markdown
# Learnings

- **<topic>**: <gotcha description — what happened, why it's surprising, what to do instead>
```

**Rules:**
- Lazy creation — only create when there's genuinely non-obvious knowledge to capture
- One bullet per gotcha — keep it scannable
- Only genuinely surprising things — not routine findings
- Never committed to git (lives alongside PRDs)

### Domain Glossary (CONTEXT.md)

See `interview` skill for CONTEXT.md format and rules. Created and maintained during interview sessions.

## What NOT to Do

- **NEVER declare done without `advisor-gate` APPROVE — no exceptions**
- **NEVER skip the advisor-gate at completion.** Every path ends here — no exceptions.
- **NEVER use `task` inside a subagent task.** Subagents cannot spawn further subagents — these tools are blocked in child sessions. Subagent prompts must be fully self-contained.
- **NEVER use `question` tool in subagents.** Subagents must not ask questions — they must make decisions and do the work.
- Do not use worktrees (`git worktree add` etc.)
- Do not commit PRD or spec markdown files
- Do not run self-review in place of advisor escalation
