# Housekeep — learnings-staleness mode

Load this file only when the user selects `learnings-staleness` mode. The shared posture and completion gate in `SKILL.md` apply.

## When to use this mode

- After a significant refactor or dependency upgrade that may invalidate promoted learnings
- Periodic hygiene sweep to keep the learnings store trustworthy
- Before onboarding new contributors who will rely on promoted learnings
- When a promoted learning's `promoted_to` target has changed or been removed

## How the scan works

Use `listLearnings(projectDir)` from `hooks/lib/learnings-io.mjs` to enumerate all entries under `.groundwork/learnings/*.md`. For each entry:

1. Call `readLearning(projectDir, slug)` to get `{frontmatter, body}`.
2. **Filter to PROMOTED entries only** — check `frontmatter.status === 'promoted'` (or equivalent promoted-status field). Skip entries that are in LEARNING or other non-promoted states; they are not yet authoritative and do not need revalidation.
3. Locate the `## Conditions that would invalidate this` section in `body`. Extract each listed condition as a discrete invalidation clause.
4. Evaluate each clause against current repo state (file existence, symbol presence, flag values, config keys, etc.) using `ctx_batch_execute` — never sequential greps.
5. Record a Finding for each smell detected (see catalog below). Do not fix in place; assemble the full backlog first.

**Location field for each Finding:** the learning file path (`.groundwork/learnings/<slug>.md`) plus, where applicable, the `promoted_to` target path (e.g. `skills/groundwork/…/SKILL.md`).

## Smell catalog

| Smell | Definition |
|---|---|
| **Invalidation condition met** | A stated condition (e.g. "if X is removed", "if config Y changes") is now true in the repo |
| **Referenced file/symbol gone** | The learning or its `promoted_to` doc references a file, export, flag, or config key that no longer exists |
| **Promoted target missing** | The `promoted_to` frontmatter field points to a path that does not exist — the learning's destination has been deleted or moved |
| **Recurrence stale** | The learning claims to track a recurring pattern (e.g. "check this after every release"), but the recurrence event has happened with no re-trigger logged |
| **Invalidation section absent** | A promoted entry has no `## Conditions that would invalidate this` section — it cannot be revalidated and is effectively opaque debt |

## Severity mapping

Default SEV tiers (rubric can bump ±1; see SKILL.md "Severity model"):

| Smell | Default tier | Rationale |
|---|---|---|
| **Invalidation condition met** | SEV2 | The learning is now actively misleading — intent-masking risk for anyone relying on it |
| **Referenced file/symbol gone** | SEV2 | The learning references dead artifacts; acting on it will lead readers astray |
| **Promoted target missing** | SEV2 | The promoted knowledge has no live home; the promotion is effectively broken |
| **Recurrence stale** | SEV3 | Maintainability — the learning may still be valid but is no longer self-monitoring |
| **Invalidation section absent** | SEV3 | Maintainability — the learning cannot be revalidated; blocks future hygiene sweeps |

Context bumps apply: a stale learning on a security boundary or a critical architectural invariant bumps to SEV1; a learning in an archived or rarely-used module may drop one tier.

## Findings backlog and triage gate

Learnings-staleness mode **reuses** the shared findings-backlog table schema and interactive triage gate defined in `SKILL.md` ("Shared findings backlog format" and "Step 4 — Triage gate"). Do not redefine them here. Collect every smell as a Finding (id, severity, category, location, finding, suggested action, effort) before presenting the backlog to the user.

**Suggested actions** for each smell:

| Smell | Suggested action |
|---|---|
| Invalidation condition met | Demote to LEARNING (re-open for re-evaluation) or delete if the knowledge is fully superseded |
| Referenced file/symbol gone | Update the reference if the artifact was renamed; delete or demote if the knowledge no longer applies |
| Promoted target missing | Re-promote to the correct target path, or demote to LEARNING until a valid target is identified |
| Recurrence stale | Re-trigger the recurrence check and update the learning, or downgrade to LEARNING |
| Invalidation section absent | Add a `## Conditions that would invalidate this` section, or demote to LEARNING until one is written |

## Passes

- **Pass 1: Promoted-target check** — verify `promoted_to` paths exist; record missing-target findings.
- **Pass 2: Referenced-artifact check** — for each promoted entry, verify all referenced files, symbols, flags, and config keys exist in the current repo.
- **Pass 3: Invalidation-condition evaluation** — parse each `## Conditions that would invalidate this` section and evaluate each clause against repo state.
- **Pass 4: Recurrence and section-absent sweep** — flag entries with missing invalidation sections and stale recurrence markers.

Re-run `listLearnings` after Pass 1 to confirm no entries were altered mid-scan.

## Quality gates (learnings-staleness-specific)

- No promoted learning references a file, symbol, or config key that does not exist in the repo
- No promoted learning has a `promoted_to` path that is absent from the filesystem
- Every promoted learning has a `## Conditions that would invalidate this` section (or is demoted by this pass)
- If a gate fails, demote or delete the offending entry — never leave a known-stale promoted learning behind

## Posture note

This mode is DEMOTION-favoring over deletion. Prefer demoting a promoted learning to LEARNING status (preserving the knowledge for re-evaluation) over outright deletion, unless the underlying knowledge is confirmed fully superseded. Deletion is appropriate when the learning's premise no longer exists in any form. Do not write new learnings or revise learning content during this pass — flag, triage, and demote/delete only.
