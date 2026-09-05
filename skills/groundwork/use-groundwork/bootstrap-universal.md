# Groundwork Universal Rules

These rules apply to all agents in the groundwork workflow.

## Core Rules

1. **No manual worktrees.** Do not run `git worktree add` or any equivalent command. (The orchestrator's use of Claude Code's managed `Task(..., isolation:"worktree")` as a conflict-fallback is a distinct mechanism handled by the orchestrator only; this rule does not apply to it.)
2. **No committing plans or design docs.** They live in `.groundwork/motives/` (gitignored) — never staged.
3. **Skill tool invocation (progressive disclosure).** Load skills when routing names them — they contain instructions not present in the bootstrap. If you start direct and hit ambiguity, stop and load the matching skill. Better to load unnecessarily than to miss structure.
<!-- PTY-SECTION-START -->
4. **Use PTY for interactive and long-running commands; use `bash` for one-shot builds.** Use `pty_spawn`/`pty_write`/`pty_read`/`pty_kill` for: interactive commands (editors, `git rebase -i`, `git add -p`, `ssh`, `top`, `less`, `vim`); watch/long-running dev commands (`npm run dev`, `npm start`, `yarn dev`, `docker-compose up`, `docker compose up`, `make watch`, any `--watch` flag); CI babysitting (`gh pr checks --watch`, `gh run view --log-failed`). Use **`bash`** for one-shot commands that exit on their own: `npm run build`, `cargo build`, `go build`, `make` (non-watch), `tsc`, test runners that finish, linters, and similar.
5. **Prefer watch/follow variants with PTY — never poll-repeat.** Use `--watch`/`--follow`/`-f`/`--tail` in a PTY session instead of repeated one-shot calls. Examples: `gh pr checks --watch`, `gh run view --log`, `jest --watch`, `kubectl get pods --watch`. Babysitting CI: spawn a PTY for `gh pr checks --watch` or `gh run view --log-failed` and wait for it. Repeated one-shot calls waste tokens and risk missing state changes.
<!-- PTY-SECTION-END -->

## Routing, Triage, and Direct-Write Rules

See CLAUDE.md:
- §Triage pre-check — before you route (dedup against rejection KB, conflict detection, negative scope)
- §Issue-type routing (skill trigger table; per D-15: feature front door is feature-interview, risky-small-change front door is quick-interview, charter-only is requirements)
- §When the orchestrator may write directly (direct-write allowlist, verbatim precondition, hard deny-floor)

## Session Conventions

### Session Goal

For multi-step work, use the `goal` skill (`set_goal` tool). It persists across context compression and session restarts, injecting a reminder into every message.

For quick in-session tracking, pin the goal as the first `todowrite` item. Derive from the spec's Acceptance Criteria or the interview's resolutions.

**When to use `set_goal` vs todowrite:**
- `set_goal`: Testing multiple flows, multi-wave features, any work where losing focus across compression/restart has consequences
- `todowrite`: Quick in-session task tracking within a single unbroken session

### Learnings (docs/learnings.md)

Capture non-obvious gotchas discovered during work sessions. Lazy-created at project root. Append-only.

Add learnings when:
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

Rules:
- Lazy creation — only create when there's genuinely non-obvious knowledge to capture
- One bullet per gotcha — keep it scannable
- Only genuinely surprising things — not routine findings
- Never committed to git (lives alongside plans in `.groundwork/`)

### Domain Glossary (CONTEXT.md)

See `interview` skill for CONTEXT.md format and rules.
