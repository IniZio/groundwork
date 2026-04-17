---
name: nested-prd
description: When implementation reveals the master plan needs significant changes, stop and create a child PRD linked to the parent instead of silently mutating the master plan. Use when scope creep, architectural pivot, or contradictions with master PRD are discovered mid-implementation.
---

# Nested PRD

## When to Use

Invoke when ANY of these are true during implementation:

- The current approach contradicts a requirement in the master PRD
- A necessary change would affect ≥1 other feature described in the master PRD
- The estimated remaining work increased by more than 1 day
- An architectural assumption in the master PRD turned out to be wrong
- User asks to change direction in a way that conflicts with the active spec

**Never silently update the master PRD during implementation.** Changes discovered during implementation are separate decisions, not corrections.

**However**, not all changes require a child PRD. Small direction adjustments (detail changes, advisor corrections, scope adjustments ≤1 day) should be handled via the Steer Log in the master PRD (see `create-prd` skill). Only invoke this skill when the change is architectural or affects other features.

## Workflow

### Step 1: Stop Implementation

Immediately pause. Do not write more code that depends on the conflicting assumption.

### Step 2: Document the Conflict

Identify:
- Which master PRD section is affected
- What was assumed vs. what is true
- What the minimal change would be

### Step 3: Create Child PRD

Child PRDs nest inside their parent's directory as subdirectories, each containing a `PRD.md` file. This supports arbitrary depth — a child can have its own child PRDs.

Create directory: `docs/prds/<parent-path>/YYYY-MM-DD-<topic>/`

Create file: `docs/prds/<parent-path>/YYYY-MM-DD-<topic>/PRD.md`

```bash
mkdir -p docs/prds/<parent-path>/YYYY-MM-DD-<topic>
```

Use this template (frontmatter schema matches `create-prd/reference.md`):

```markdown
---
type: child
feature_area: <kebab-case, matches parent>
date: YYYY-MM-DD
topic: <short description>
status: draft
parent_prd: <parent directory path relative to docs/prds/>
---

# Child PRD: <topic>

## Parent Context

Parent PRD: `<path>`
Affected section: `<section name or line range>`

## What Changed

<Describe what was discovered that conflicts with or extends the parent PRD.>

## Why This Cannot Wait

<Why this can't be deferred — what breaks if we continue on the old plan.>

## Proposed Resolution

Option A: <description> — pros/cons
Option B: <description> — pros/cons

## Impact on Master Plan

<List features or tasks in the master PRD that would be affected by each option.>

## Recommendation

<Your recommendation and brief rationale.>
```

### Step 4: Present Options via Question Tool

Use `question` tool to present the child PRD options to the user. Do not pick without user input.

### Step 5: Escalate to Advisor if Architectural

If the conflict involves architectural trade-offs, invoke `advisor-gate` before presenting to user.

### Step 6: Resume

After user decision:
- If master plan adjusts: update master PRD (add Steer Log entry per `create-prd` skill), add child PRD directory name to master's `child_prds` frontmatter list, reference child PRD as the decision record
- If child PRD becomes active: set child `status: active`, implement against child PRD, master plan unchanged
- If change abandoned: set child `status: abandoned`, document in child PRD

## Rules

- Child PRDs are never committed to git
- Child PRD always lives in its own directory under the parent: `YYYY-MM-DD-<topic>/PRD.md`
- Always link back to parent PRD directory in frontmatter
- Never have more than one active child PRD per feature at a time
- Nesting depth is unlimited — a child PRD can have its own child PRDs
