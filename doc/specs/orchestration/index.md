---
id: "C-ORCHESTRATION"
type: moc
title: "Orchestration Model"
summary: "The orchestrator classifies and delegates all implementation to specialist subagents and never writes code or edits files itself."
status: active
depends_on: []
date_updated: "2026-08-29"
parent: "C-GROUNDWORK"
origin_decision_ref: "plugin-cleanup#D-5"
tags: [index, orchestration]
aliases: []
---

# Orchestration Model

> This index has been updated for round-4. The design is now a folder of atomic notes. Start at [[design/_MOC]] for the reading path and curated links.

---

## Quick links

| | |
|---|---|
| Design (folder) | [[design/_MOC]] |
| Delegation hierarchy | [[design/concepts/delegation-hierarchy]] |
| Stop-gate concept | [[design/concepts/stop-gate]] |
| Vertical slice | [[design/concepts/vertical-slice]] |
| Stop-gate flow | [[design/flows/stop-gate-decision-path]] |
| Slice lifecycle | [[design/flows/slice-lifecycle]] |
| Run-ledger slice (component) | [[design/components/run-ledger-slice]] |
| Gate note (component) | [[design/components/gate-note]] |
| Recipe: add a slice | [[design/recipes/add-slice-with-acceptance-criteria]] |
| Recipe: release stop-gate | [[design/recipes/release-stop-gate-after-advisor-approve]] |
| CLI reference | [[design/reference/ledger-cli-reference]] |

---

## Requirements

| Id | Title |
|----|-------|
| [[requirements/orchestration-r-001-orchestrator-delegates-non-trivial-implementation\|R-001]] | Orchestrator delegates non-trivial implementation |
| [[requirements/orchestration-r-002-ledger-fog-slice-tracks-open-questions-without-blocking-frontier\|R-002]] | Fog slice tracks open questions without blocking frontier |
| [[requirements/orchestration-r-003-authorship-duties-for-ticket-sections\|R-003]] | Authorship duties for ticket sections |
| [[requirements/orchestration-r-004-every-decision-event-carries-a-structured-data-id\|R-004]] | Every DECISION event carries a structured data.id |
