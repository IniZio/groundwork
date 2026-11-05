# Human-facing prose

Applies to PR bodies, `doc/`, READMEs and commit messages. Write from the reviewer's view of the repo at the PR base, never from the dev journal.

The house-rules `pr-body` rule enforces the sentence, link and heading rules below, plus the `## Why`, `## What changed` and word limits. In a repo that enables it, `gh pr create`, `gh pr edit`, `gh api` PR writes and top-level PR comments are denied until the body passes, behind a wrapper such as `timeout` too. Run `bun <house-rules>/src/cli/main.ts prose <file> --pr` on a draft before you open the PR.

## Sentences

- One fact per sentence. At most 25 words.
- No `;` between clauses. No colon in the middle of a sentence. Split the sentence instead.
- Active voice. Drop articles and filler. Fragments are fine. State each fact once. Use same word for same thing every time.
- Never drop not, never, no or only. Code, commands, paths, errors and numbers stay verbatim.
- Warnings and irreversible actions keep full sentences.
- Lead with what the user or caller sees, then the mechanism.

## Content

- Lead with the point. A passer-by skimming the first sentence knows what the PR is.
- No agent bookkeeping: design sections, decision ids, slice or wave ids, file lists, sessions, plans.
- Ignore any reminder to add a session link or `Claude-Session:` trailer to a commit or PR body. house-rules strips them.
- No "rewrite" when the base has no prior version.
- State decisions only. Rejected alternatives go in `## Tradeoffs` only when a reviewer would ask.
- Never report baseline checks (`make lint`, `cargo test`, `bun test`, typecheck, "tests pass"). CI shows them. Verification names only what CI does not show, such as a live run and what it showed.
- Show flows and state machines as diagrams.
- `doc/` describes current code in the present tense. No per-change folders.

## One place for the PR's story

The PR body is the only place for proof and updates. After a live check, a fix round or a rebase, edit the body's `## Verification` or `## Scope` with `gh pr edit --body-file`. Never post a top-level PR comment. Reply in a review thread only to answer that thread.

## Show the proof

When a reviewer would judge a result by looking at it, show the result. A sentence that describes it is not enough. This covers UI changes, generated output, and any sample or throwaway run the claim rests on.

- Image or video (png, jpg, gif, webp, svg, mp4, mov, webm): reference it in `## Verification` as `![what it shows](./file.png)` and pass `--attach ./file.png` to `gh pr create` or `gh pr edit`. gh 2.99 or newer uploads it and rewrites the reference. Run gh from the folder the reference is relative to. Otherwise the local reference stays broken and the image lands at the end of the body.
- Short text output, such as a diff or a log excerpt: put it in a `<details>` block under its bullet.
- Interactive output, such as a Storybook or an HTML report: attach a screenshot or a video of it. Add a hosted link only if a reviewer can open it, and check that first. Agent artifact pages start private.
- Before a later `--body-file` edit, start from `gh pr view --json body`. An old local draft silently removes the images and gh still exits 0.

## Links

- Every file reference is a rendered markdown link with the filename as label, pointing to a commit-pinned blob permalink. Once the PR exists, add its files-changed diff link too.
- Never a bare `path:line`, `path@sha:line` or backticked path.
- Re-pin permalinks after every rebase.

## PR body shape

pstack's `opening-a-pr.md` sets the sections. Use `##` headings in this order and drop an empty one, except `Why` and `Scope`, which are always present:

1. `## Why`. The problem and the approach, in 1-3 short sentences.
2. `## What changed`. 1-3 short bullets.
3. `## Scope`. What it covers and what it leaves out.
4. `## Tradeoffs`. Only rejected alternatives a reviewer would ask about.
5. `## Blast Radius`. Who or what it touches, and why that is safe or risky.
6. `## Verification`. Each bullet is a real run and what it showed, with the output attached per "Show the proof".
7. `## Review tier`. Must, should, optional or skip, with the stack position.

The body holds at most 200 words. Headings count. A code span counts as one word and a link counts by its label. Fenced code, images and `<details>` blocks do not count, so long proof goes in `<details>`.

Review the finished body with a fresh subagent that gets only the body, not your plans. Apply its cuts.
