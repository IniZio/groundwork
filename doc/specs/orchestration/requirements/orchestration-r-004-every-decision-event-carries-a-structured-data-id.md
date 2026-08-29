---
id: "orchestration-r-004"
title: "Every DECISION event carries a structured data.id"
concept: "[[orchestration/index]]"
criticality: "must"
verification: "automated"
ears_pattern: "IF-THEN"
verification_method: "Test"
design: "[[design#Ledger CLI interface]]"
status: "open"
source: "groundwork-development#D-36"
---

## Statement

When any orchestrator or subagent appends a journal event of type `DECISION`, the `--data` JSON payload **shall** include a non-empty `data.id` field (e.g. `"D-37"`). `hooks/journal.mjs` **shall** exit with code 2 and name the missing field when `data.id` is absent; the event **shall not** be persisted. No other journal operation requires `data.id`.

## Why

A DECISION event without a stable id cannot be referenced from MAP.md, from ticket cross-links, or from future supersession events. An unaddressable decision is effectively invisible to tooling that traces the rationale chain. Exiting non-zero rather than persisting a malformed event prevents silent data corruption — the caller must supply a valid id before the event enters the journal (D-36 revised by current session).

## Fit criterion

`journal append --type DECISION --motive x --msg m --data '{"id":"D-42","decision":"d","rationale":"r"}'` exits 0 with no warning; omitting `data.id` from the payload exits 2 and the error message names `data.id` as the missing field; no event is written to the journal shard.

## Verification procedure

**Automated** — `hooks/journal.mjs` enforces exit 2 on every DECISION append missing `data.id`; the test in `test/hooks/t6-decision-discipline.test.ts` covers this path.
