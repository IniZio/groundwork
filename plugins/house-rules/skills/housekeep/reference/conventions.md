# Lens `conventions`: scan checklist for a Housekeep scan subagent. Return Finding rows in SKILL.md format (`| id | lens | severity | effort | auto-fix | location | finding | fix |`); do not edit.

## 6 detectable conventions

| Convention | Finding trigger | Source |
|---|---|---|
| **commit-conventional** | No `.gitmessage` containing `<type>`, while ≥50 % of the last 20 commits use `type(scope): subject` format | `src/conventions/detect.ts` → `detectCommitStyle` |
| **pr-template** | `.github/pull_request_template.md` absent | `src/conventions/detect.ts` → `detectPrTemplate` |
| **makefile-targets** | `Makefile` absent at repo root | `src/conventions/detect.ts` → `detectMakefileTargets` |
| **no-formatter-config** | None of `.prettierrc`, `.prettierrc.json`, `biome.json`, `.editorconfig` present | `src/conventions/detect.ts` → `detectFormatterConfig` |
| **test-layout** | No test directory (`test`, `tests`, `__tests__`, `spec`) at repo root | `src/conventions/detect.ts` → `detectTestLayout` |
| **code-rules** | TS or JS files found but `Makefile` has no `# groundwork-rule: no-console-log` marker | `src/conventions/detect.ts` → `detectCodeRules` |

## What counts as a Finding

A Finding is one of:

- **Missing file** — the convention file does not exist (e.g. no `.gitmessage`, no `Makefile`).
- **Empty or stub file** — the file exists but contains no meaningful content (e.g. a `.gitmessage` with no `<type>` placeholder).
- **Contradicts enforced behaviour** — the file's content conflicts with a guard that is already active. Known contradiction: the convention writer proposes a `.gitmessage` containing `[body]` (`src/conventions/detect.ts:48`), but the commit guard enforces `bodyPermitted: false` (`hooks/lib/commit-convention.mjs:49`). The conventions lens **must report this as a Finding** — it is not a clean auto-fix. Mark `auto-fix: no` and note the contradiction in the `fix` column.

Do not report a Finding if the convention file already satisfies its check (the detector returns `null` in that case).

## Fix routing

Housekeep **does not write convention files directly.** Accepted findings are routed to groundwork's convention scripts. The scripts live in the **groundwork plugin root**. In development (groundwork is the repo being edited), that is the repo root. In a client repo, locate it from the groundwork SessionStart header: look for the line starting `# groundwork v`; its format is `# groundwork vX.Y.Z [(<sha>)] — <root path>` (the sha part is absent for cache installs); use the path after the em dash (` — `) as `<groundwork-root>`. If no such line exists, treat groundwork as not installed.

If groundwork is not installed in the target repo, report findings only and mark every finding `auto-fix: no`.

When groundwork is available:

1. **Detect** — `bun <groundwork-root>/src/conventions/detect.ts <repo> [--pretty]` — prints findings JSON, writes nothing (`src/conventions/detect.ts:4`)
2. **Apply** — `bun <groundwork-root>/src/conventions/apply.ts <repo> --accept <id,id,...> [--findings <file>] [--handbook <path>]` — writes accepted findings to allowed paths only (`src/conventions/apply.ts:3`)

Writable paths enforced by `src/conventions/apply.ts` → `ALLOWED_PATHS` (line 10):

- `.gitmessage`
- `.github/pull_request_template.md`
- `Makefile`
- Any path under the directory passed as `--handbook <path>` (`apply.ts:17`)
- `CLAUDE.md` and `.claude/rules/**` when the finding carries `fallback: true` (`apply.ts:22–25`)

Findings with no `proposed_write` (e.g. `no-formatter-config`, `test-layout`) are skipped by the applier (`apply.ts:40`); mark `auto-fix: no` in the Finding row and suggest the manual action in the `fix` column.

## Quality gates

- All existing tests remain green after any convention write
- Typecheck passes (`bunx tsc --noEmit`)
- No convention file written outside the ALLOWED_PATHS list above
