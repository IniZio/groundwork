---
id: enforcement-r-019
type: requirement
concept: C-ENFORCEMENT
title: Portable commit-msg hook auto-installs into host repo on SessionStart
status: implemented
verification: unverified
criticality: must
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-019 — Portable commit-msg hook auto-installs into host repo on SessionStart {#enforcement-r-019}

On every SessionStart, groundwork **shall** automatically install a `commit-msg` git hook into `.git/hooks/commit-msg` of the host project (resolved from `CLAUDE_PROJECT_DIR`, falling back to the process working directory). The installed hook **shall** enforce rules according to three cases. (1) When the host repo has a `.gitmessage` that derivation succeeds on (see ENFORCEMENT-R-020), the derived subject-shape rule is enforced ALL-OR-NOTHING against commit subjects; body and length constraints are structurally absent from derived rules. (2) When the host repo has a `.gitmessage` that derivation cannot parse or validate, universal-only rules apply — attribution trailers are stripped and groundwork process vocabulary is rejected, but no format, length, or body rule is imposed. (3) When the host repo has no `.gitmessage`, groundwork tests its own convention per rule group independently against the repo's commit history: subject shape is gate-keeping (below 85% → universal-only); groups that clear 85% are enforced, including the body rule (`BODY_MAX_LINES = 0` — no commit body permitted). This three-way branching ensures groundwork never overrides a host project's declared commit style. The install logic **shall** be idempotent: if a groundwork-versioned hook already exists and is current, no write occurs. A foreign `commit-msg` file (one that does not carry a groundwork version header) **shall** never be overwritten; in that case the installer **shall** log a skip notice and leave the existing file intact. Repos where `core.hooksPath` is already set **shall** be skipped silently — they already have an active hooks mechanism and a `.git/hooks/` install would be shadowed. Setting `GROUNDWORK_COMMIT_MSG_HOOK=0` **shall** suppress both auto-install on SessionStart and enforcement by the installed hook at commit time.

The auto-install is implemented across these source files:

1. `src/gw/hook/session-commit-msg-installer.ts` — SessionStart hook entry point; resolves the host repo, checks preconditions (foreign hook, `core.hooksPath`, kill-switch), and delegates to the installer.
2. `src/gw/hooks/installer.ts` — portable install logic; writes the hook file, sets the executable bit, and stamps the groundwork version header used for idempotency checks and foreign-hook detection.
3. `hooks/lib/commit-msg-template.mjs` — the hook script template embedded into the installed file; calls back into groundwork's rule engine and derive-convention module so enforcement logic is never duplicated.
4. `hooks/lib/groundwork-resolver.mjs` — resolves groundwork's install root portably: tries `CLAUDE_PLUGIN_ROOT` first, then walks up from `__dirname` until `plugin.json` is found.

Manual control is available via `gw hooks install`, `gw hooks uninstall`, and `gw hooks status`.

- **Why** — The in-process `commit-msg` PreToolUse guard (`ENFORCEMENT-R-018`) fires only when Claude Code executes a `git commit` Bash call. It cannot intercept commits made in a terminal outside Claude Code, from `git commit --amend` or `git rebase -i` sessions, or from GUI clients. Installing a standard git `commit-msg` hook into the host repo closes all those paths. The derived-convention design (ENFORCEMENT-R-020) ensures the hook enforces the project's own declared style rather than groundwork's internal style, which would conflict with projects that prohibit conventional-commit prefixes or use a different subject shape.
- **Fit criterion** — After a fresh SessionStart in a repo with no existing `commit-msg` hook, `.git/hooks/commit-msg` exists, is executable, and carries a groundwork version header. In a repo whose `.gitmessage` yields a confident derivation, a terminal commit violating the derived subject shape is rejected. In a repo with a `.gitmessage` that cannot be parsed or validated, only attribution trailers and process vocabulary are enforced; any other format passes. In a repo with no `.gitmessage`, groundwork's own convention is tested per rule group against history: a commit violating a group that cleared 85% (including, when applicable, a non-empty body) is rejected; groups below threshold pass freely. A repo where `commit-msg` already exists without a groundwork header is left unchanged, with a skip notice in the session log. A repo with `core.hooksPath` set is left unchanged. With `GROUNDWORK_COMMIT_MSG_HOOK=0` set, no hook file is written and the installed hook (if present) exits 0 unconditionally.
- **Verification**: unverified — start a session in a clean repo and confirm `.git/hooks/commit-msg` is created and executable; attempt a terminal commit with a non-conforming message and confirm rejection; repeat in a repo with a pre-existing foreign `commit-msg` and confirm no overwrite; in a repo with no `.gitmessage`, confirm a non-conventional-commit message passes; set `GROUNDWORK_COMMIT_MSG_HOOK=0` and confirm no install occurs and the installed hook passes through unconditionally.
- **Criticality**: must
