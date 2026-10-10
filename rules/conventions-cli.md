# Conventions CLI (agent-facing)

## CLI tools

| Command | Purpose |
|---|---|
| `bun src/conventions/detect.ts <repo> [--pretty]` | Scan repo; print findings JSON. Writes nothing. |
| `bun src/conventions/apply.ts <repo> --accept <id,...> [--findings <file>] [--handbook <path>]` | Write accepted findings. Reads findings JSON from stdin or `--findings <file>`. Pass `--handbook <path>` to allow writes under that handbook checkout. |
| `bun src/conventions/known.ts [<repo>]` | Init .groundwork/ run artifacts; idempotent, accretes on repeat runs. `<repo>` defaults to `.`. |
| `bun src/conventions/promote.ts <repo> --name <kebab> --description "..." [--body-file <f>]` | Write `.groundwork/skills/<name>/SKILL.md` in mattpocock SKILL.md format. Body from `--body-file`. |
| `bun src/conventions/unknown.ts <repo> --add "question"` | Append a question to `.groundwork/unknowns.md`. |

## Run artifact paths (relative to target repo root)

- `.groundwork/profile.md` — accretes across runs; records run timestamps. Not the convention source of truth.
- `.groundwork/skills/<name>/SKILL.md` — promoted skill (YAML frontmatter `name`, `description`; optional body).
- `.groundwork/unknowns.md` — append-only register of open questions.

`.groundwork/` is the working tier (run artifacts, store, per-unit docs under `.groundwork/work/<slug>/`); never holds convention rules. `$GW init` adds it to `.git/info/exclude`, not `.gitignore`. Writing to `.groundwork.db` or `.groundwork/` via apply is always forbidden.

## new-code-gate details

- Block message format: `new-code-gate: <rule> <file>:<line>[; ...]`
- Trigger: Stop and SubagentStop hooks.
