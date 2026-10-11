## Why

1-3 lines. Each claim maps to a hunk in the diff (a planned hunk, before implementation). Name the constraint that forces this shape; do not list alternatives.

## Interface

The smallest view that makes the change clear: a diff-sketch (a `diff` fenced block) of the signatures, call tree, file tree or state flow; pseudocode; or a mermaid diagram. Put `// because <constraint>` inline only where the shape is not obvious. For decisions with no visual form, add a compact `| Decision | Constraint |` table with one row per decision and exactly 2 columns; no rejected or alternative column. Take the "before" side of a diff from the current source (cite a permalink), never from design notes.

## Impact

One short line per affected consumer or risk: who breaks, or what changes behaviour, if this is wrong. Write "None" if nothing outside the diff is affected. Risk lines are optional when every affected consumer is listed; do not add generic risk filler.

## Reviewer focus

At most 5 commit-pinned permalinks to line ranges, the most load-bearing first. Fill this when the code exists.

## Proof

Before/after evidence that CI does not already give: the deciding test as fails-before, works-after pseudocode, live-run output, or a screenshot. Leave this section out if there is none.

Prose at most 12 lines including headings; fenced code blocks, diagrams and tables do not count.
