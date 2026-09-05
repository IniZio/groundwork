---
name: arch-review
description: Analyze codebase architecture in isolated subagents and produce a prioritised HTML report of shallow modules, coupling smells, and testability gaps — findings never enter main context.
---

# Architecture Review

Trigger: user asks "review the structure", "any concerns about the codebase?", "improve architecture", or you notice repeated friction (same files touched every change, test setup growing unwieldy).

## Glossary

Use these terms exactly in all findings and reports:

- **Module** — anything with an interface and an implementation (function, class, package, file)
- **Deep module** — high leverage: significant behaviour behind a small interface
- **Shallow module** — low leverage: interface nearly as complex as the implementation
- **Seam** — where an interface lives; where behaviour can be altered without editing in place
- **Locality** — change, bugs, and knowledge concentrated in one place
- **Deletion test** — delete the module mentally: does complexity vanish (pass-through) or reappear across N callers (earning its keep)?

## Phase 1 — Explore in parallel subagents

Spawn multiple `Explore` subagents simultaneously, one per codebase area: core domain, entry points, data layer, shared utilities, test structure. Adapt areas to the actual project shape.

See [`reference/explore-prompt.md`](reference/explore-prompt.md) for the subagent prompt template and finding schema.

After all subagents return: deduplicate by file, discard speculative findings that duplicate stronger ones, keep ≤15 candidates.

**Isolation failure** — exploration output that enters your conversation directly instead of via Task return values breaks the context-budget guarantee. Collect only via Task return values; if a subagent returns >20 lines, ask it to summarise to ≤10 bullets before returning.

## Phase 2 — HTML report

Write a self-contained HTML report to the OS temp directory (`arch-review-<timestamp>.html`). Open it and print the absolute path.

See [`reference/report-format.md`](reference/report-format.md) for card fields, CDN details, the top-recommendation section, and the compact summary format.

Present the compact summary to the user (≤12 lines total) listing candidates with one-line descriptions and the report path.

**No-repo-files failure** — writing report files into the repo instead of temp dir pollutes the working tree and breaks the isolation guarantee. Temp dir only.

Then run the advisor gate with: total candidates found, strength distribution, top recommendation, any ADRs that would be contradicted.

Completion: `advisor-gate` returns APPROVE.

## Phase 3 — Grilling loop

Walk through constraints, dependencies, and the shape of a deepened module. Challenge shallow reasoning: "if we deleted this module, where does the complexity go?"

As decisions crystallize:

- **New concept not in project docs** → offer to add it to `CONTEXT.md` (create lazily if absent); use project domain vocabulary, not generic terms
- **User rejects with a load-bearing reason** → offer an ADR so future reviews don't re-suggest it; skip for ephemeral reasons ("not now") or self-evident ones
- **Ready to act** → route to `groundwork:general-purpose` with the candidate description, agreed interface shape, and success criteria
- **Durable architectural lesson** → invoke `/retrospective` to persist it in the Learnings KB; the HTML report is ephemeral, `/retrospective` is not
