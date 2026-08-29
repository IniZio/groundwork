---
id: "artifact-r-001"
title: "Ledger records slice completion"
concept: "[[artifact/index]]"
criticality: must
verification: unverified
ears_pattern: WHEN
verification_method: Test
design: "[[design/components/run-ledger-slice]]"
status: open
---

## Statement

When a vertical slice is marked complete via the ledger CLI, `hooks/ledger.mjs` shall persist the slice id, completion timestamp, and session id to `.groundwork/runs/<session_id>.json`.

## Why

The Stop hook reads the ledger to gate session end; an entry without a session id cannot be attributed to the run that produced it, so a concurrent session's completions would incorrectly satisfy this session's gate, allowing premature termination.

## Fit criterion

After `ledger complete s3`, the `s3` entry carries non-null `id`, ISO-8601 `completed_at`, and `session_id` matching the completing session.

## Verification procedure

Automated — `hooks/ledger.mjs` persists these fields on every `complete` command; the Stop hook reads them to validate gate satisfaction.

See also: [ARTIFACT-R-003](artifact-r-003-stop-hook-incomplete-slice-guard.md)
