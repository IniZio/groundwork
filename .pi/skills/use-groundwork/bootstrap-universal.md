# Groundwork Universal Rules

These rules apply to ALL agents in the groundwork workflow.

## Core Rules (Non-Negotiable)

1. **No worktrees.** For new work, continue in the same session. Do not use `git worktree add` or similar.
2. **Never commit PRDs** to git. Plans and design docs live in `.groundwork/plans/` (gitignored) — never staged.
3. **Skill tool invocation (progressive disclosure).** Load skills when routing names them — they contain instructions not present in the bootstrap. If you start direct and hit ambiguity, stop and load the matching skill. If you load a skill unnecessarily, that's fine — better to have too much structure than too little. Skills are tools, not gatekeepers.
<!-- PTY-SECTION-START -->
4. **Use PTY for interactive and long-running commands; use `bash` for one-shot builds.** Use `pty_spawn`/`pty_write`/`pty_read`/`pty_kill` for: interactive commands (editors, `git rebase -i`, `git add -p`, `ssh`, `top`, `less`, `vim`); watch/long-running dev commands (`npm run dev`, `npm start`, `yarn dev`, `docker-compose up`, `docker compose up`, `make watch`, any `--watch` flag); CI babysitting (`gh pr checks --watch`, `gh run view --log-failed`). Use **`bash`** for one-shot commands that exit on their own: `npm run build`, `cargo build`, `go build`, `make` (non-watch), `tsc`, test runners that finish, linters, and similar.
5. **Prefer watch/follow variants with PTY. Never poll-repeat.** NEVER poll-repeat a command — always use `--watch`/`--follow`/`-f`/`--tail` in a PTY session instead. Examples: `gh pr checks --watch`, `gh run view --log`, `jest --watch`, `kubectl get pods --watch`. **Babysitting CI is a MUST-use-PTY pattern**: spawn a PTY for `gh pr checks --watch` or `gh run view --log-failed` and wait for it, rather than calling `gh pr checks` or `gh run view` repeatedly in bash. If a command has a `--watch` flag, use it with PTY — period. Repeated one-shot calls waste tokens and risk missing state changes.
<!-- PTY-SECTION-END -->

## Triage pre-check (before routing any new request)

- **Dedup against the rejection KB.** Scan `.groundwork/out-of-scope/*.md` and match **by concept, not keyword**. On a match, surface to the user (Confirm / Reconsider / Disagree) and append to *Prior requests* instead of re-planning. (Format: `vertical-slice` → Rejection KB.)
- **Conflict → stop and ask.** Conflicting classification signals (trivial vs risky, bug vs feature) → state the conflict, ask before routing.
- **Negative scope is first-class** — state what's explicitly out of scope when you route.

## Skill Triggers

| Skill | Invoke when... |
|-------|----------------|
| `interview` | **Plan a feature** (synthesizes a concise plan, deferring to any project planning convention). Before `diagnose` for complex bugs. Standalone for small changes. Anytime understanding is incomplete before action. Actively updates CONTEXT.md and ADRs inline |
| `diagnose` | **Any bug or regression.** Something broken that needs root cause analysis. Replaces the feature/`implement` path for bugs |
| `implement` | **After a plan (features) or interview (small changes).** NOT for bugs — use `diagnose` instead. Runs `vertical-slice` first, then delegates to parallel `general-purpose` agents |
| `vertical-slice` | **Before fanning out general-purpose agents.** Decomposes the task into conflict-free parallel slices and writes the `.groundwork/run.json` ledger |
| `ultrawork` | **Max fan-out mode.** Slice → write ledger → dispatch every independent slice in parallel; gate-enforced by the Stop hook |
| `prototype` | **Design exploration.** Spike on uncertain approaches, test state models (logic TUI), explore UI layouts (variant switcher). Throwaway |
| `commit` | Creating git commits (ensures consistent style) |
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

- **NEVER use `task` inside a subagent task.** Subagents cannot spawn further subagents — these tools are blocked in child sessions. Subagent prompts must be fully self-contained.
- **NEVER use `question` tool in subagents.** Subagents must not ask questions — they must make decisions and do the work.
- Do not use worktrees (`git worktree add` etc.)
- Do not commit PRD or spec markdown files
