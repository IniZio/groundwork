# Human-facing prose

Applies to PR bodies, `doc/`, READMEs and commit messages. Write from the reviewer's view of the repo at the PR base, never from the dev journal.

## Rules

- Lead with the point. A passer-by skimming the first sentence knows what the PR is.
- No agent bookkeeping: design sections, decision ids, slice or wave ids, file lists, commands, acceptance tables, parity suites, sessions, plans.
- No "rewrite" when the base has no prior version.
- State decisions only. Rejected alternatives stay out.
- Never report what CI already checks.
- Show flows and state machines as diagrams.
- Use controlled English (the **asd-ste100** skill) where a reader could misparse a sentence. No compressed or caveman style.
- `doc/` describes current code in the present tense. No per-change folders. Anything that could flip a reviewer's yes or no goes in the PR body.

## Links

- Every file reference is a rendered markdown link with the filename as label, pointing to a commit-pinned blob permalink. Give the files-changed diff link too.
- Never a bare `path:line`, `path@sha:line` or backticked path.
- Re-pin permalinks after every rebase.

## PR body shape

In order:

1. `## Summary`. One to three sentences for a skimmer.
2. `## Why`. One to three bullets, one claim each.
3. `## Changes`. A `| Decision | Constraint |` table first, only when the PR changes existing behaviour. An initial version has no table. Then one `### <area>` per change: a lead sentence and a visual (diff sketch, call or file tree, pseudocode, or mermaid). The before-side comes from current source.
4. `## Impact`. One bullet per affected consumer.
5. `## Review focus`. At most 5 rendered links, each with its review tier (must, should, optional, skip).
6. `## Proof`. Before and after evidence that automated checks don't give. Omit when empty.

Prose in Why, Changes and Impact is at most 12 lines. Headings, fenced blocks and tables don't count.

Review the finished body with a fresh subagent that gets only the body, not your plans. Apply its cuts.
