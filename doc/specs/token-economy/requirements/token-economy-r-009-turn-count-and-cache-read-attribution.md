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

- **Why** — D-12 argues that cache-read reaches 42.8% of spend by being multiplied across every turn, making turn count a larger savings lever than prefix size. Without a per-turn metric, that argument is an unmeasured inference. `cache_read_per_turn` and `turn_count` make it measurable. TBD-5 is settled by test 16 — see measured distribution below.
- **Fit criterion** — `parseTotals` returns an object with numeric `turn_count` and `cache_read_per_turn` fields. `turn_count` equals the number of unique `requestId` values when `requestId` is present; it equals `record_count` otherwise. `cache_read_per_turn` equals `cache_read_input_tokens / turn_count` to within floating-point precision. `formatReport` emits a `Turns :` line and a `cache_read_per_turn` line. Both fields are present and non-negative when run against a real session transcript. `turn_count` is strictly less than `record_count` in any real session (a session has multiple billing records across turns).
- **Verification**: automated — `@verifies test/hooks/token-meter.test.ts` tests 10–16a.
- **Criticality**: must

## TBD-5 measured distribution (settled by T32 / test 16)

Command: `env -u CLAUDE_PROJECT_DIR -u CLAUDE_PLUGIN_ROOT CLAUDE_CODE_SESSION_ID=gate node -e "import('/path/to/hooks/token-meter.mjs').then(({parseTotals,computeCost})=>{ /* iterate ~/.claude/projects/ */ })"` — see ctx_execute in T32 session transcript for the full script.

Measured 2026-09-08 across **266 sessions** with billing data (49 projects, 548 total JSONL files):

| Metric | Value |
|---|---|
| Volume-weighted cache_read share | **55.4%** |
| Volume-weighted cache_creation share | **28.8%** |
| Volume-weighted output share | **15.8%** |
| Per-session mean cache_read % | **41.0%** |
| Per-session median cache_read % | **46.9%** |
| Per-session p25 / p75 | 27.3% / 56.5% |
| Sessions with cache_read > 40% | 167 / 266 (62.8%) |
| cache_creation_5m share of creation tokens | ~0% (all creation is 1h-TTL) |

**D-12 verdict**: SUPPORTED. D-12 claimed 42.8%; the per-session mean is 41.0% and the volume-weighted figure is 55.4% (long sessions skew higher). The real-world 5m bucket is empty — all cache_creation is 1h-TTL, consistent with stable system prompts across sessions. Slices T26 and T28 may proceed.
