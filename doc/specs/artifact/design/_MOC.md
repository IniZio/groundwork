---
id: "C-ARTIFACT-DESIGN"
type: "moc"
title: "Artifact Model — Design"
tags: [moc, artifact, design]
---

# Artifact Model — Design

## Start here: reading path

```
1. concepts/groundwork-artifacts   — what the three artifact types are and why they exist
2. flows/slice-lifecycle           — how a slice moves through its four states
3. components/run-ledger-slice     — the primary data artefact (anatomy + field specs)
4. recipes/add-a-ticket            — create a durable ticket and link it to a slice
5. reference/slice-fields-reference — look up any slice field while working
```

## Concepts — explanations (Diátaxis: understanding)

| Note | What it explains |
|------|-----------------|
| [[concepts/groundwork-artifacts]] | The three artifact types, their persistence model, and their roles |

## Flows — decision paths and state machines

| Note | What it traces |
|------|---------------|
| [[flows/slice-lifecycle]] | State diagram + step table: the four statuses a slice moves through |

## Components — design-system pages for concrete artefacts

| Note | What it describes |
|------|------------------|
| [[components/run-ledger-slice]] | Full anatomy, field specs, and variants for a run-ledger slice |

## Recipes — how-to guides (Diátaxis: task)

| Note | Task |
|------|------|
| [[recipes/add-a-ticket]] | Create a ticket and link it to a run-ledger slice |

## Reference

| Note | What it covers |
|------|---------------|
| [[reference/slice-fields-reference]] | All slice fields, types, constraints, and CLI flags at a glance |

## Requirements (out-of-folder, same concept)

| Id | Title |
|----|-------|
| [[../requirements/artifact-r-001-ledger-records-slice-completion\|R-001]] | Ledger records slice completion |
| [[../requirements/artifact-r-003-stop-hook-incomplete-slice-guard\|R-003]] | Stop hook incomplete-slice guard |
| [[../requirements/artifact-r-004-journal-decision-events-require-structured-data-fields\|R-004]] | Journal DECISION events require structured data fields |
| [[../requirements/artifact-r-005-motive-archive-moves-directory-and-refuses-open-items\|R-005]] | Motive archive moves directory and refuses open items without --force |
| [[../requirements/artifact-r-006-map-out-of-scope-section-merges-three-sources\|R-006]] | MAP.md out-of-scope section merges three sources with identity-based dedup |
| [[../requirements/artifact-r-007-ticket-is-the-durable-work-object\|R-007]] | Ticket is the durable work object |
| [[../requirements/artifact-r-008-no-delete-invariant-for-markdown-files\|R-008]] | No-delete invariant for markdown files |
| [[../requirements/artifact-r-009-ticket-location-resolution\|R-009]] | Ticket location resolution |
| [[../requirements/artifact-r-010-slice-decisions-field-links-slices-to-journal-decision-events\|R-010]] | Slice decisions field links slices to journal decision events |
| [[../requirements/artifact-r-011-decision-revises-field-merges-same-id-events\|R-011]] | DECISION `revises` field merges same-id events |
| [[../requirements/artifact-r-012-ticket-filename-follows-nn-type-slug-convention\|R-012]] | Ticket filename follows NN-type-slug convention |
