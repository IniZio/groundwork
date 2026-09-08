---
id: token-economy-r-009
type: requirement
concept: C-TOKEN-ECONOMY
title: "Turn count and cache-read attribution are reported per session"
criticality: must
verification: automated
status: open
---

## TOKEN-ECONOMY-R-009 — Turn count and cache-read attribution are reported per session {#token-economy-r-009}

The token-measurement harness (`hooks/token-meter.mjs`) **shall** report `turn_count` and `cache_read_per_turn` for every session it parses.

`turn_count` is the number of unique API calls in the session, derived by counting unique `requestId` values among assistant records that carry billing usage. When no `requestId` is present in the transcript (e.g. synthetic fixtures), `turn_count` falls back to `record_count`.

`cache_read_per_turn` is `cache_read_input_tokens / turn_count`, a finite number (0 when `turn_count` is 0). It is the per-call cache-read handle that lets an analyst project how much the cache-read line changes as turn count changes.

- **Why** — D-12 argues that cache-read reaches 42.8% of spend by being multiplied across every turn, making turn count a larger savings lever than prefix size. Without a per-turn metric, that argument is an unmeasured inference. `cache_read_per_turn` and `turn_count` make it measurable. TBD-5 (the broader creation-vs-read cost weighting question) remains open and is tracked separately as T32.
- **Fit criterion** — `parseTotals` returns an object with numeric `turn_count` and `cache_read_per_turn` fields. `turn_count` equals the number of unique `requestId` values when `requestId` is present; it equals `record_count` otherwise. `cache_read_per_turn` equals `cache_read_input_tokens / turn_count` to within floating-point precision. `formatReport` emits a `Turns :` line and a `cache_read_per_turn` line. Both fields are present and non-negative when run against a real session transcript.
- **Verification**: automated — `@verifies test/hooks/token-meter.test.ts` tests 10–15.
- **Criticality**: must
