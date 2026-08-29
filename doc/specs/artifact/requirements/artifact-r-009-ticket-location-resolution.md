---
id: "artifact-r-009"
title: "Ticket location resolution"
concept: "[[artifact/index]]"
criticality: must
verification: unverified
ears_pattern: WHEN
verification_method: Test
design: "[[design/recipes/add-a-ticket]]"
status: open
source: "groundwork-development#D-37"
---

## Statement

When resolving the directory in which to create or read ticket files for a motive, groundwork shall use the following resolution order: (1) if the motive charter contains a `tickets_dir` field, use that path; (2) otherwise default to `.groundwork/motives/<slug>/tickets/`. The resolved directory shall be created if absent. An empty or missing ticket corpus shall not cause any error in `ledger`, `journal`, or MAP.md regeneration.

## Why

The default path is gitignored, giving tickets no version-control history and no PR review surface. Projects that want version-controlled tickets can point `tickets_dir` at a committed directory (e.g. `doc/tickets/`). The fallback default keeps zero-config motives working without any charter change, while the override lets teams adopt a committed workflow incrementally.

## Fit criterion

A motive charter with `tickets_dir: doc/tickets` causes new tickets to be written under `doc/tickets/`; a charter without `tickets_dir` causes tickets to be written under `.groundwork/motives/<slug>/tickets/`; a motive with no ticket files at all completes `ledger add`, `ledger complete`, `journal append`, and MAP.md regeneration without error.

## Verification procedure

Automated — the location resolver is tested with both a charter-override case and a default-fallback case; back-compat is verified by the T8 end-to-end test.
