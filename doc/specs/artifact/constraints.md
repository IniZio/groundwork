---
type: constraints
id: C-ARTIFACT
---

# Artifact Model — Normative Constraints

## ARTIFACT-R-001 — Ledger records slice completion {#artifact-r-001}

When a vertical slice is marked complete via the ledger CLI, `hooks/ledger.mjs` **shall** persist the slice id, completion timestamp, and session id to `.groundwork/runs/<session_id>.json`.

- **Why** — the Stop hook reads the ledger to gate session end; an entry without a session id cannot be attributed to the run that produced it, so a concurrent session's completions would incorrectly satisfy this session's gate, allowing premature termination.
- **Fit criterion** — after `ledger complete s3`, the `s3` entry carries non-null `id`, ISO-8601 `completed_at`, and `session_id` matching the completing session.
- **Verification**: automated — `hooks/ledger.mjs` persists these fields on every `complete` command; the Stop hook reads them to validate gate satisfaction.
- **Criticality**: must

See also: ARTIFACT-R-003

## ARTIFACT-R-002 — RFC reference field in ledger {#artifact-r-002}

Where `--rfc <dir>` is passed at ledger init, the ledger **shall** record `rfc_ref` as an optional advisory field containing the RFC directory path.

- **Why** — traceability tooling and audit trails benefit from knowing which RFC motivated a session's work; `rfc_ref` provides that link without gating spec writes or session close. Its absence is not an error: `spec-guard` and the Stop hook treat it as informational metadata only.
- **Fit criterion** — initialize a run ledger with `--rfc <dir>` and confirm `rfc_ref` equals the given path; also confirm that a ledger initialized without `--rfc` contains no `rfc_ref` field, that spec writes succeed in both cases, and that session close is not blocked by a missing `rfc_ref`.
- **Verification**: automated — the ledger CLI and Stop hook are tested against both the `--rfc` and no-`--rfc` initialization paths.
- **Criticality**: should

## ARTIFACT-R-003 — Stop hook incomplete-slice guard {#artifact-r-003}

If the Stop hook fires and the active run ledger contains any slice not marked complete, then the Stop hook **shall** block session end and emit a message citing the id of each incomplete slice.

- **Why** — the Stop hook is the final check preventing incomplete work from being left behind; if a slice is in `"pending"` or `"in_progress"` state, the session must not terminate, because the run ledger is the orchestrator's ground truth for what work remains. This guard is independent of and in addition to the advisor gate guard; both must be satisfied.
- **Fit criterion** — run the Stop hook against a run ledger with one incomplete slice and confirm it emits a block citing the incomplete slice id. Complete the slice via `ledger complete <id>` and re-run the Stop hook; confirm it no longer blocks.
- **Verification**: automated — the Stop hook enforces this mechanically on every session-end attempt.
- **Criticality**: must

See also: VERIFICATION-R-001
