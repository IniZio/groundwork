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

See also: [ARTIFACT-R-003](#artifact-r-003)

## ARTIFACT-R-003 — Stop hook incomplete-slice guard {#artifact-r-003}

If the Stop hook fires and the active run ledger contains any slice not marked complete, then the Stop hook **shall** block session end and emit a message citing the id of each incomplete slice.

- **Why** — the Stop hook is the final check preventing incomplete work from being left behind; if a slice is in `"pending"` or `"in_progress"` state, the session must not terminate, because the run ledger is the orchestrator's ground truth for what work remains. This guard is independent of and in addition to the advisor gate guard; both must be satisfied.
- **Fit criterion** — run the Stop hook against a run ledger with one incomplete slice and confirm it emits a block citing the incomplete slice id. Complete the slice via `ledger complete <id>` and re-run the Stop hook; confirm it no longer blocks.
- **Verification**: automated — the Stop hook enforces this mechanically on every session-end attempt.
- **Criticality**: must

See also: [VERIFICATION-R-001](../verification/constraints.md#verification-r-001)

## ARTIFACT-R-004 — Journal DECISION events require structured data fields {#artifact-r-004}

When `journal append --type DECISION` is invoked, `hooks/journal.mjs` **shall** require `data.id`, `data.decision`, and `data.rationale` to be present in the `--data` JSON payload, default `data.alternatives` to `[]` when absent, and exit with code 2 naming the missing key when any required field is absent.

- **Why** — unstructured DECISION events cannot be traced from MAP.md back to a specific decision id; a missing `id` makes the decision unaddressable in cross-references, a missing `decision` leaves the outcome undocumented, and a missing `rationale` prevents future reviewers from following the reasoning chain.
- **Fit criterion** — `journal append --type DECISION --motive x --msg m --data '{"id":"D-1","decision":"d","rationale":"r"}'` exits 0; omitting `id`, `decision`, or `rationale` individually exits 2 and names the missing key in the error message; a payload without `alternatives` is accepted and `alternatives` is defaulted to `[]` in the persisted event.
- **Verification** manual · **Criticality** must · **Source** groundwork-development#D-26

## ARTIFACT-R-005 — Motive archive moves directory and refuses open items without --force {#artifact-r-005}

When `journal motive archive <slug>` is invoked, `hooks/journal.mjs` **shall** move `.groundwork/motives/<slug>/` to `.groundwork/archive/motives/<slug>/`, append a `MILESTONE` event recording the archive destination path, and exit non-zero without moving the directory if the charter contains open TBD or TBR items unless `--force` is supplied.

- **Why** — archiving a motive with unresolved open items silently buries declared-incomplete work; the guard surfaces the oversight at archive time, and `--force` provides an explicit escape hatch for intentionally deferred items, preventing accidental loss of the open-items signal.
- **Fit criterion** — `journal motive archive slug` with open TBD items in the charter exits non-zero and leaves `.groundwork/motives/slug/` in place; `journal motive archive slug --force` moves the directory to `.groundwork/archive/motives/slug/` and a MILESTONE event appears in the journal with `data.archived_to` naming the relative archive path.
- **Verification** manual · **Criticality** must · **Source** groundwork-development#D-23

## ARTIFACT-R-006 — MAP.md out-of-scope section merges three sources with identity-based dedup {#artifact-r-006}

When MAP.md is regenerated, `hooks/lib/motive-map.mjs` **shall** merge the charter `out_of_scope` prose, filenames from `.groundwork/out-of-scope/*.md` (dashes converted to spaces), and rejection DECISION events into the Out of scope section; deduplicate rejection events by strict first-sentence prefix (keeping the longer prose form and appending absorbed decision ids in parentheses); and render the empty-state line `_Nothing explicitly ruled out yet._` only when all three sources contribute no entries.

- **Why** — a single consolidated view of out-of-scope decisions prevents the orchestrator from re-planning rejected features; strict first-sentence dedup (not session-based) collapses summary and full-prose forms of the same rejection to the richer entry without losing the absorbed decision id; the empty-state line must be suppressed whenever any source has content, because mixing content with the placeholder produces a misleading section.
- **Fit criterion** — with two rejection DECISION events where the earlier event's first sentence is a strict prefix of the later event's, only the later (longer) entry appears, with the earlier event's `data.id` appended as `(D-X)`; an `.groundwork/out-of-scope/dark-mode.md` file renders as `- dark mode`; the `_Nothing explicitly ruled out yet._` line is absent when any source contributes at least one entry.
- **Verification** manual · **Criticality** must · **Source** groundwork-development#D-21
