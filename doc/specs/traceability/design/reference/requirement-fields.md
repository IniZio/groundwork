---
title: "Requirement Fields Reference"
concept: "[[traceability/index]]"
status: "draft"
date_updated: "2026-08-29"
---

# Requirement Fields Reference

All fields used in a `doc/specs/<concept>/requirements/<id>-<kebab>.md` requirement document.

## Frontmatter fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Lowercase requirement identifier, e.g. `"traceability-r-001"` |
| `title` | string | yes | Short human title |
| `concept` | string | yes | Wikilink to the concept index, e.g. `"[[traceability/index]]"` |
| `criticality` | `must` \| `should` | yes | Requirement strength per RFC 2119 |
| `verification` | `automated` \| `manual` | yes | How the requirement is verified |
| `ears_pattern` | string | recommended | EARS pattern type (e.g. `IF-THEN`, `UBIQUITOUS`, `EVENT-DRIVEN`) |
| `verification_method` | `Test` \| `Inspection` | recommended | Verification technique |
| `status` | `open` \| `closed` | yes | Whether the requirement is still active |
| `source` | string | recommended | Decision ref that originated the requirement (e.g. `tracking-viz#D-7`) |
| `design` | string | optional | Wikilink to the design note implementing this requirement |

## Body sections

| Section | Purpose |
|---|---|
| `## Statement` | The normative shall-statement |
| `## Why` | Rationale — why this requirement exists |
| `## Fit criterion` | Observable, testable condition that proves the requirement is met |
| `## Verification procedure` | Steps to verify (automated: test assertions; manual: inspection steps) |

## Traceability link types

| Link type | Direction | Carried by | Emitted as |
|---|---|---|---|
| `covers` | slice → spec-req | `slice.covers_ac` or decision cross-join | Graph edge, kind `covers` |
| `confirms` | test → slice | `@verifies` annotation or `slice.test_paths` | Graph edge, kind `confirms` |
| `seals` | gate → slice | GATE APPROVE journal event | Graph edge, kind `seals` |
| `evidences` | artifact-evidence → live-verify | VERIFICATION journal event + artifact ref | Graph edge, kind `evidences` |

## Edge classification legend

| Classification | Condition | Visual treatment |
|---|---|---|
| proven | GATE APPROVE event present + live-verify pass on record | Solid, filled |
| unproven | Slice exists, no gate or live-verify recorded | Dashed |
| stale | Evidence hash ≠ current build hash | Warning color |
| missing | Required link absent from graph | Red / gap marker |
