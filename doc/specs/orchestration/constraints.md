---
type: constraints
id: C-ORCHESTRATION
---

# Orchestration Model — Normative Constraints

## ORCHESTRATION-R-001 — Orchestrator delegates non-trivial implementation {#orchestration-r-001}

When the orchestrator classifies a task as non-trivial, the orchestrator **shall** delegate implementation to a `groundwork:general-purpose` subagent.

- **Why** — the orchestrator's context window is a finite shared resource; raw tool output (from Edit, Write, Bash, Read) consumed by the orchestrator directly bloats that window and reduces its capacity to synthesize results, coordinate parallel work, and make strategic decisions across the session. Delegating to specialist subagents decouples execution from oversight, allowing the orchestrator to receive only polished summaries and maintain focus on classification, quality gating, and orchestration.
- **Fit criterion** — after a non-trivial feature is implemented, session transcripts show Task calls to `groundwork:general-purpose` subagents for all implementation steps, and no Edit, Write, or MultiEdit calls appear in the orchestrator's direct tool calls against production code paths. The impl-guard hook (ENFORCEMENT-R-001) provides the mechanical backstop for verification.
- **Verification**: manual — confirmed by reviewing session transcripts for Task delegation calls and absence of direct Edit/Write calls from the orchestrator on production code paths.
- **Criticality**: must

See also: ENFORCEMENT-R-001
