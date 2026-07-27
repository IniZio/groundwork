---
name: spec-extend
description: Spec lifecycle management skill. Handles spec creation, revision, and deprecation. Tracks version, linked PRs/commits, and status transitions.
---

# Spec Extend

## When to Use

Invoke when ANY of these are true:

- A PRD needs revision and the spec should be updated in sync
- Requirements change during implementation
- Implementing a follow-up to an existing feature
- A spec needs to be created from scratch (without PRD)
- A feature is being deprecated and spec should be archived
- Need to trace spec to implementation (link PRs/commits)

## Purpose

This skill manages the **entire spec lifecycle**:

1. **Creation** — Create new specs from templates or PRDs
2. **Revision** — Update specs when requirements change
3. **Deprecation** — Archive specs when features are retired
4. **Tracking** — Maintain version, status, and implementation links

## Trigger Scenarios

### Spec Creation

**When**: Starting a new feature without going through full PRD process.

**Process**:
1. Copy `.pi/specs/template.md` to `.pi/specs/<feature>.md`
2. Fill in all sections with feature-specific content
3. Set frontmatter: `version: 1.0.0`, `status: draft`
4. Link to PRD if one exists

### Spec Revision

**When**: Requirements change, PRD updated, or implementation discovery requires adjustment.

**Process**:
1. Read existing spec at `.pi/specs/<feature>.md`
2. Identify delta from PRD or previous version
3. Update spec sections with changes
4. Bump version according to semantic versioning:
   - Patch (1.0.0 → 1.0.1): Clarification, typo fix
   - Minor (1.0.0 → 1.1.0): New non-breaking requirement
   - Major (1.0.0 → 2.0.0): Breaking change, major refactor
5. Update `updated` date in frontmatter
6. Add entry to Revision History
7. Update TODOs with new tasks or changes
8. Link to code (PRs/commits) if implementation started

### Spec Deprecation

**When**: Feature is retired or replaced by new spec.

**Process**:
1. Read existing spec
2. Update frontmatter: `status: deprecated`
3. Add deprecation note to spec body
4. Move to `.pi/specs/archive/<feature>-deprecated.md`
5. If replaced by new spec, add reference to replacement
6. Update Revision History with deprecation entry

## Spec Status States

| State | Description | Allowed Transitions |
|-------|-------------|--------------------|
| `draft` | Spec is being written, not yet approved | → approved |
| `approved` | Spec is approved, ready for implementation | → in-progress |
| `in-progress` | Implementation has started | → implemented, → approved (iteration) |
| `implemented` | Feature is complete, spec reflects shipped state | → deprecated |
| `deprecated` | Feature is retired, spec is archived | (terminal state) |

## Version Tracking

Each spec tracks in frontmatter:

```yaml
version: 1.0.0          # Semantic version
status: draft           # Current lifecycle state
created: 2026-06-01     # Date spec was first created
updated: 2026-06-01     # Date of last revision
linked_prd: ...         # Reference to source PRD (optional)
linked_prs: []          # Pull requests implementing this spec
linked_commits: []      # Key commits for traceability
```

### Updating Linked PRs/Commits

After implementation tasks complete:

1. Add PR numbers to `linked_prs` array
2. Add commit hashes to `linked_commits` array
3. Update TODOs section to mark tasks complete
4. Bump version if changes were substantive

## Task Flow

### Phase 1: Assess Current State

- [ ] Determine operation type (create / revise / deprecate)
- [ ] If revise: read existing spec
- [ ] If revise: read source PRD (if linked)
- [ ] Identify what changed or needs to change

### Phase 2: Execute Operation

**For Creation**:
- [ ] Copy template to new spec file
- [ ] Fill in all sections
- [ ] Set frontmatter metadata
- [ ] Mark as `draft`

**For Revision**:
- [ ] Identify delta from current spec
- [ ] Update affected sections
- [ ] Bump version appropriately
- [ ] Update `updated` date
- [ ] Add to Revision History
- [ ] Update TODOs with new/changed tasks

**For Deprecation**:
- [ ] Add deprecation notice to spec body
- [ ] Update frontmatter: `status: deprecated`
- [ ] Create archive directory if needed
- [ ] Move spec to archive
- [ ] Add reference to replacement (if any)

