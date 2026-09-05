# Requirement anatomy — complete worked example

Canonical source for the worked example cited in the spec skill body.

## EARS pattern table

| Pattern | Template |
|---|---|
| Ubiquitous | `The <system> **shall** <response>.` |
| Event-driven | `**When** <trigger>, the <system> **shall** <response>.` |
| State-driven | `**While** <precondition>, the <system> **shall** <response>.` |
| Optional-feature | `**Where** <feature included>, the <system> **shall** <response>.` |
| Unwanted-behaviour | `**If** <trigger>, **then** the <system> **shall** <response>.` |
| Prohibition | `The <system> **shall not** <proscribed-action>.` |

## Complete example

```markdown
---
id: artifact-r-001
type: requirement
concept: C-ARTIFACT
criticality: must
verification: automated
status: implemented
---

## ARTIFACT-R-001 — Ledger records slice completion {#artifact-r-001}

**When** a vertical slice is marked complete via the ledger CLI, `hooks/ledger.mjs`
**shall** persist the slice id, completion timestamp, and session id to
`.groundwork/runs/<session_id>.json`.

- **Why** — the Stop hook reads the ledger to gate session end; an entry without a
  session id cannot be attributed to the run that produced it, so a concurrent
  session's completions would incorrectly satisfy this session's gate, allowing
  premature termination.
- **Fit criterion** — after `ledger complete s3`, the `s3` entry carries non-null
  `id`, ISO-8601 `completed_at`, and `session_id` matching the completing session.
- **Verification**: automated — vitest tests in test/ exercise the ledger complete command.
- **Criticality**: must
- **See also** [ARTIFACT-R-002](#artifact-r-002)
```

## Cross-reference forms

- Same file: `[ARTIFACT-R-002](#artifact-r-002)`
- Cross-concept: `[VERIFICATION-R-001](../verification/requirements/verification-r-001.md)`

Cross-concept links point to individual requirement files, not anchors in a monolithic file.
