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

`motive-map.mjs` **shall** derive `last_pause` by calling `.find()` on a newest-first event list to retrieve the most recent PAUSE event; it **shall not** use `.filter().pop()` on the same newest-first list, which would return the **oldest** PAUSE event. Both `motive-map.mjs` and `motive-compile.mjs` **shall** agree on the event ordering convention used for PAUSE extraction; divergence between the two surfaces constitutes a seam defect.

- **Why** — The event list returned by `_readAllMotiveEvents` is sorted newest-first. On a newest-first list, `.find()` returns the first match, which is the most recent event — correct. `.filter().pop()` on the same list returns the last element of the filtered array, which is the oldest PAUSE event — producing a stale `last_pause` in MAP.md. A reader relying on MAP.md to find the last session break would see the wrong timestamp, potentially resuming from an outdated context.
- **Fit criterion** — A motive with two PAUSE events (timestamps T1 < T2) shows `last_pause` equal to T2's timestamp in `MAP.md`. The value matches the most recent PAUSE event's timestamp, not the earliest.
- **Verification**: manual — Inspect `hooks/lib/motive-map.mjs` lines 100–102: confirm the derivation uses `.find()` not `.filter().pop()`. On a throwaway motive, append two PAUSE events with different timestamps and regenerate MAP.md; confirm `last_pause` in the file reflects the later timestamp. Source: `hooks/lib/motive-map.mjs` lines 100–102 (comment explicitly documents the `.find()` vs `.filter().pop()` distinction).
- **Criticality**: should
