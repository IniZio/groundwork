---
id: "C-VERIFICATION"
type: "moc"
title: "Verification"
summary: "Non-trivial tasks require advisor validation — confirming real-world completeness — before the session ends."
parent: C-GROUNDWORK
status: "draft"
---

# Verification

> This index covers the verification concept in groundwork. Start at [[design/_MOC]] for the design reading path and curated links.

Non-trivial tasks require advisor validation — confirming real-world completeness — before the session ends. Two mechanisms enforce this: a Stop hook that blocks session end while slices remain incomplete, and an advisor gate that must return `APPROVE` before the session is permitted to close.

## Quick links

| | |
|---|---|
| Design (folder) | [[design/_MOC]] |
| Stop-gate concept | [[design/concepts/stop-gate]] |
| Advisor gate concept | [[design/concepts/advisor-gate]] |
| Completion concept | [[design/concepts/completion]] |
| Stop-gate flow | [[design/flows/stop-gate-decision-path]] |
| Stop-gate component | [[design/components/stop-gate]] |
| Recipe: release stop-gate | [[design/recipes/release-stop-gate]] |
| Verification methods reference | [[design/reference/verification-methods]] |

## Requirements

| Id | Title | Criticality |
|----|-------|-------------|
| [[requirements/verification-r-001-stop-hook-blocks-session-end-while-slices-incomplete\|R-001]] | Stop hook blocks session end while slices are incomplete | must |
| [[requirements/verification-r-002-orchestrator-invokes-advisor-to-validate-completion\|R-002]] | Orchestrator invokes advisor to validate completion | must |
| [[requirements/verification-r-003-stop-hook-emits-advisory-for-decision-events-lacking-research\|R-003]] | Stop hook emits non-blocking advisory for DECISION events lacking research | should |
| [[requirements/verification-r-004-stop-hook-emits-advisory-for-decision-events-empty-alternatives\|R-004]] | Stop hook emits non-blocking advisory for DECISION events with empty alternatives or unmarked id collisions | should |

## Decisions

| Id | Decision |
|----|----------|
| [[decisions/stop-gate-mechanism]] | Why block on the Stop hook rather than other enforcement points |
