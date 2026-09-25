---
name: housekeep
description: Scans every hygiene lens (AI slop, dead code, dependency rot, lint/type suppressions, stale docs, house-rules violations), presents one prioritized HTML report, then fixes the findings you pick. Triggers on: deslop, anti-slop, ai slop, cleanup, tidy, housekeep, fix violations, house-rules fix.
disable-model-invocation: true
---

## Named failure mode: addition default

Cleaning code defaults to adding. Each new helper accumulates the slop it was meant to cure.
Prefer removing over adding. Consolidate before introducing utilities.
Ask "can I remove this?" before asking "what should replace it?"

## Glossary

- **Lens**: one scan checklist (`slop`, `deps`, `lint-debt`, `docs`, `conventions`, `house-rules`)
- **Finding** row: `| id | lens | severity | effort | auto-fix | location | finding | fix |`
- **Severity**: SEV1 (correctness/safety), SEV2 (intent-masking/latent risk), SEV3 (maintainability), SEV4 (cosmetic)
- **Effort**: S (<30 min), M (30–90 min), L (>90 min)
- **Auto-fix**: yes only when `house-rules housekeep` can fix it
- **Priority tier**: Fix now (any SEV1, or SEV2+S/M) · Worth doing (other SEV2, or SEV3+S) · Optional (everything else). Within a tier: auto-fix first, then effort ascending, then severity. Quick win = auto-fix yes, OR (effort S AND SEV≤3).

## Process

### 1. Choose aspects

Use `AskUserQuestion` with `multiSelect: true` and question: "Which aspects should I scan?"

Options:
- "Code slop & dead code (Recommended)" — finds bloat, dead code, needless abstractions, boundary violations, weak tests
- "Dependencies" — finds phantom deps, outdated packages, dev/prod boundary issues
- "Lint & type suppressions" — finds @ts-ignore, eslint-disable, untyped any
- "Stale docs" — finds dead API references, wrong paths, stale examples
- "Repo conventions" — finds missing or empty convention files (`.gitmessage`, PR template, `.editorconfig`, etc.) and contradictions with enforced behaviour

Selected options map to lenses: "Code slop & dead code" → `slop` + `house-rules`; "Dependencies" → `deps`; "Lint & type suppressions" → `lint-debt`; "Stale docs" → `docs`; "Repo conventions" → `conventions`.

Skip this step if the invocation already names aspects or says "all". If nothing is selected, scan all lenses. The `house-rules` engine lens always runs regardless of selection.

### 2. Scope

If the user named an area, use it. Otherwise use the branch diff since the merge-base with the default branch, plus hot spots from `git log --oneline` over a recent stretch. If that surface is empty or scattered, widen to the whole repo. State the scope in one line.

### 3. Scan

Run `house-rules check` first; its findings go in as the `house-rules` lens with auto-fix marked. Then fan out `groundwork:explore` subagents in ONE message, one per chosen remaining lens. Each gets its reference file and the scope, returns Finding rows only, makes no edits. Skip a lens that has no surface (no dependency manifest → no `deps`; no docs → no `docs`) and record it in the report as "skipped: <reason>". Inventory checks (the **Orphaned entry point** smell in the `slop` lens) always run repo-wide regardless of the hot-spot scope. Unchosen lenses appear in the report header as "not scanned (not selected)".

Reference files: `slop` → `reference/deslop.md`, `deps` → `reference/deps.md`, `lint-debt` → `reference/lint-debt.md`, `docs` → `reference/docs-staleness.md`, `conventions` → `reference/conventions.md`.

### 4. Rank

Merge duplicate findings (same location, same issue) across lenses. Assign ids F1..Fn in priority order. Compute tiers.

### 5. Report

Write a self-contained HTML file to `<tmpdir>/housekeep-<timestamp>.html` (`$TMPDIR`, falling back to `/tmp`) so nothing lands in the repo. Open it (`xdg-open` / `open` / `start`) and print the absolute path. Also print a compact terminal table of the `Fix now` tier plus quick wins (id, tier, one-line finding). See `HTML-REPORT.md`. Do not fix anything yet. Ask: "Which findings should I fix? Reply with ids, a tier (e.g. `fix now`), or `quick wins`."

### 6. Fix

Accepted findings only. Lock behaviour with the narrowest regression tests before editing. Send auto-fix findings to `house-rules housekeep --rules <ids> --paths <globs>`. For the rest, write a cleanup plan ordered from safest deletion to riskiest consolidation, using each lens file's pass guidance. For large sets, fan out `groundwork:implementer` (≤2 files each). After each pass, run that lens's quality gate.

#### Automated fix flags

- `--rules <a,b>` — limit to specific rule IDs
- `--paths <glob,...>` — restrict to files matching glob(s)
- `--since <ref>` — override the base git ref
- `--baseline` — target entries in `.house-rules/baseline.json` instead of the diff scope
- `--max <n>` — cap auto-fixes applied
- `--dry-run` — show what would be fixed without writing

After `--baseline` runs, fixed entries are automatically pruned from the baseline file. Untracked scratch files are reported under "Untracked strays (not blocking)" but do not affect exit code.

### 7. Close

Print a final terminal report: scope, fixed (file + change), deferred/skipped findings with reasons (never dropped silently), quality gates PASS/FAIL, remaining risks. Completion: `groundwork:advisor` returns APPROVE; REVISE/REJECT blocks completion.
