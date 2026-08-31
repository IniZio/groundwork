# Fix: journal append requires data.decision but compile silently drops it when data.title is also present

Type: fix
Status: open
Blocked by: —

## Question

`journal append --type DECISION` requires `data.decision` (exits 2 if absent), yet the compiled
decision log exposes no `decision` field — it only surfaces `title`. When an event supplies both
`title` and `decision`, the decision text is silently discarded. This is P-B: a required
author-supplied field is accepted at write time and then dropped before it reaches the human read
path. What is the minimal fix?

## Context

The `cmdAppend` validator in `hooks/journal.mjs:572–578` enforces that DECISION events must carry
`data.decision` (exits 2 otherwise) and `data.id` and `data.rationale`. This is correct per D-11.

The compile step in `hooks/lib/motive-compile.mjs:187` derives the decision title as:

```js
title: d.title ?? d.decision ?? null,
```

This means:
- if `d.title` is present → `title = d.title` and `d.decision` is never promoted
- if `d.title` is absent → `title = d.decision` (the decision text promoted to title)

The compiled decision entry exposes only `title` — there is no standalone `decision` field in the
output (`motive-compile.mjs:186–194`). So any DECISION event that supplies **both** `title` and
`decision` has its decision text silently discarded from the compiled log; only the title survives.

This was empirically reproduced in session `9baa5337`: the first D-88 recovery append carried both
`title` and `decision`; the phrase "evaluation yardstick" (the decision text) was absent from the
compiled log until the append was redone omitting `title`, which caused the fallback to promote
`decision` into `title`. The TBD notes this is DISTINCT from TBD-28 (`alternatives` dropped,
closed non-repro via D-87) and TBD-12 (decision key OMITTED → null, resolved D-55).

## Evidence

- `hooks/journal.mjs:572–578` — DECISION validation: `data.decision` is required (exit 2 if
  absent); so the field is always present in the written event.
- `hooks/lib/motive-compile.mjs:187` — `title: d.title ?? d.decision ?? null`: decision text used
  only as fallback when `title` is absent; both fields present → decision text is discarded.
- `hooks/lib/motive-compile.mjs:186–194` — compiled decision entry schema: no `decision` field;
  only `id`, `status`, `title`, `rationale`, `alternatives`, `ord`, `ts`, `supersedes`,
  `superseded_by`, `resolves`.
- Session `9baa5337` empirical repro: D-88 first append with both `title` and `decision` — phrase
  "evaluation yardstick" absent from compiled log until append redone without `title`.
- TBD-34 body at `.groundwork/motives/groundwork-development/open-items/tbd-34.md`: "a required,
  author-supplied field detected at write time and dropped before it reaches the human read path."

## Decision

**Expose a standalone `decision` field in the compiled decision entry so the decision text is never discarded, regardless of whether `title` is also present; keep `title` as the human-facing display label (falling back to `decision` when absent) and surface `decision` as the first-person verdict.**

This preserves backward compat (title still exists for renderers that use it) while ensuring the
decision text — the explicit answer — survives compilation and is accessible in the compiled spine.

## Ruled out

- **Reject a DECISION event at append time when both `title` and `decision` are present.**
  Would break existing authoring workflows where agents supply a `title` (human label) and a
  `decision` (verdict sentence) separately. The fix should be non-breaking at write time.

- **Drop the `data.decision` requirement and make it optional.** This reverses D-11, which exists
  precisely to prevent swallowed-signal class P-B bugs. The requirement stays; the compile step
  must surface it.

- **Rename `data.decision` to `data.title` at the journal API level.** Would require migrating all
  existing event consumers and existing journal shards. Disproportionate churn for a field-exposure
  fix.

## Revisions

None yet.

## Links

- Graduated from: TBD-34 (journal append requires data.decision but compile drops it when title present)
- `hooks/journal.mjs:572–578` — DECISION validation (data.decision required)
- `hooks/lib/motive-compile.mjs:187` — title derivation that discards decision text
- `hooks/lib/motive-compile.mjs:186–194` — compiled decision entry schema
- Related: D-11 (DECISION events require data.id to reach Decision Log intact)
- Related: TBD-12 (decision key omitted → null, resolved D-55 — distinct issue)
