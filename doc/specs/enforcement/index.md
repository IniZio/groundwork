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
| [[requirements/enforcement-r-002-nesting-guard-spawn-topology\|ENFORCEMENT-R-002]] | Nesting-guard enforces agent spawn topology via type allowlist | implemented |
| [[requirements/enforcement-r-003-agent-model-guard-model-injection\|ENFORCEMENT-R-003]] | Agent-model-guard injects registry-mapped model tier when model is absent | implemented |
| [[requirements/enforcement-r-004-ledger-guard-direct-file-access\|ENFORCEMENT-R-004]] | Ledger-guard blocks direct tool access to run-ledger and seal-key files | implemented |
| [[requirements/enforcement-r-005-ledger-bash-guard-bash-manipulation\|ENFORCEMENT-R-005]] | Ledger-bash-guard blocks subagent bash manipulation of ledger and seal key | implemented |
| [[requirements/enforcement-r-006-piped-exit-code-guard-pipe-status\|ENFORCEMENT-R-006]] | Piped-exit-code-guard blocks reading $? after piping through a filter | implemented |
| [[requirements/enforcement-r-007-stop-gate-session-end-enforcement\|ENFORCEMENT-R-007]] | Stop-gate blocks session end when run is incomplete or gate is unsealed | implemented |
| [[requirements/enforcement-r-008-struggle-detector-failure-signal\|ENFORCEMENT-R-008]] | Struggle-detector emits FAILURE journal event on consecutive tool failures | implemented |
| [[requirements/enforcement-r-009-deslop-guard-advisory\|ENFORCEMENT-R-009]] | Deslop-guard emits advisory on AI-fingerprint comment patterns | implemented |
| [[requirements/enforcement-r-010-prose-negation-guard-advisory\|ENFORCEMENT-R-010]] | Prose-negation-guard warns when negation words are removed from surviving sentences | implemented |
| [[requirements/enforcement-r-011-prose-modality-guard-advisory\|ENFORCEMENT-R-011]] | Prose-modality-guard warns when modal hedges are upgraded to strong assertions | implemented |
| [[requirements/enforcement-r-012-doc-read-guard-progressive-disclosure\|ENFORCEMENT-R-012]] | Doc-read-guard enforces toc-first access for over-budget doc-class files | implemented |
| [[requirements/enforcement-r-013-doc-size-guard-over-budget-advisory\|ENFORCEMENT-R-013]] | Doc-size-guard emits advisory when doc-class file exceeds budget without structure | implemented |
| [[requirements/enforcement-r-014-spec-guard-warn-on-no-ledger\|ENFORCEMENT-R-014]] | Spec-guard warns and permits spec writes when no active ledger exists | implemented |
| [[requirements/enforcement-r-015-keyword-router-hint-injection\|ENFORCEMENT-R-015]] | Keyword-router injects deterministic routing hints for user prompts | implemented |
| [[requirements/enforcement-r-016-session-reminder-context-injection\|ENFORCEMENT-R-016]] | Session-reminder injects ledger state and orchestrator rules at session start | implemented |
| [[requirements/enforcement-r-017-gw-hook-shim-requires-bun\|ENFORCEMENT-R-017]] | gw-hook shim selects bun as primary runtime; node fallback fails for gw source | implemented |
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
