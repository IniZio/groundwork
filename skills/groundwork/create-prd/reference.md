# PRD Conventions Reference

Shared conventions for all PRD-related skills: `create-prd`, `nested-prd`, `consolidate-docs`.

## Directory Structure

Each PRD (master or child) lives in its own directory containing a `PRD.md` file. Child PRDs nest as subdirectories within their parent, supporting arbitrary depth.

```
docs/
  prds/
    2026-04-17-auth-flow/                    # Master PRD directory
      PRD.md                                  # Master PRD content
      2026-04-18-oauth-scope/                # Child PRD directory
        PRD.md                                # Child PRD content
        2026-04-19-token-refresh/            # Grandchild PRD directory
          PRD.md                              # Grandchild PRD content
    auth-flow-current.md                      # Consolidated PRD
    archive/                                  # Archived originals
      2026-04-17-auth-flow/
        PRD.md
        2026-04-18-oauth-scope/
          PRD.md
          2026-04-19-token-refresh/
            PRD.md
```

## Filename Rules

| Type | Pattern | Example |
|------|---------|---------|
| Master | `docs/prds/YYYY-MM-DD-<feature>/PRD.md` | `docs/prds/2026-04-17-auth-flow/PRD.md` |
| Child | `docs/prds/<parent-path>/YYYY-MM-DD-<topic>/PRD.md` | `docs/prds/2026-04-17-auth-flow/2026-04-18-oauth-scope/PRD.md` |
| Consolidated | `docs/prds/<feature>-current.md` | `docs/prds/auth-flow-current.md` |
| Archived | `docs/prds/archive/YYYY-MM-DD-<feature>/PRD.md` | `docs/prds/archive/2026-04-17-auth-flow/PRD.md` |

All PRD files are named `PRD.md`. The directory name carries the date and topic identity. Nesting depth is unlimited — each level adds another `YYYY-MM-DD-<topic>/` directory.

### Feature Area Naming

- Kebab-case: `auth-flow`, `payment-api`, `dark-mode`
- Short: 2-4 words max
- Unique: one feature area per master PRD

### Date Format

- Always `YYYY-MM-DD` (ISO 8601 date)
- Use the date the PRD was created, not updated

## Frontmatter Schema

### Master PRD

```yaml
type: master
feature_area: <kebab-case>
date: YYYY-MM-DD
status: draft | active | archived
child_prds: [<list of child PRD directory names, relative to this PRD>]
```

### Child PRD

```yaml
type: child
feature_area: <kebab-case, matches parent>
date: YYYY-MM-DD
topic: <short description>
status: draft | active | abandoned
parent_prd: <parent directory path relative to docs/prds/>
```

### Consolidated PRD

```yaml
type: consolidated
feature_area: <kebab-case>
date: YYYY-MM-DD
sources: [<list of merged PRD filenames>]
status: active
```

## Required Sections

All master PRDs must contain these sections (matching `consolidate-docs` expectations):

1. **Overview** — what and why (present tense)
2. **Architecture** — structure, components, data flow
3. **Data Model** — entities, fields, relationships
4. **API / Interface** — external contracts
5. **Error Handling** — error classification and surfacing
6. **Known Limitations** — what is NOT covered
7. **Task Graph** — implementation tasks with IDs, dependencies, ownership, and file scope for parallel execution
8. **Steer Log** — mutation tracking (see below)

Child PRDs use their own template (see `nested-prd` skill).

## Steer Log Format

The Steer Log section tracks direction changes within a session. Each entry:

```markdown
### YYYY-MM-DD — <short description of pivot>

- **Trigger**: <user request | advisor correction | discovery | scope change>
- **From**: <what was previously planned>
- **To**: <what is now planned>
- **Rationale**: <why the change is justified>
- **Affected sections**: <which sections were updated>
```

Rules:
- Steer Log entries are append-only — never delete or edit previous entries
- After adding a Steer entry, update the affected sections to reflect the new direction
- The PRD body always reflects current intent; the Steer Log records how intent changed

## Steer vs. Nest Decision Matrix

| Condition | Action |
|-----------|--------|
| Detail change, no architectural impact | **Steer** — update master + add Steer Log entry |
| Advisor correction of non-architectural assumption | **Steer** |
| Scope adjustment ±1 day or less | **Steer** |
| Section needs clarification | **Steer** |
| Architectural pivot affecting ≥1 other feature | **Nest** — invoke `nested-prd` |
| Scope increase >1 day | **Nest** |
| Contradiction with master PRD requirement | **Nest** |
| Multiple plausible resolutions need user choice | **Nest** |

## Status Lifecycle

```
draft → active → archived
         ↑         ↑
    (user approves)  (consolidate-docs archives)
```

- `draft`: PRD created but not yet approved by user
- `active`: User approved; implementation can proceed
- `archived`: Moved to `docs/prds/archive/` by consolidate-docs

## Git Rules

- PRDs are **never** committed to git (core rule from `use-groundwork`)
- PRDs are **never** staged
- The `docs/prds/` directory should be in `.gitignore`

## Task Graph Format

The Task Graph section defines implementation tasks for parallel execution. Each task has:

```markdown
### Task List

| ID | Task | Depends On | Owner / Agent | Files Touched | Est. |
|----|------|-----------|---------------|---------------|------|
| T1 | <task> | — | <role> | <paths> | <duration> |
| T2 | <task> | T1 | <role> | <paths> | <duration> |
```

### Dependency Graph

Rendered as a simple text diagram:

```
T1 ──▶ T2
T3 (independent, parallel with T1)
```

### Parallelization Rules

- **No dependency edges** → tasks can run simultaneously via `background_task`
- **Disjoint file sets** → safe to parallelize
- **Overlapping files** → MUST run sequentially
- **Owner/agent** column indicates which agent type handles the task
- Never start a task before all its dependencies are complete

### Conflict Avoidance

The `Files Touched` column makes ownership explicit. When two tasks touch the same file, they either:
1. Must be sequenced (one depends on the other), OR
2. Must touch non-overlapping regions of the same file (noted explicitly)

### Estimation

- Duration in days (`1d`, `0.5d`, `2d`)
- Used for scheduling: tasks on the critical path determine total duration
- Parallel tasks reduce wall-clock time to the longest branch