### Phase 3: Link to Implementation

- [ ] Add implementing PR numbers to `linked_prs`
- [ ] Add key commit hashes to `linked_commits`
- [ ] Update TODOs to reflect completion status
- [ ] Verify all Success Criteria are checked

### Phase 4: Quality Check

- [ ] Validate frontmatter is correct
- [ ] Ensure all mandatory sections are present
- [ ] Verify version follows semantic versioning
- [ ] Check Revision History is up to date

## Spec Template Sections

When creating or revising specs, ensure these sections are present:

### Mandatory

- **Context** — Why this feature exists, background, constraints
- **Objectives** — Clear, measurable goals
- **Verification Strategy** — How to verify implementation
- **Task Flow** — Implementation task breakdown
- **TODOs** — Living task list
- **Commit Strategy** — How to commit changes
- **Success Criteria** — Observable completion criteria

### Optional (include as needed)

- Related Documents
- Test Coverage Requirements
- Dependencies
- Revision History

## Integration with the Plan

### Plan → Spec Flow

When a feature is being planned (via `interview`, deferring to the project's planning convention):

1. The plan is synthesized (groundwork default: `.groundwork/plans/<feature>.md`)
2. This skill creates the spec at `.pi/specs/<feature>.md`
3. Spec frontmatter links to the plan: `linked_plan: .groundwork/plans/<feature>.md`
4. Spec Context section references the plan's Overview / Acceptance Criteria

### Spec Revision → Plan Revision

When spec revision reveals the plan needs updating:

1. Update spec first (this skill)
2. Update the plan in place, noting the rationale for the change
3. Re-run `vertical-slice` if the change affects scope or slice boundaries

## Integration with Auto-Learning

After spec operations complete:

1. If spec revision revealed new pattern → add to `docs/learnings.md`
2. If spec revision involved architectural choice → add to `docs/decisions.md`
3. Include spec version and operation type in learning/decision entry

## File Locations

| File | Purpose |
|------|---------|
| `.pi/specs/README.md` | Spec system documentation |
| `.pi/specs/template.md` | Spec template |
| `.pi/specs/CONSTITUTION.md` | Governance principles |
| `.pi/specs/<feature>.md` | Feature specs |
| `.pi/specs/archive/` | Deprecated specs |
| `.pi/docs/learnings.md` | Auto-captured learnings |
| `.pi/docs/decisions.md` | Auto-captured decisions |

## Rules

- **NEVER commit specs to git** — specs are working documents
- **ALWAYS update version** when modifying a spec
- **ALWAYS update `updated` date** when modifying a spec
- **ALWAYS add to Revision History** when modifying a spec
- **ALWAYS link to PRD** if one exists for the feature
- **ALWAYS track linked PRs/commits** as implementation progresses
- **NEVER deprecate without replacement** (unless feature is truly retired)
- **Archive deprecated specs** — don't delete them

## Output

After spec operation completes, use `question` tool to present result:

```
question: "Spec operation completed."
details:
  - Operation: [created/revised/deprecated]
  - Spec: .pi/specs/<feature>.md
  - Version: [new version]
  - Status: [new status]
  - Next step: [review / implement / archive]
options:
  - "Review the spec"
  - "Proceed to implementation"
  - "Make changes"
```

---

## Quick Reference Commands

### Create Spec from Template

```bash
cp .pi/specs/template.md .pi/specs/<feature>.md
# Then fill in content
```

### Revise Spec

```bash
# Read current spec
cat .pi/specs/<feature>.md
# Edit sections
# Bump version in frontmatter
# Update Revision History
```

### Deprecate Spec

```bash
# Update frontmatter: status: deprecated
# Move to archive
mv .pi/specs/<feature>.md .pi/specs/archive/<feature>-deprecated.md
```

### Link PR to Spec

```yaml
# In spec frontmatter
linked_prs:
  - "#123"
  - "#124"
```

### Link Commit to Spec

```yaml
# In spec frontmatter
linked_commits:
  - "abc123d"
  - "def456e"
```
