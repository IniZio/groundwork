---
id: ORCHESTRATION-R-ve7w
type: requirement
concept: C-ORCHESTRATION
summary: "When the orchestrator classifies a task as non-trivial, it shall delegate implementation to a groundwork:general-purpose subagent."
ears: "When the orchestrator classifies a task as non-trivial, the orchestrator shall delegate implementation to a groundwork:general-purpose subagent."
pattern: event
verify: "Review session transcripts for non-trivial tasks and confirm that the orchestrator issued a Task call to a groundwork:general-purpose subagent rather than invoking Edit or Write itself. The impl-guard hook (ENFORCEMENT-R-wfdw) provides the mechanical backstop for the inverse case."
verification: manual
criticality: must
origin_rfc: R-20260726-K4M2QX
status: active
---

The positive delegation mandate (classify → delegate) is an LLM-level behaviour and cannot be enforced mechanically. The inverse (orchestrator must not call Edit/Write on production code) is enforced by the impl-guard hook (ENFORCEMENT-R-wfdw).

## Manual procedure

After a non-trivial feature wave completes, inspect the orchestrator's session transcript. Verify that every implementation step was performed via a `Task(subagent_type="groundwork:general-purpose", …)` call, and that no Edit, Write, or MultiEdit calls appear against production code paths.
