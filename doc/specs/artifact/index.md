---
id: "C-ARTIFACT"
type: "moc"
title: "Artifact Model"
summary: "The three groundwork artifact types—run ledger, session journal, and spec tree—are file-backed records that persist across sessions."
parent: null
status: draft
depends_on:
  - "C-GROUNDWORK"
date_updated: "2026-08-29"
tags:
  - artifact
  - ledger
  - journal
  - spec
aliases: []
origin_decision_ref: "plugin-cleanup#D-5"
---

# Artifact Model

> This index covers the three groundwork artifact types and their invariants. Start at [[design/_MOC]] for the reading path and curated links.

## Quick links

| | |
|---|---|
| Design (folder) | [[design/_MOC]] |
| Groundwork artifacts concept | [[design/concepts/groundwork-artifacts]] |
| Slice lifecycle flow | [[design/flows/slice-lifecycle]] |
| Run-ledger slice (component) | [[design/components/run-ledger-slice]] |
| Recipe: add a ticket | [[design/recipes/add-a-ticket]] |
| Slice fields reference | [[design/reference/slice-fields-reference]] |
| Decisions | [[decisions/]] |

## Requirements

| Id | Title |
|----|-------|
| [[requirements/artifact-r-001-ledger-records-slice-completion\|R-001]] | Ledger records slice completion |
| [[requirements/artifact-r-003-stop-hook-incomplete-slice-guard\|R-003]] | Stop hook incomplete-slice guard |
| [[requirements/artifact-r-004-journal-decision-events-require-structured-data-fields\|R-004]] | Journal DECISION events require structured data fields |
| [[requirements/artifact-r-005-motive-archive-moves-directory-and-refuses-open-items\|R-005]] | Motive archive moves directory and refuses open items without --force |
| [[requirements/artifact-r-006-map-out-of-scope-section-merges-three-sources\|R-006]] | MAP.md out-of-scope section merges three sources with identity-based dedup |
| [[requirements/artifact-r-007-ticket-is-the-durable-work-object\|R-007]] | Ticket is the durable work object |
| [[requirements/artifact-r-008-no-delete-invariant-for-markdown-files\|R-008]] | No-delete invariant for markdown files |
| [[requirements/artifact-r-009-ticket-location-resolution\|R-009]] | Ticket location resolution |
| [[requirements/artifact-r-010-slice-decisions-field-links-slices-to-journal-decision-events\|R-010]] | Slice decisions field links slices to journal decision events |
| [[requirements/artifact-r-011-decision-revises-field-merges-same-id-events\|R-011]] | DECISION `revises` field merges same-id events; `unmarked_collision` flags unintended duplicates |
| [[requirements/artifact-r-012-ticket-filename-follows-nn-type-slug-convention\|R-012]] | Ticket filename follows NN-type-slug convention; type is a closed enum |
