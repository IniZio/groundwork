# Lens `conventions`: scan checklist for a Housekeep scan subagent. Return Finding rows in SKILL.md format (`| id | lens | severity | effort | auto-fix | location | finding | fix |`); do not edit.

## 5 detectable conventions

| Convention | Finding trigger |
|---|---|
| **commit-conventional** | No `.gitmessage` containing `<type>`, while ≥50 % of the last 20 commits use `type(scope): subject` format |
| **pr-template** | `.github/pull_request_template.md` absent |
| **makefile-targets** | `Makefile` absent at repo root |
| **no-formatter-config** | None of `.prettierrc`, `.prettierrc.json`, `biome.json`, `.editorconfig` present |
| **test-layout** | No test directory (`test`, `tests`, `__tests__`, `spec`) at repo root |

## What counts as a Finding

A Finding is one of:

- **Missing file**: the convention file does not exist (e.g. no `.gitmessage`, no `Makefile`).
- **Empty or stub file**: the file exists but contains no meaningful content (e.g. a `.gitmessage` with no `<type>` placeholder).
- **Contradicts enforced behaviour**: the file's content conflicts with a guard that is already active, e.g. a `.gitmessage` with a `[body]` section while the `commit-message` rule forbids a body. Mark `auto-fix: no` and note the contradiction in the `fix` column.

Do not report a Finding if the convention file already satisfies its check.

## Fix routing

Every conventions Finding is `auto-fix: no`. Put the file to write and its proposed content in the `fix` column. In the Fix step, write accepted files only to `.gitmessage`, `.github/pull_request_template.md` or `Makefile`, following the repo's handbook when one exists.

## Quality gates

- All existing tests remain green after any convention write
- Typecheck passes (`bunx tsc --noEmit`)
- No convention file written outside the three paths above
