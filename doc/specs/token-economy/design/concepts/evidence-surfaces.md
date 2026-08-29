---
tags: [concept, token-economy]
---

# Evidence Surfaces

Evidence surfaces are zones where compression is forbidden entirely. Text on these surfaces must be quoted or reproduced exactly as it appears in its source.

---

## Enumerated evidence surfaces

| Surface | Examples |
|---|---|
| Advisor citations | `APPROVE — tests passed, 41/41, no filter` |
| Ledger entries | JSON slice objects, gate records |
| Gate evidence | The evidence block attached to a gate verdict |
| Test output | Lines from a vitest/jest run, including test ids and counts |
| `file:line` references | `src/lib/foo.ts:45` |
| Error text | Stack traces, compiler errors, hook exit messages |
| Code blocks | Any fenced ` ``` ` block |

## Why compression is forbidden here

Terse summaries manufacture false claims at the highest-cost point. Two documented failure modes from this repo:

1. **False approve**: "tests appear to pass" → "tests pass" collapses an uncertain signal into a fact. The gate reads the compressed form and issues APPROVE against fabricated evidence.
2. **Stale evidence**: a summary of test output from a prior run passes off old results as current. Verbatim reproduction forces the reviewer to see the timestamp and test ids.

Compression saves tokens on filler. Evidence surfaces have no filler. Every word in an advisor citation or error message is load-bearing — there is nothing to remove without changing the claim.

See [[../requirements/token-economy-r-003-compression-is-forbidden-on-evidence-surfaces|R-003]] for the normative statement.
