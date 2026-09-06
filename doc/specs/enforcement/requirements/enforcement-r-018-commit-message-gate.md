---
id: enforcement-r-018
type: requirement
concept: C-ENFORCEMENT
title: Commit-message gate enforces conventional format and strips attribution trailers
status: implemented
verification: unverified
criticality: must
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-018 — Commit-message gate enforces conventional format and strips attribution trailers {#enforcement-r-018}

Every commit message **shall** conform to `type(scope): subject` where `type` is one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`; the subject line **shall** not exceed 72 characters; and the commit message body **shall** be empty — only the subject line is permitted. Attribution trailers (`Co-Authored-By:` lines naming Claude or Anthropic, `Claude-Session:` lines, and `Generated with Claude Code` lines) **shall** be stripped mechanically by the `commit-msg` hook without being reported to the author as violations. Groundwork process vocabulary (gate-cycle phrasing such as "gate cycle", "dogfood", slice ids, motive slugs, and decision ids) **shall** be rejected — not stripped — and the offending lines **shall** be named in the error output. The `gw ledger gate <slug> advisor APPROVE` command **shall** be refused while the run's commit range contains unresolved violations. Setting `GROUNDWORK_COMMIT_LINT=0` **shall** disable all enforcement.

Three enforcement surfaces share one rule source (`hooks/lib/commit-convention.mjs`):
1. The `commit-msg` git hook (`hooks/commit-msg`) — strips attribution trailers then rejects remaining violations.
2. The `commit-message-guard` PreToolUse Bash hook (`src/gw/hook/commit-message-guard.ts`) — denies Bash tool calls that would produce a non-conforming commit message; strips and rejects using the same rule source; does not execute rewrites.
3. The `gw commit-lint` CLI (`src/gw/cli/commands/commit-lint.ts`) with subcommands `report` (lists violations over a commit range) and `remediate-plan` (proposes an interactive-rebase plan but **shall not** execute a history rewrite itself).

- **Why** — Commit messages are the primary human-readable record of project history. Groundwork process vocabulary (slice ids, motive slugs, gate-cycle markers) leaks internal session bookkeeping into the public log, which degrades readability and creates noise for future readers. Attribution trailers added automatically by Claude Code are constant, carry no author-decision content, and **shall** be removed without burdening the author. A single shared rule source ensures the three enforcement surfaces cannot diverge on what constitutes a violation.
- **Fit criterion** — A commit message of the form `type(scope): subject` with no body and no process vocabulary is accepted by all three enforcement surfaces. A message containing a groundwork process term (e.g. `gate-cycle`, a motive slug, or a slice id) is rejected by all three surfaces with the offending line named. Attribution trailers (`Co-Authored-By: Claude`, `Claude-Session: https://…`, `Generated with Claude Code`) are removed silently by the `commit-msg` hook and are never reported as violations by any surface. `gw ledger gate <slug> advisor APPROVE` returns a non-zero exit and a violation summary when the commit range includes non-conforming messages. With `GROUNDWORK_COMMIT_LINT=0` set, all three surfaces pass through unconditionally.
- **Verification**: unverified — run `gw commit-lint report` over a range containing a known violation and confirm the offending commit and line are named; attempt `gw ledger gate <slug> advisor APPROVE` with violations in range and confirm refusal; set `GROUNDWORK_COMMIT_LINT=0` and confirm all three surfaces pass through unconditionally.
- **Criticality**: must
