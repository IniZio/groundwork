---
id: "C-TRACEABILITY"
type: "moc"
title: "Traceability"
summary: "Links spec requirements to ledger slices and verification evidence; SpineAdapter isolates the data store."
parent: null
status: "draft"
depends_on: []
date_updated: "2026-08-29"
tags: ["traceability", "spine-adapter", "verification", "spec-req"]
aliases: ["C-TRACEABILITY"]
---

# Traceability

Traceability is the groundwork mechanism that makes every "it's done" claim auditable — from a user-visible spec requirement, through the ledger slice that addressed it, to the test that verified it, to the gate verdict that approved it.

## What this concept covers

- The **traceability chain**: objective → spec-req → slice → self-test → live-verify → gate
- The **SpineAdapter interface** (D-7): a read-only data abstraction that isolates the traceability assembler from the backing store (native ledger/journal vs. any future replacement)
- **Link classification**: proven, unproven, stale, missing — visibly rendered for every edge
- **Build-hash staleness detection** (D-4): evidence nodes carry the hash they were captured against; the assembler detects drift
- **Deterministic assembly** (D-3): the graph assembler is a pure function of its inputs

## Key decisions

| Decision | Statement |
|---|---|
| D-3 | Mechanical links are computed deterministically from the spine; semantic classification is sourced from recorded gate verdicts |
| D-4 | Artifact-evidence references carry a build/data hash for staleness detection |
| D-7 | A read-only spine-adapter interface isolates the store from all consumers |
| D-8 | GATE and VERIFICATION events carry an optional per-link scope field |
| D-9 | Visualization follows wave-band topology with semantic edge styling |

## Requirements

| ID | Title | Criticality | Verification |
|---|---|---|---|
| [[requirements/traceability-r-001\|TRACEABILITY-R-001]] | Traceability chain renders on real motive data | must | manual |
| [[requirements/traceability-r-002\|TRACEABILITY-R-002]] | Full chain is rendered end-to-end | must | automated |
| [[requirements/traceability-r-003\|TRACEABILITY-R-003]] | Link classification is visibly rendered | must | manual |
| [[requirements/traceability-r-004\|TRACEABILITY-R-004]] | Mechanical links are deterministic | must | automated |
| [[requirements/traceability-r-005\|TRACEABILITY-R-005]] | Semantic classification is sourced from recorded verdicts | must | automated |
| [[requirements/traceability-r-006\|TRACEABILITY-R-006]] | Stale evidence is detected via build hash | must | automated |

## Design

- [[design/_MOC|Design map of content]]
- [[design/concepts/traceability-chain|Traceability chain concept]]
- [[design/flows/verification-flow|Verification flow]]
- [[design/components/spine-adapter|SpineAdapter component]]
- [[design/recipes/link-slice-to-requirement|Recipe: link a slice to a requirement]]
- [[design/reference/requirement-fields|Requirement fields reference]]

## Glossary

[[glossary]]
