---
id: "orchestration-r-001"
type: requirement
concept: C-ORCHESTRATION
title: "Orchestrator delegates non-trivial implementation"
criticality: must
verification: manual
status: open
design: "[[design#Delegation hierarchy]]"
---

## ORCHESTRATION-R-001 — Orchestrator delegates non-trivial implementation {#orchestration-r-001}

When the orchestrator classifies a task as non-trivial, the orchestrator **shall** delegate implementation to a `groundwork:junior-orchestrator` subagent, or to a `groundwork:general-purpose` subagent when the slice satisfies all four leaf-carve-out conditions: single domain with no sub-domains; ≤2 files; no internal sequencing; small verification surface.

- **Why** — The orchestrator's context window is a finite shared resource; raw tool output (from Edit, Write, Bash, Read) consumed by the orchestrator directly bloats that window and reduces its capacity to synthesize results, coordinate parallel work, and make strategic decisions across the session. Delegating to specialist subagents decouples execution from oversight, allowing the orchestrator to receive only polished summaries and maintain focus on classification, quality gating, and orchestration.
- **Fit criterion** — After a non-trivial feature is implemented, session transcripts show Task calls to `groundwork:junior-orchestrator` or `groundwork:general-purpose` subagents for all implementation steps; slices not meeting all four leaf-carve-out conditions are dispatched to `groundwork:junior-orchestrator`; and no Edit, Write, or MultiEdit calls appear in the orchestrator's direct tool calls against production code paths. The impl-guard hook (ENFORCEMENT-R-001) provides the mechanical backstop for verification.
- **Verification**: manual — 
  1. At the end of a session where a non-trivial task was completed, open the session transcript.
  2. Search for direct Edit, Write, or MultiEdit calls. Confirm none appear against production code paths under the orchestrator identity (calls from delegated subagents are allowed).
  3. Search for Task or Agent calls. Confirm that implementation steps were delegated via `Task(subagent_type="groundwork:junior-orchestrator", …)` or `Task(subagent_type="groundwork:general-purpose", …)` (the latter only for slices satisfying all four leaf-carve-out conditions).
  4. If both conditions hold, the requirement is satisfied for that session.

  See also: ENFORCEMENT-R-001
- **Criticality**: must
