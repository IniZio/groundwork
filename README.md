# groundwork v2

Glue that adapts to per-repo conventions, enforces best-practice direction in new code, and builds known-from-unknown — without reinventing what upstream already ships.

v1 lives on the `main` branch of this same repository.

## What it is

groundwork v2 is a Claude Code plugin. It installs alongside mattpocock/skills (a peer plugin) and adds on top:

- Convention detection: DETECT → CONFIRM → WRITE to the repo's own files
- Best-practice enforcement in new code only; existing code is left alone
- A SQLite work store replacing the four-store model (ledger + journal + motive + tickets)
- Five enforcement hook families rebuilt to their cheapest biting form (~587 lines, down from 2611)

## What it is not

- A reinvention of mattpocock/skills capabilities (debugger, arch-review, prototype — deleted, covered upstream)
- A four-store system (ledger + journal + motive + tickets live in one SQLite file)
- A replacement for per-repo tooling (conventions write to `.gitmessage`, `Makefile`, etc.)

## State model (D-7, D-9)

Two stores only:

1. **Repository itself** — conventions in `.gitmessage`, `.github/pull_request_template.md`, `Makefile`, handbook
2. **SQLite work store** — slices, decisions, events, charter in one `.groundwork.db` file (gitignored)

## Install

```
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin marketplace add /path/to/groundwork-v2    # or a URL
claude plugin install groundwork
```

`claude plugin install groundwork` auto-installs mattpocock-skills (+ 1 dependency) from claude-plugins-official. Both appear in `claude plugin list` as `✔ enabled`.

If the official marketplace is not registered first, `claude plugin install groundwork` exits 0 and reports success, but `claude plugin list` shows:
`Status: ✘ failed to load — Dependency "mattpocock-skills@claude-plugins-official" is not installed — run \`claude plugin install mattpocock-skills@claude-plugins-official\`, or check that its marketplace is added`
Fix: `claude plugin marketplace add anthropics/claude-plugins-official` then `claude plugin install groundwork` again.

## What groundwork adds on top of mattpocock-skills

- **Intent routing** — classifies requests and fans out to the right agent type
- **Work store + stop-gate** — SQLite slice/decision/event store with a stop-gate that blocks when work is open
- **Enforcement hooks** — five hook families (spawn-model, store-write, piped-exit-code, prose-quality, new-code-gate)
- **Convention adaptation** — DETECT → CONFIRM → WRITE to per-repo convention files
- **Advisor gate** — evidence-graded APPROVE/CORRECTION/STOP verdicts before completion
- **Session continuity** — SessionStart hook restores context across sessions

## Peer plugins

**mattpocock/skills** is installed automatically as a dependency. It provides capabilities groundwork does not reinvent: debugger, arch-review, prototype, tdd, code-review, research (D-11 reuse-first). See `doc/collision-policy.md` for the skill-name collision policy.

## Conventions layer

Convention detection, targeted writing, best-practice enforcement, and known-from-unknown artifacts. See **[doc/conventions.md](doc/conventions.md)** for CLI usage, allowed write targets, artifact paths, new-code-gate definition, and the D-16 fork-only PR rule.

## Development

```
bun install
bun test
```

### Testing a change live

The `groundwork` marketplace is a `directory` source pointing at this repo. Every session runs the working tree directly, including uncommitted edits. No reinstall step.

**What applies when:**

- Hook and CLI edits apply on the next hook invocation.
- SessionStart text, skills, and agents need a new session (or `/reload-plugins`).

**Risk:** a half-finished edit affects every open session. Commit at wave boundaries.

**Verify you are running the dev checkout:** SessionStart prints the version, git sha, and root path. If the root is the cache path (`~/.claude/plugins/cache/...`), you are not running the dev checkout.

**How the root is resolved:** the session-start hook derives its root from its own file location (`import.meta.url`). `CLAUDE_PLUGIN_ROOT` is cross-checked only — if it mismatches, a line is printed. The hook command itself is located via `CLAUDE_PLUGIN_ROOT`, so the hook file and the cross-check should agree.
