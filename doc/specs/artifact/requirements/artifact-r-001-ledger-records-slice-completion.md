---
id: "artifact-r-001"
type: requirement
concept: C-ARTIFACT
criticality: must
verification: automated
status: open
design: "[[design/components/run-ledger-slice]]"
---

## ARTIFACT-R-001 — Ledger records slice completion {#artifact-r-001}

When a vertical slice is marked complete via the ledger CLI, `hooks/ledger.mjs` **shall** persist the slice id, completion timestamp, and session id to `.groundwork/runs/<session_id>.json`.

- **Why** — The Stop hook reads the ledger to gate session end; an entry without a session id cannot be attributed to the run that produced it, so a concurrent session's completions would incorrectly satisfy this session's gate, allowing premature termination.
- **Fit criterion** — After `ledger complete s3`, the `s3` entry carries non-null `id`, ISO-8601 `completed_at`, and `session_id` matching the completing session.
- **Verification**: automated — `hooks/ledger.mjs` persists these fields on every `complete` command; the Stop hook reads them to validate gate satisfaction.
- **Criticality**: must

See also: [ARTIFACT-R-003](artifact-r-003-stop-hook-incomplete-slice-guard.md)
