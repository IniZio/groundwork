---
id: "artifact-r-006"
title: "MAP.md out-of-scope section merges three sources with identity-based dedup"
concept: "[[artifact/index]]"
criticality: must
verification: unverified
ears_pattern: WHEN
verification_method: Test
design: "[[design/concepts/groundwork-artifacts]]"
status: open
---

## Statement

When MAP.md is regenerated, `hooks/lib/motive-map.mjs` shall merge the charter `out_of_scope` prose, filenames from `.groundwork/out-of-scope/*.md` (dashes converted to spaces), and rejection DECISION events into the Out of scope section; deduplicate rejection events by strict first-sentence prefix (keeping the longer prose form and appending absorbed decision ids in parentheses); and render the empty-state line `_Nothing explicitly ruled out yet._` only when all three sources contribute no entries.

## Why

A single consolidated view of out-of-scope decisions prevents the orchestrator from re-planning rejected features; strict first-sentence dedup (not session-based) collapses summary and full-prose forms of the same rejection to the richer entry without losing the absorbed decision id; the empty-state line must be suppressed whenever any source has content, because mixing content with the placeholder produces a misleading section.

## Fit criterion

With two rejection DECISION events where the earlier event's first sentence is a strict prefix of the later event's, only the later (longer) entry appears, with the earlier event's `data.id` appended as `(D-X)`; an `.groundwork/out-of-scope/dark-mode.md` file renders as `- dark mode`; the `_Nothing explicitly ruled out yet._` line is absent when any source contributes at least one entry.

## Verification procedure

Automated — unit tests in `test/` assert the merge and dedup logic against fixtures covering each of the three source types and the empty-state rendering.
