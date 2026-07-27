---
id: ARTIFACT-R-rfr1
type: requirement
concept: C-ARTIFACT
summary: "When a run ledger is initialized with --rfc, the rfc_ref field is set to the RFC directory path."
ears: "When a run ledger is initialized with --rfc <dir>, the system SHALL set rfc_ref in the ledger to the RFC directory path so that enforcement hooks can verify spec writes are authorized."
pattern: event
verify: "Initialize a run ledger with --rfc <dir> and confirm that the resulting ledger JSON contains an rfc_ref field equal to the RFC directory path."
verification: automated
criticality: must
origin_rfc: R-20260726-K4M2QX
status: active
---

The `rfc_ref` field links an executing run ledger to the RFC that authorized it, enabling `spec-guard` and other enforcement hooks to confirm that spec writes are covered by a valid `spec_delta` entry in the referenced RFC.
