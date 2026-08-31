# Fix: seven legacy id-less DECISION events produce duplicate MAP entries

Type: fix
Status: open
Blocked by: —

## Question

MAP.md's "Decisions so far" section shows six visible duplicate pairs from a 2026-08-03 backfill.
The backfill added structured D-1..D-6 entries but never linked them to the id-less originals.
Why does `_dedupeDecisions` fail to suppress them, and what is the correct fix?

## Context

On 2026-08-03, the structured backfill at `.groundwork/journal/2026-08-03-d7a17626-ed73-44c9-86ed-7ac8af507fde.jsonl` lines 105–110 created D-1..D-6 DECISION entries to give structured ids to six earlier id-less DECISION events at lines 98–103 in the same shard. The backfill was correct in intent — adding structured ids per D-11 — but it did not add `data.retires` linkage from the new entries back to the originals.

`_dedupeDecisions` in `hooks/lib/motive-map.mjs:231` uses two steps to suppress duplicates:

**Step 1** (`motive-map.mjs:232–258`): honour structured `data.supersedes` / `data.retires`
linkage. This would have worked if the D-1..D-6 backfill entries had carried
`data.retires: <msg-of-original>` or `data.supersedes: <id>`. They did not, so step 1 produces
no suppressions for these pairs.

**Step 2** (`motive-map.mjs:334–390`): first-sentence strict-prefix dedup. This merges pairs where
one event's first sentence is a strict prefix of the other's. The six legacy pairs fail it because
the original messages and the backfill messages have different word order or phrasing, not just
truncation:

- "Problem definition adopted (P-A through P-E)…" vs "Problem definition P-A through P-E adopted…"
- "Wayfinder-inspired formalization adopted (step 4)…" vs "Wayfinder-inspired formalization (step 4) adopted…"

These are NOT strict-prefix relationships; they are paraphrase/reordering. So step 2 also fails.

The result: all six id-less originals plus all six structured D-1..D-6 entries survive dedup,
producing twelve distinct MAP entries that render as six visible duplicate pairs.

Note: the TBD originally counted six pairs; the open-items body states "seven legacy id-less
DECISION events" (including the pilot comparison event that was omitted from an earlier count).

## Evidence

- `.groundwork/journal/2026-08-03-d7a17626-ed73-44c9-86ed-7ac8af507fde.jsonl` lines 98–103:
  six id-less DECISION events (no `data.id`); messages begin "Problem definition adopted (P-A…",
  "Folder structure: doc/ is the ONLY committed doc root…", "Motive/spec unification steps
  1-3 adopted…", "Wayfinder-inspired formalization adopted (step 4)…", "Plan docs retired as
  active artifacts…", "ASD-STE100 controlled-prose style NOT adopted…".
- Same shard, lines 105–110: D-1..D-6 structured DECISION events carrying `data.id` but no
  `data.retires` back-link to lines 98–103.
- `hooks/lib/motive-map.mjs:231` — `_dedupeDecisions` function.
- `hooks/lib/motive-map.mjs:244–255` — step 1: reads `data.retires` to add to `supersededIds`;
  absent on the D-1..D-6 entries so originals are not suppressed.
- `hooks/lib/motive-map.mjs:334–390` — step 2: first-sentence strict-prefix; fails on
  paraphrase/word-order differences.
- TBD-30 body confirms: "all six legacy pairs fail it (e.g. 'problem definition adopted (p-a...'
  vs 'problem definition p-a through...'; 'wayfinder-inspired formalization adopted (step 4)'
  vs 'wayfinder-inspired formalization (step 4) adopted')".

## Decision

**Append one retraction journal event per id-less original carrying `data.retires: <matching-msg>` (or a descriptive text reference that token-overlap can match), routing each id-less original through `_dedupeDecisions` step 1 and suppressing it from MAP output.**

This is a data fix (new journal events), not a code change. The retraction events use the existing
`data.retires` vocabulary (D-36) consumed by step 1 at `motive-map.mjs:244–255`. No change to
`_dedupeDecisions` logic is required; the infrastructure already supports this.

Optionally, after the data fix, relax step 2 beyond strict-prefix to handle paraphrase — but this
is not required for the immediate fix and risks false merges on genuinely distinct decisions.

## Ruled out

- **Relax step 2 strict-prefix matching to fuzzy/token-overlap.** The strict-prefix rule is
  intentional — it prevents collapsing decisions that happen to share an opening phrase. Widening
  it to paraphrase matching would risk false merges. Data fix via `data.retires` is cleaner and
  does not touch the dedup algorithm.

- **Delete the id-less originals from the journal shard.** Journal files are append-only and
  immutable once written. Editing them directly breaks provenance. Never delete from journal shards.

- **Regenerate the backfill with `data.retires` links.** Would require amending lines 105–110 in
  the journal shard — same problem as deleting (breaks immutability). Instead, append new
  retraction events after the existing entries.

## Revisions

None yet.

## Links

- Graduated from: TBD-30 (Seven legacy id-less DECISION events produce duplicate MAP entries)
- `.groundwork/journal/2026-08-03-d7a17626-ed73-44c9-86ed-7ac8af507fde.jsonl` — shard with id-less originals (lines 98–103) and backfill (lines 105–110)
- `hooks/lib/motive-map.mjs:231` — `_dedupeDecisions` function
- `hooks/lib/motive-map.mjs:244–255` — step 1: `data.retires` suppression
- `hooks/lib/motive-map.mjs:334–390` — step 2: strict-prefix dedup
- Related: D-36 (data.retires authoring vocabulary for retraction)
- Related: TBD-3 (id-less DECISION events produce duplicate MAP entries — original observation, now includes this scope)
