---
name: human-layer
description: Load when writing or reviewing anything a human reviewer reads, such as PR bodies, the doc/ snapshot or README.
---

## 1. Human vs agent view

- Human view: the PR body (draft `.groundwork/work/<slug>/pr-body.md`, published verbatim), README, and `doc/`.
  `doc/` is a present-tense snapshot of current code; no per-change folders.
- Agent view: everything in `.groundwork/` (gitignored; never linked from committed files).
- Committed files state a constraint in one line; they never link into `.groundwork/`.

## 2. Reviewer framing

- Write from reviewer view of repo at PR base, never from dev journal.
- No groundwork vocabulary: slice ids, DECISION events, motive, ledger, H1/H2, gates.
- No "rewrite" when the base has no prior version.

## 3. PR body v4 shape

In order:
- `## Summary`: 1-3 sentences, what the PR is, for a skimmer.
- `## Why`: 1-3 bullets, one claim each; "because" or "so" allowed; no `:` or `;` clause joins.
- `## Changes`:
  - `### Decisions` first, ONLY when the PR changes existing behaviour: a `| Decision | Constraint |` table, no alternatives column.
    An initial version has no table.
  - Then one `### <area>` per change: a lead sentence, then a visual (diff sketch, call or file tree, pseudocode, or mermaid).
  - The before-side comes from current source. A new-only visual says it is new. Every block differs from current behaviour.
- `## Impact`: one bullet per affected consumer.
- `## Review focus`: at most 5 links.
- `## Proof`: before/after evidence automated checks don't give; omit when none.

Prose in Why, Changes and Impact is at most 12 lines; headings, fenced blocks and tables don't count.
No rejected alternatives anywhere (they live in ADRs).

## 4. Link forms

- Every file reference is a rendered markdown link, filename as label, pointing to a commit-pinned blob permalink.
- At PR-open time add the files-changed anchor (`/pull/N/files#diff-<sha256(path)>`) with `bun <root>/src/review/pr-links.ts`.
- Never a bare `path:line`, `path@sha:line` or backticked path.

## 5. Review loop

1. Run `bun <root>/src/review/human-doc-check.ts <file>` (`<root>` = dir holding `src/cli/main.ts` from `$GW`).
2. Spawn `groundwork:human-doc-reviewer` with only that path and the check command; apply its deletions; repeat until `status: PASS`.
3. Hand off to approval. H1 (`! $GW approve charter`) and H2 (`$GW approve spec --auto`, or `! $GW approve spec` for a human)
   bind Summary, Why, Changes and Impact. Review focus and Proof edits never void them.
4. Only the human runs the non-auto approvals.

## 6. ADRs

- Agent-view records live at `.groundwork/adr/{nnnn}-{name}.md`, with optional `date` and `supersedes`.
- The PR body states the decision only.

## 7. Human writing standard

Applies to the PR body and `doc/` snapshot only.

- Compression rules in session authoring rules (dropped articles, fragments, absolute paths) do not apply to human view.
- Lead with the point. No "This document describes".
- Never state what baseline CI enforces (lint, typecheck, tests passed).
- Flows, architectures, state machines: diagram.
- State decisions only. Rejected alternatives live in ADRs and DECISION events, never in human view.
- Plain controlled English. Apply ASD-STE100 where reader could misparse.
- No agent bookkeeping: file lists, commands, AC tables, ledger ids.
- No hard length cap.
