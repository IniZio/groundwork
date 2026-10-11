## Summary

One to three sentences saying what this PR is, written for a skimmer.

## Why

- One plain sentence per claim, each mapping to a planned hunk in the diff.
- Name the constraint that forces this shape, because the reviewer checks the shape against it.
- Keep it to 1-3 bullets and list no alternatives.

## Changes

### Decisions

This table appears only when the PR changes existing behaviour; an initial version has none. Each row is a decision with no visual form that differs from current behaviour.

| Decision | Constraint |
| --- | --- |
| What now happens | Why this shape is forced |

### Short area name

One lead sentence says what the visual shows and why it matters for this PR, or says the visual is new-only.

```diff
- before, from current source, never from design notes
+ after
```

Every file reference is a rendered link: a filename label pointing to the pinned blob permalink, plus a files-changed anchor added at PR open by `bun src/review/pr-links.ts`.

Order areas as a story, the problem's shape first and then the new shape. Cut any block or row that restates current behaviour.

## Impact

- One plain sentence per affected consumer, naming who breaks if this is wrong.
- Add a risk bullet only when it names a concrete failure a reviewer can check.

## Review focus

At most 5 permalinks to line ranges, the most load-bearing first, filled once the code exists.

## Proof

Before/after evidence the automated checks do not give, such as fails-before and works-after output. Leave this section out if there is none.

Prose in Why, Changes and Impact is at most 12 lines total; Summary prose is limited to 1-3 sentences by the checker instead. Headings, fenced blocks, diagrams and tables do not count. No rejected alternatives anywhere.
