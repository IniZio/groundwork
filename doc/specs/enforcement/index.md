---
id: C-ENFORCEMENT
type: moc
title: Enforcement Hooks
summary: "Enforcement hooks mechanically bind CLAUDE.md prose rules as PreToolUse gates, blocking orchestrators and subagents from violating delegation constraints."
status: draft
depends_on: []
date_updated: "2026-08-29"
parent: C-GROUNDWORK
origin_decision_ref: plugin-cleanup#D-5
tags: [index, enforcement]
aliases: [enforcement]
---

# Enforcement Hooks

> Design notes live in [[design/_MOC]]. Start there for the reading path and curated links.

Enforcement hooks translate prose rules from CLAUDE.md into mechanically binding constraints. They are registered in `.claude/settings.json` under `hooks` and execute on the Claude Code event bus without requiring model cooperation.

---

## Quick links

| | |
|---|---|
| Design (folder) | [[design/_MOC]] |
| Hook architecture | [[design/concepts/hook-architecture]] |
| Stop-gate flow | [[design/flows/stop-gate-decision-path]] |
| Orchestrator impl-guard (component) | [[design/components/orchestrator-impl-guard]] |
| Recipe: authorize autopilot | [[design/recipes/authorize-autopilot-grant]] |
| Hooks reference table | [[design/reference/enforcement-hooks-reference]] |
| Glossary | [[glossary]] |

---

## Requirements

| Id | Title | Status |
|----|-------|--------|
| [[requirements/enforcement-r-001-impl-guard-blocks-orchestrator-direct-edits\|ENFORCEMENT-R-001]] | Impl-guard blocks orchestrator direct edits outside permitted paths | implemented |
| [[requirements/pacing-r-001-wave-default-pace-policy\|PACING-R-001]] | Wave-default pace policy initialised at ledger init | implemented |
| [[requirements/pacing-r-002-start-time-hard-block-with-exact-reason-messaging\|PACING-R-002]] | Start-time hard block with exact-reason messaging | implemented |
| [[requirements/pacing-r-003-ledger-complete-never-blocked-by-pacing\|PACING-R-003]] | `ledger complete` is never blocked by pacing | implemented |
| [[requirements/pacing-r-004-autopilot-grant-token-gated-recorded-run-scoped\|PACING-R-004]] | Autopilot grant is token-gated, recorded in the ledger, and run-scoped | implemented |
| [[requirements/pacing-r-005-pacing-exhaustion-stop-gate-release-directive-handoff\|PACING-R-005]] | Pacing exhaustion is a sanctioned stop-gate release with directive handoff | implemented |
| [[requirements/pacing-r-006-autopilot-grant-requires-nonempty-reason\|PACING-R-006]] | Autopilot grant requires non-empty reason; HITL routing | implemented |
| [[requirements/pacing-r-007-milestone-policy-gates-on-human-verified-shippable\|PACING-R-007]] | Milestone policy gates on human-verified shippable deliverables | open |
| [[requirements/pacing-r-008-milestone-signoff-requires-write-token-authority\|PACING-R-008]] | Milestone sign-off requires write_token authority | open |
| [[requirements/pacing-r-009-milestone-artifacts-hook-validatable-staleness\|PACING-R-009]] | Milestone artifacts are hook-validatable; staleness from build-hash | open |
| [[requirements/pacing-r-010-milestone-signoff-composes-with-awaiting-human\|PACING-R-010]] | Milestone sign-off composes with awaiting_human | open |
| [[requirements/pacing-r-011-evidence-artifacts-under-groundwork-never-committed\|PACING-R-011]] | Evidence artifacts under `.groundwork/` are never committed | implemented |
| [[requirements/seal-r-001-accepted-residual-ace-same-os-user\|SEAL-R-001]] | Accepted residual: ACE as same OS user can forge a valid seal | implemented |

---

## Decisions

| Id | Title |
|----|-------|
| [[decisions/adr-001-enforcement-hooks-mechanically-bind-prose-rules\|ADR-001]] | Enforcement hooks mechanically bind prose rules |
