---
id: VERIFICATION-R-oxuu
type: requirement
concept: C-VERIFICATION
summary: "The Stop hook shall block session end when the active run ledger does not carry an advisor APPROVE verdict."
ears: "If the Stop hook fires and the active run ledger does not carry an advisor APPROVE verdict, then the Stop hook shall block session end."
pattern: unwanted
verify: "Run the Stop hook against a ledger with no gate entry and confirm it emits a block. Run it again after recording an advisor APPROVE via the ledger gate command and confirm the session is permitted to end."
verification: automated
criticality: must
origin_rfc: R-20260726-K4M2QX
status: active
---

The Stop hook is the mechanical backstop. The orchestrator's duty to actually obtain the APPROVE verdict from the advisor before recording it is a separate, LLM-level requirement covered by VERIFICATION-R-m5kn.
