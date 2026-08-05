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

## ARTIFACT-R-007 — Ticket is the durable work object {#artifact-r-007}

A groundwork ticket **shall** be a markdown document with the following required top-level sections in this order: Question, Context, Evidence, Decision, Ruled out, Revisions, Links. Each section **shall** be rendered as an H2 heading with an empty body when the ticket is first created, leaving the body for the author to fill. The run-ledger `Slice` schema **shall** accept an optional `ticket` field (string) naming the ticket id that this slice delivers against.

- **Why** — slices are session-scoped scheduling projections that disappear when a run ledger is no longer active; a ticket is the cross-session artifact that carries the question, the evidence gathered, and the decision reached. Without a canonical document shape, tickets written by different authors or tools diverge structurally and cannot be machine-parsed for open-section reporting or MAP.md rendering. The mattpocock section set (D-32) provides a proven, human-readable shape for engineering decisions.
- **Fit criterion** — a freshly created ticket file contains exactly the seven H2 headings (Question, Context, Evidence, Decision, Ruled out, Revisions, Links) with empty bodies; `ledger add s1 --ticket tkt-1` records `ticket: "tkt-1"` on slice `s1`; `ledger view` displays the ticket id alongside the slice; a ledger with no `ticket` fields on any slice continues to function without error (back-compat).
- **Verification**: automated — the ticket template renderer enforces the section set; the ledger schema accepts but does not require the `ticket` field.
- **Criticality**: must · **Source** groundwork-development#D-32

## ARTIFACT-R-008 — No-delete invariant for markdown files {#artifact-r-008}

No groundwork code path **shall** remove a markdown file that it did not itself generate. A file is considered generated if and only if it was written by groundwork in the current process and carries the footer line `_Auto-generated — do not edit by hand._`. Any sweep, cleanup, or regeneration routine that iterates a directory of `.md` files **shall** skip files that lack this footer.

- **Why** — `hooks/lib/motive-tickets.mjs` (lines 134-139) previously enumerated `tickets/` and called `rmSync` on every `.md` whose stem was absent from the current session's generated set. A durable, hand-authored ticket placed in that directory would be silently destroyed on the next regeneration under a fresh session ledger (D-33). The invariant prevents this class of data loss across all present and future sweep routines.
- **Fit criterion** — place a hand-authored `tickets/my-ticket.md` (no auto-generated footer) alongside generated files in the same directory; trigger a MAP regeneration or ticket sweep; confirm `my-ticket.md` is still present and unmodified after the operation. A generated file carrying the footer may be deleted by the generating code path.
- **Verification**: automated — the sweep routine checks the footer before any `rmSync` call; a regression test asserts that a hand-authored file survives the sweep.
- **Criticality**: must · **Source** groundwork-development#D-33

## ARTIFACT-R-009 — Ticket location resolution {#artifact-r-009}

When resolving the directory in which to create or read ticket files for a motive, groundwork **shall** use the following resolution order: (1) if the motive charter contains a `tickets_dir` field, use that path; (2) otherwise default to `.groundwork/motives/<slug>/tickets/`. The resolved directory **shall** be created if absent. An empty or missing ticket corpus **shall** not cause any error in `ledger`, `journal`, or MAP.md regeneration.

- **Why** — the default path is gitignored, giving tickets no version-control history and no PR review surface (D-37). Projects that want version-controlled tickets can point `tickets_dir` at a committed directory (e.g. `doc/tickets/`). The fallback default keeps zero-config motives working without any charter change, while the override lets teams adopt a committed workflow incrementally.
- **Fit criterion** — a motive charter with `tickets_dir: doc/tickets` causes new tickets to be written under `doc/tickets/`; a charter without `tickets_dir` causes tickets to be written under `.groundwork/motives/<slug>/tickets/`; a motive with no ticket files at all completes `ledger add`, `ledger complete`, `journal append`, and MAP.md regeneration without error.
- **Verification**: automated — the location resolver is tested with both a charter-override case and a default-fallback case; back-compat is verified by the T8 end-to-end test.
- **Criticality**: must · **Source** groundwork-development#D-37

