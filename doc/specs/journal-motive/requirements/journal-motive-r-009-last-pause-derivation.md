---
id: journal-motive-r-009
type: requirement
concept: C-JOURNAL-MOTIVE
criticality: should
verification: manual
status: open
title: "last_pause derivation event ordering"
---

## JOURNAL-MOTIVE-R-009 — last_pause derivation event ordering {#journal-motive-r-009}

`motive-compile.mjs` **shall** derive `last_pause` by processing PAUSE events from an oldest-first (chronological) event stream and overwriting `lastPause` on each PAUSE event encountered, so that the final value is the most recent PAUSE event. The event stream **shall** be produced by `readOrderedEvents` (`hooks/lib/journal-order.mjs`), which sorts by `(ts → shard → line)` ascending. The overwrite pattern on an oldest-first stream is equivalent to calling `.find()` on a newest-first stream — both yield the most recent PAUSE event.

- **Why** — `readOrderedEvents` returns events sorted oldest-first (chronological). An overwrite pattern (`lastPause = …` on each PAUSE) naturally yields the last-seen PAUSE, which is the most recent. The prior two-deriver seam (`motive-map.mjs` newest-first + `.find()` vs `motive-compile.mjs` oldest-first + overwrite) was a latent source of ordering disagreement; the deletion of `motive-map.mjs` resolves the seam — only one derivation of `last_pause` remains. A resuming agent relies on `agent.last_pause` from `journal compile` output to find the last session break; a stale value would cause it to resume from an outdated context.
- **Fit criterion** — A motive with two PAUSE events (timestamps T1 < T2): `journal compile` output shows `agent.last_pause` carrying the T2 event's `pointer`, `summary`, and `next_actions`. The value matches the most recent PAUSE event, not the earliest.
- **Verification**: manual — Inspect `hooks/lib/motive-compile.mjs:303`: the `case 'PAUSE':` block sets `lastPause` via overwrite. Inspect `hooks/lib/journal-order.mjs:75` (`readOrderedEvents`): confirm events are sorted `compareEvents` (ascending by `ts → shard → line`). On a throwaway motive, append two PAUSE events with different timestamps; run `bun bin/journal compile <slug>`; confirm `agent.last_pause` in the output reflects the later timestamp.
- **Criticality**: should
