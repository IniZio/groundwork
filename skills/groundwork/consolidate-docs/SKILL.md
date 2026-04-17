---
name: consolidate-docs
description: Merge time-series PRDs and child PRDs into a single time-neutral document that reads as if the system always worked this way. Use after PRD iterations, before handoff, or when cleaning up docs.
---

# Consolidate Docs

## When to Use

- After multiple PRD iterations on the same feature
- Before a major release or handoff to another person/session
- When docs folder has ≥2 related PRDs covering the same feature area
- When someone asks to "clean up the docs" or "update the spec"

## Principles

The consolidated document is **time-neutral**: it describes the current state of the system as if it always existed this way. No "previously", "we changed", "originally we planned", or "as of this iteration" language.

Time-series history belongs in git or an archive folder — not in the live spec.

Steer Log entries from master PRDs are consumed during consolidation — the final state they describe is folded into the relevant sections, and the log itself is not carried forward. Consolidated docs describe *what is*, not *how it got there*.

## Workflow

### Step 1: Identify the Document Set

List all PRD directories in `docs/prds/`. Each directory containing a `PRD.md` is a PRD. Recursively list child PRD directories. Group by feature area.

### Step 2: Identify "Final State"

For each group, determine:
- What does the system actually do today?
- Which decisions from the PRD history are still in effect?
- What was proposed but never built? (exclude)
- What was built differently from what was proposed? (use actual, not planned)
- If a master PRD has Steer Log entries, the **latest state described in the Steer Log** overrides the original section content. The steer log documents pivots; the consolidated doc absorbs the final pivot result into the relevant sections.

### Step 3: Write Consolidated Document

Create: `docs/prds/<feature-area>-current.md`

Rules for this document:
- Present tense throughout ("The system stores X as Y" not "We decided to store")
- No version numbers or dates in body text
- No references to previous approaches that were abandoned
- Every statement describes current reality, not intent or history
- Sections: Overview, Architecture, Data Model, API/Interface, Error Handling, Known Limitations
- **Do not include a Steer Log section** — steer entries are absorbed into the relevant sections above. The consolidated doc is time-neutral; steer history is preserved only in the archived originals.
- Frontmatter must use `type: consolidated` with `feature_area`, `date`, `sources`, and `status` fields (see `create-prd/reference.md` for schema)

### Step 4: Archive Originals

Move source PRD directories to `docs/prds/archive/`, preserving the nested structure:

```bash
mkdir -p docs/prds/archive
mv docs/prds/YYYY-MM-DD-<feature> docs/prds/archive/
```

This moves the entire directory tree (master + children + grandchildren) in one operation.

Update `status: archived` in frontmatter of the master PRD only. Child PRDs inherit archived status from their parent.

Keep the consolidated document as the single source of truth.

### Step 5: Update References

Search codebase for references to archived PRD paths and update them to point to the consolidated document.

```bash
grep -r "docs/prds/YYYY-MM-DD" . --include="*.md"
```

### Step 6: Advisor Gate

Invoke `advisor-gate` completion gate to confirm consolidation is accurate and nothing was lost.
