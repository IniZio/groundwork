# Completion

**Completion** in groundwork means real-world validity, not internal consistency.

## What "done" is not

- Tests passing locally — internal consistency only
- Slices marked `complete` — ledger bookkeeping only
- Self-reported summaries from implementer agents — not evidence

## What "done" is

A non-trivial task is done when:

1. All ledger slices are `complete` or `skipped`
2. The advisor has executed real-world verification and returned `APPROVE`
3. `gate.advisor = "APPROVE"` is recorded in the run ledger

Real-world verification depends on task type:

| Task type | Real-world evidence |
|-----------|---------------------|
| Backend feature | Live API call or integration test against real server |
| UI change | Pixel-check against design in a real browser |
| PR / CI | CI watched to completion (not just locally green) |
| Hook / CLI | Spawn by exec path, not `node <path>` directly |
| Spec change | `spec-lint` passes; affected tests updated |

## Risk tiers

| Tier | When | Gate sequence |
|------|------|---------------|
| Trivial | Typo/config, no ledger, small verification surface | `advisor()` only — or skip if truly zero-risk |
| Small change / bug fix | <1h, localized, single domain | `advisor()` |
| Feature / shared-code / security / multi-slice | Ledger exists, or touches API/auth/shared | `[qa if interactive UI]` → `advisor()` |
