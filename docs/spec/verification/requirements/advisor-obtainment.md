---
id: VERIFICATION-R-m5kn
type: requirement
concept: C-VERIFICATION
summary: "When a non-trivial task is complete, the orchestrator shall obtain an APPROVE verdict from the advisor agent."
ears: "When a non-trivial task is complete, the orchestrator shall obtain an APPROVE verdict from the advisor agent."
pattern: event
verify: "Review the orchestrator's session transcript after a completed non-trivial task and confirm a Task call to groundwork:advisor was made and that the advisor returned an APPROVE verdict before the ledger gate command was recorded."
verification: manual
criticality: must
origin_rfc: R-20260726-K4M2QX
status: active
---

The orchestrator is an LLM identity and its decision to invoke the advisor cannot be enforced mechanically at the point of decision. The Stop hook (VERIFICATION-R-oxuu) provides a mechanical backstop: if the APPROVE verdict was never recorded in the ledger, the session cannot end. This requirement captures the normative obligation that sits above the backstop.

## Manual procedure

After a non-trivial feature wave completes, inspect the orchestrator's session transcript. Verify that a `Task(subagent_type="groundwork:advisor", …)` call appears and that the advisor's response contains an APPROVE verdict. Verify that the orchestrator subsequently ran `ledger.mjs gate advisor APPROVE` to record the verdict.