## ARTIFACT-R-010 — Slice decisions field links slices to journal decision events {#artifact-r-010}

A run-ledger `Slice` **may** carry a `decisions` field containing a single decision id (string) or an ordered list of decision ids (string[]). When the compile step produces a decision log, it **shall** enumerate every decision id cited by any slice and, for each id, list the ids of all slices that cite it.

- **Why** — the `decisions` field makes the provenance of a decision traceable in both directions: given a slice, you can find the decisions it produced; given a decision id, you can find the slices that originated or are governed by it. Without this linkage, decision events in the journal are disconnected from the unit of work that generated them, making retrospectives and coverage audits manual.
- **Fit criterion** — `ledger add s1 --decisions D-1` records `decisions: ["D-1"]` on slice `s1`; `ledger add s2 --decisions D-1,D-2` records `decisions: ["D-1","D-2"]` on slice `s2`; the compile step output for a run containing both slices lists `D-1 → [s1, s2]` and `D-2 → [s2]`; a ledger with no `decisions` fields on any slice continues to function without error (back-compat).
- **Verification**: automated — the ledger schema accepts but does not require the `decisions` field; the compile step is tested with single, multi-id, and absent `decisions` values.
- **Criticality**: may · **Source** groundwork-development#TBD-23

## ARTIFACT-R-011 — DECISION `revises` field merges same-id events; `unmarked_collision` flags unintended duplicates {#artifact-r-011}

When `journal compile` processes a motive's DECISION events, `hooks/lib/motive-compile.mjs` **shall** merge all events sharing the same `data.id` into a single compiled entry retaining the earliest `ts`; if at least one contributing event carries a `data.revises` field equal to the entry's own `data.id` the merged entry **shall not** receive `unmarked_collision`; if no contributing event carries `data.revises` equal to the entry's own `data.id` the merged entry **shall** carry `unmarked_collision: true`. A `data.revises` field naming the entry's own id on an individual DECISION event marks the author's intent that this append is an intentional same-id refinement and **shall** suppress the motive-scoped stderr collision warning emitted by `journal append`. A `data.supersedes` field is a distinct operation targeting a *different* `data.id`: both the superseding and the superseded entries **shall** appear as separate rows in the compiled output; the superseded entry's `status` **shall** be set to `'superseded'` and its `superseded_by` **shall** be set to the superseding id.

- **Why** — same-id events without `revises` are likely copy-paste errors or accidental id reuse; flagging them `unmarked_collision: true` lets downstream tools (e.g. the Stop hook advisory) surface the anomaly without silently discarding data. The `revises`/`supersedes` asymmetry is intentional: an author refining a decision in place uses `revises` (one compiled row, history collapses); an author replacing one decision with a new, differently-identified decision uses `supersedes` (two compiled rows, both visible). Collapsing these two operations would either lose the superseded entry or silently swallow edit collisions. A `revises` value that names a different id is not a valid refinement marker — the id-equality check ensures a misaddressed `revises` still triggers the collision flag.
- **Fit criterion** — given two DECISION events with `data.id: "D-1"`, one carrying `data.revises: "D-1"` (equal to its own id): `journal compile` produces a single compiled entry for `D-1` with no `unmarked_collision` field; given two DECISION events with `data.id: "D-1"`, one carrying `data.revises: "D-999"` (a different id): the compiled entry carries `unmarked_collision: true`; given two DECISION events with `data.id: "D-1"`, neither carrying `data.revises`: the compiled entry carries `unmarked_collision: true`; given a DECISION event with `data.id: "D-2"` and `data.supersedes: "D-1"`: both `D-1` and `D-2` appear in the compiled output and `D-1` has `status: "superseded"` and `superseded_by: "D-2"`.
- **Verification** manual · **Criticality** should · **Source** groundwork-development#D-60
