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

## Severity mapping

Default tiers for each smell (rubric can bump ±1; see SKILL.md "Severity model"):

| Smell | Default tier | Rationale |
|---|---|---|
| **Outdated comments** (actively contradict code) | SEV2 | Intent-masking — misleads the next reader into a wrong change |
| **Dead doc references** (removed features/configs/symbols) | SEV3 | Maintainability — confusing but won't cause a wrong edit |
| **Broken doc links** | SEV3 | Maintainability — dead navigation, not actively harmful |
| **Orphaned docs** (for removed features) | SEV3 | Maintainability — safe to delete; no live code depends on them |
| **Stale TODOs/FIXMEs** | SEV4 | Cosmetic/noise — bump to SEV2 if the TODO flags a known correctness or security gap |

These are defaults; context bumps apply (e.g. a misleading comment on a security boundary → SEV1; an orphaned doc in an archived module → SEV4).

## Findings backlog and triage gate

Docs-staleness mode **reuses** the shared findings-backlog table schema and interactive triage gate defined in SKILL.md ("Shared findings backlog format" and "Step 4 — Triage gate"). Do not redefine them here. Collect every smell as a Finding (id, severity, category, location, finding, suggested action, effort) before presenting the backlog to the user.

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
