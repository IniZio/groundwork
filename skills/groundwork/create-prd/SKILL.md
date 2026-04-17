---
name: create-prd
description: Create the master PRD for a feature with enforced filename conventions, standard content format, and session-level mutation tracking. Always the first PRD skill invoked — before nested-prd or consolidate-docs. After creation, MUST ask user for review before proceeding to implementation.
---

# Create PRD

## When to Use

Invoke when ANY of these are true:

- Starting a new feature that needs a specification
- User asks to "write a PRD", "create a spec", "document the plan"
- About to begin implementation of non-trivial work (≥1 day estimated)
- No master PRD exists for the current feature area
- `using-workflow` core rules reference PRD creation

**This is always the first PRD skill invoked.** `nested-prd` and `consolidate-docs` operate on PRDs created by this skill.

## Principles

1. The PRD is the **source of truth for current intent** — not just original intent.
2. When direction changes mid-session, the PRD must reflect the new direction via the Steer Log.
3. Filenames and content format are enforced, not optional.
4. PRDs are never committed to git.

## Workflow

### Step 1: Determine Feature Area and Date

Identify:
- **Feature area**: short kebab-case identifier (e.g., `auth-flow`, `payment-api`, `dark-mode`)
- **Date**: today's date in `YYYY-MM-DD` format

### Step 2: Create Master PRD Directory and File

Each PRD (master or child) lives in its own directory containing a `PRD.md` file. Child PRDs nest as subdirectories within their parent.

File path: `docs/prds/YYYY-MM-DD-<feature-area>/PRD.md`

```bash
mkdir -p docs/prds/YYYY-MM-DD-<feature-area>
```

### Step 3: Write Content Using Master Template

Use this template exactly:

```markdown
---
type: master
feature_area: <kebab-case>
date: YYYY-MM-DD
status: draft
child_prds: []
---

# <Feature Area>

## Overview

<1-3 paragraph description of what this feature does and why it exists. Present tense: "This system provides..." not "We will build...">

## Architecture

<How the feature is structured. Key components, data flow, boundaries. Diagrams if helpful.>

## Data Model

<Entities, fields, relationships. Schema definitions or type signatures.>

## API / Interface

<Endpoints, functions, CLI commands, UI surfaces — whatever the external contract is.>

## Error Handling

<How errors are classified and surfaced. Retry logic, fallbacks, user-facing messages.>

## Known Limitations

<What this feature does NOT do. Constraints, edge cases not covered, deferred work.>

## Steer Log

<Track direction changes discovered during implementation. Each entry preserves the rationale for pivots so consolidate-docs can produce accurate time-neutral output.>

### YYYY-MM-DD — <short description of pivot>

- **Trigger**: <what caused the change — user request, advisor correction, discovery>
- **From**: <what was previously planned>
- **To**: <what is now planned>
- **Rationale**: <why the change is justified>
- **Affected sections**: <which sections above were updated>
```

### Step 4: Ask User for Review

Use `question` tool to present the PRD for review. Do NOT proceed to implementation without user approval.

```
question: "Master PRD created at docs/prds/YYYY-MM-DD-<feature-area>/PRD.md. Review the PRD before proceeding to implementation."
options:
  - "Approve — proceed to implementation"
  - "Needs changes — I'll specify what"
```

### Step 5: Update Status After Approval

Change `status: draft` to `status: active` in frontmatter.

## Session-Level Mutation Tracking (Steer Log)

When direction changes happen during implementation, update the master PRD **in place** using the Steer Log section. This is different from creating a child PRD.

### When to Steer (update master directly)

- User changes their mind about a detail
- Advisor corrects a non-architectural assumption
- Scope adjusts by ±1 day or less
- A section needs clarification, not restructuring

**How**: Add a Steer Log entry, update the affected sections, set `status: active`.

### When to Nest (create child PRD via `nested-prd`)

- Architectural pivot affecting ≥1 other feature
- Scope increase >1 day
- Contradiction with a requirement in the master PRD
- Multiple plausible resolutions requiring user choice

**How**: Invoke `nested-prd` skill. Do NOT update master directly.

### Decision Heuristic

```
if (change affects other features OR scope increases >1 day OR architectural):
    invoke nested-prd
else:
    steer (update master PRD directly + add Steer Log entry)
```

## File Naming Conventions

All PRD-related skills follow these conventions. See `reference.md` for the full specification.

| Type | Path pattern | Example |
|------|-------------|---------|
| Master PRD | `docs/prds/YYYY-MM-DD-<feature>/PRD.md` | `docs/prds/2026-04-17-auth-flow/PRD.md` |
| Child PRD | `docs/prds/.../YYYY-MM-DD-<topic>/PRD.md` | `docs/prds/2026-04-17-auth-flow/2026-04-18-oauth-scope/PRD.md` |
| Grandchild PRD | `docs/prds/.../YYYY-MM-DD-<topic>/PRD.md` | `docs/prds/2026-04-17-auth-flow/2026-04-18-oauth-scope/2026-04-19-token-refresh/PRD.md` |
| Consolidated | `docs/prds/<feature>-current.md` | `docs/prds/auth-flow-current.md` |
| Archive | `docs/prds/archive/YYYY-MM-DD-<feature>/PRD.md` | `docs/prds/archive/2026-04-17-auth-flow/PRD.md` |

## Rules

- Master PRDs are never committed to git
- Master PRD always lives in its own directory: `docs/prds/YYYY-MM-DD-<feature>/PRD.md`
- Child PRDs nest inside their parent directory (see `nested-prd` skill)
- Frontmatter must include `type: master`, `feature_area`, `date`, `status`, `child_prds`
- Every section from the template must be present (even if briefly filled)
- Steer Log entries must reference which sections were updated
- After PRD creation, MUST ask user for review before proceeding to implementation
- Only one master PRD per feature area at a time
