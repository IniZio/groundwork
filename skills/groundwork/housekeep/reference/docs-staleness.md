# Housekeep — docs-staleness mode

Load this file only when the user selects `docs-staleness` mode. The shared posture and completion gate in `SKILL.md` apply.

## When to use this mode

- Doc/comment rot after a refactor
- Pre-release doc sweep before cutting a version
- README or inline-comment drift from the current code

## Smells

| Smell | Definition |
|---|---|
| **Outdated comments** | Comments describing code that no longer exists or behaves differently |
| **Broken doc links** | Relative links pointing to moved or deleted files |
| **Stale TODOs/FIXMEs** | References resolved issues, ancient dates, or context nobody remembers |
| **Dead doc references** | Docs referencing removed features, configs, or symbols |
| **Orphaned docs** | Doc files for features that were removed from the codebase |

## Passes

- **Pass 1: Stale TODOs/FIXMEs** — resolve, delete, or re-date; never leave a vague TODO behind.
- **Pass 2: Broken links** — fix or remove; prefer removing a dead link over leaving it.
- **Pass 3: Outdated comments** — delete or rewrite to match current code.
- **Pass 4: Orphaned/dead docs** — delete docs for removed features.

Re-run any doc-build or linkcheck after EACH pass.

## Quality gates (docs-staleness-specific)

- linkcheck / markdownlint clean (where the project runs them)
- No comment contradicts the current code
- If a gate fails, fix or DELETE the offending doc — never leave a known-broken doc behind

## Posture note

This mode is DELETION-favoring. Do not write NEW docs during a docs-staleness pass — that is a different task. Delete or update, only. If a doc deserves rewriting from scratch, route that as a separate writing task after this sweep closes.
