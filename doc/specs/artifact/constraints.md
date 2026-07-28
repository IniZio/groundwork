---
type: constraints
id: C-ARTIFACT
---

# Artifact Model — Normative Constraints

These invariants are derived from the requirements in `requirements.md` and represent the testable behavioral contracts of the artifact model.

## Ledger slice completion tracking (ARTIFACT-R-001)

- When a slice is marked complete via `ledger complete <id>`, the system SHALL persist the slice `id`, an ISO-8601 `completed_at` timestamp, and the `session_id` of the completing session to `.groundwork/runs/<session_id>.json`.
- The `session_id` stored on the slice SHALL match the session that issued the `ledger complete` command, ensuring completions from concurrent sessions cannot satisfy a different session's gate.
- A slice entry without a `session_id` SHALL be treated as invalid and SHALL NOT contribute to gate satisfaction.

## RFC reference field (ARTIFACT-R-002)

- When `ledger init` is invoked with `--rfc <dir>`, the ledger SHALL record `rfc_ref` equal to the given directory path.
- When `ledger init` is invoked without `--rfc`, the resulting ledger SHALL contain no `rfc_ref` field.
- A missing `rfc_ref` SHALL NOT block spec writes or session close; the field is informational metadata only.
- The `spec-guard` hook and the Stop hook SHALL treat `rfc_ref` as advisory and SHALL NOT gate any action on its presence or absence.

## Stop hook incomplete-slice guard (ARTIFACT-R-003)

- If the Stop hook fires and the active run ledger contains any slice with status `"pending"` or `"in_progress"`, the Stop hook SHALL block session end and SHALL emit a message citing the id of each incomplete slice.
- The incomplete-slice guard is independent of the advisor gate guard; both conditions SHALL be satisfied before the Stop hook permits session end.
- After `ledger complete <id>` resolves the last incomplete slice, a subsequent Stop hook invocation SHALL not block on that slice.
