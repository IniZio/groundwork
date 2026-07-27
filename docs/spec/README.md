---
id: C-GROUNDWORK
type: concept
title: Groundwork
summary: "Groundwork classifies tasks, delegates to specialist subagents, and reviews outcomes without the orchestrator writing code itself."
parent: null
origin_rfc: R-20260726-K4M2QX
---

# Groundwork

Groundwork is an orchestrator-mode AI coding framework that classifies, delegates, and reviews coding tasks through specialist subagents.

## Goals

- Enable structured, plan-driven feature development with parallel agent execution
- Provide durable multi-session feature state through ledgers, plans, and specs
- Maintain audit trails via journals, ADRs, and retrospectives
- Expose a testable spec system that captures requirements in EARS notation

## Scope

This spec is partial. It covers four load-bearing behavioral areas established in RFC-0001: artifact records (C-ARTIFACT), enforcement hooks (C-ENFORCEMENT), the orchestration model (C-ORCHESTRATION), and the verification gate (C-VERIFICATION). It does not yet specify the four CLIs (`spec`, `ledger`, `rfc`, `journal`), the hooks beyond `orchestrator-impl-guard`, `nesting-guard`, `stop-gate`, `deslop-guard`, and `agent-model-guard`, the twenty-plus skills, or the session-start injection pipeline. Coverage grows by RFC: each accepted RFC nominates the concept nodes and requirement files it introduces.
