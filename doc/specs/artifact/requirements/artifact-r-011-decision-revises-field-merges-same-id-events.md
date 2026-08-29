---
id: "artifact-r-011"
title: "DECISION `revises` field merges same-id events; `unmarked_collision` flags unintended duplicates"
concept: "[[artifact/index]]"
criticality: must
verification: unverified
ears_pattern: WHEN
verification_method: Test
design: "[[design/concepts/groundwork-artifacts]]"
status: open
---

## Statement

When `journal compile` processes a motive's DECISION events, `hooks/lib/motive-compile.mjs` shall merge all events sharing the same `data.id` into a single compiled entry retaining the earliest `ts`; if at least one contributing event carries a `data.revises` field equal to the entry's own `data.id` the merged entry shall not receive `unmarked_collision`; if no contributing event carries `data.revises` equal to the entry's own `data.id` the merged entry shall carry `unmarked_collision: true`. A `data.revises` field naming the entry's own id on an individual DECISION event marks the author's intent that this append is an intentional same-id refinement and shall suppress the motive-scoped stderr collision warning emitted by `journal append`. A `data.supersedes` field is a distinct operation targeting a different `data.id`: both the superseding and the superseded entries shall appear as separate rows in the compiled output; the superseded entry's `status` shall be set to `'superseded'` and its `superseded_by` shall be set to the superseding id.

## Why

Same-id events without `revises` are likely copy-paste errors or accidental id reuse; flagging them `unmarked_collision: true` lets downstream tools (e.g. the Stop hook advisory) surface the anomaly without silently discarding data. The `revises`/`supersedes` asymmetry cleanly separates refinement of an existing decision from replacement by a new one.

## Fit criterion

Two DECISION events with the same `data.id` and no `revises` field compile to one entry with `unmarked_collision: true`. Two events with the same `data.id` where one carries `data.revises` equal to that id compile to one entry without `unmarked_collision`. A `data.supersedes` pointing at a different id produces two rows in the compiled output, the superseded row with `status: 'superseded'` and `superseded_by` set.

## Verification procedure

Automated — `motive-compile.mjs` is covered by unit tests exercising collision, revises, and supersedes scenarios.
