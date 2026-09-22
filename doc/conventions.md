# Glue layer — convention detection, enforcement, known-from-unknown

## CLI tools

| Command | Purpose |
|---|---|
| `bun src/conventions/detect.ts <repo> [--pretty]` | Scan repo; print findings JSON. Writes nothing. |
| `bun src/conventions/apply.ts <repo> --accept <id,...> [--handbook <path>]` | Write accepted findings. Reads findings JSON from stdin or `--findings <file>`. Pass `--handbook <path>` to allow writes under that handbook checkout. |
| `bun src/conventions/known.ts <repo>` | Init .groundwork/ D-4 artifacts; idempotent, accretes on repeat runs. |
| `bun src/conventions/promote.ts <repo> --name <kebab> --description "..."` | Write `.groundwork/skills/<name>/SKILL.md` in mattpocock SKILL.md format. |
| `bun src/conventions/unknown.ts <repo> --add "question"` | Append a question to `.groundwork/unknowns.md`. |

## D-4 artifact paths

All paths are relative to the target repo root:

- `.groundwork/profile.md` — accretes across runs; records run timestamps. NOT the convention source of truth. Conventions live in the repo's own files (see below).
- `.groundwork/skills/<name>/SKILL.md` — promoted skill in mattpocock SKILL.md format (YAML frontmatter with `name`, `description`; optional body).
- `.groundwork/unknowns.md` — append-only register of open questions.

## Allowed write targets (apply)

`apply` refuses any path not in this set:

- `.gitmessage`
- `.github/pull_request_template.md`
- `Makefile`
- `<handbook_path>/**` (when `--handbook <path>` is passed to `apply`; the handbook may be outside the repo, e.g. a sibling clone)
- `CLAUDE.md` and `.claude/rules/*` — **last resort only**, when `fallback: true` on the finding (D-17)

Writing to `.groundwork.db` or `.groundwork/` via apply is always FORBIDDEN. The `.groundwork/` directory holds only D-4 run artifacts, never convention rules.

## Convention source of truth

Confirmed conventions are read back from the repo's own files:

- Commit message shape → `.gitmessage` (presence + `<type>` marker)
- Code rules → `Makefile` lines matching `# groundwork-rule: <name>`

`new-code-gate` reads those files directly. `.groundwork/profile.md` may hold a pointer note but is never the authoritative rule source.

## new-code-gate

- **Name**: `new-code-gate`
- **Trigger**: Stop and SubagentStop hooks
- **Definition of "new code"**: lines added in `git diff HEAD` (working tree vs HEAD) plus all lines of untracked files
- **Pre-existing violations** (committed at HEAD) are never flagged
- **Rules are active only when present in `Makefile`** as `# groundwork-rule: <name>` lines; if no rules are present, the gate always allows
- **Block message format**: `new-code-gate: <rule> <file>:<line>[; ...]`
- **Shipped rules**: `no-console-log` (no `console.log(` in new lines), `no-ts-any` (no `: any` or `as any` in new `.ts`/`.tsx` lines)

## D-16 fork-only PR rule

The Oursky handbook lives at `git@github.com:oursky/handbook-dev.git`. Writing into a local checkout (path configured via `handbook_path`) is allowed. Opening a PR directly against the upstream is FORBIDDEN. PRs must target only the fork at `git@github.com:IniZio/handbook-dev.git`. No PR or push automation is implemented.

## CLAUDE.md last-resort rule (D-17)

`CLAUDE.md` and `.claude/rules/*` are valid apply targets only when a finding sets `fallback: true`. Use a native repo file (`.gitmessage`, `Makefile`, etc.) whenever one can express the convention. Mark `fallback: true` only when no native file can.
