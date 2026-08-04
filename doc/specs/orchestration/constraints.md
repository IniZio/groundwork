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

### Manual procedure

1. At the end of a session where a non-trivial task was completed, open the session transcript.
2. Search for direct Edit, Write, or MultiEdit calls. Confirm none appear against production code paths under the orchestrator identity (calls from delegated subagents are allowed).
3. Search for Task or Agent calls. Confirm that implementation steps were delegated via `Task(subagent_type="groundwork:general-purpose", …)` or equivalent.
4. If both conditions hold, the requirement is satisfied for that session.

See also: [ENFORCEMENT-R-001](../enforcement/constraints.md#enforcement-r-001)

## ORCHESTRATION-R-002 — Ledger fog slice tracks open questions without blocking frontier {#orchestration-r-002}

When the orchestrator runs `ledger fog <id> --desc "…" --question "…"`, `hooks/ledger.mjs` **shall** create a slice with `kind: "fog"` and no acceptance criteria, and the `ledger frontier` command **shall** exclude all slices with `kind: "fog"` from its output.

- **Why** — fog slices represent open questions (unknown unknowns) that are not actionable work items; including them in the frontier would mislead the orchestrator into treating unresolved questions as scheduled deliverables, distorting wave planning and completion accounting.
- **Fit criterion** — after `ledger fog q1 --desc "open question" --question "…"`, `ledger view` shows `q1` with `kind: fog` and no acceptance field; `ledger frontier` output does not list `q1`.
- **Verification** manual · **Criticality** must · **Source** groundwork-development#D-21

## ORCHESTRATION-R-003 — Authorship duties for ticket sections {#orchestration-r-003}

When a ticket is created for a slice, the **planner** agent **shall** fill the Question and Context sections before handing off to implementation. When the implementing agent marks the slice complete, it **shall** append its findings to the Evidence section and record the outcome in the Decision and Ruled out sections. Neither agent is required to fill Revisions or Links; those sections remain available for subsequent sessions. An agent **shall** not leave Question or Context empty on a ticket it opens; a parser **should** warn (not block) when a completed slice's ticket has an empty Decision section.

- **Why** — a ticket whose Question is never written is not a ticket — it is a placeholder. The authorship split (D-34) ensures that every ticket captures both the framing of the problem (planner's responsibility) and the outcome of the work (implementer's responsibility). Without this norm, tickets accumulate as empty shells that survive the no-delete invariant but carry no knowledge value. Warnings on empty Decision sections surface incomplete handoffs without blocking session end, keeping the gate non-disruptive.
- **Fit criterion** — review session transcripts for ticket-linked slices: the planner's tool calls write Question and Context before delegating; the implementer's completion step appends to Evidence, Decision, and Ruled out. A parser called on a ticket with an empty Decision section emits a warning line naming the ticket id but exits 0.
- **Verification**: manual — agent behaviour cannot be mechanically enforced at the hook layer; the parser warning is automated.
- **Criticality**: should · **Source** groundwork-development#D-34

## ORCHESTRATION-R-004 — Every DECISION event carries a structured data.id {#orchestration-r-004}

When any orchestrator or subagent appends a journal event of type `DECISION`, the `--data` JSON payload **shall** include a non-empty `data.id` field (e.g. `"D-37"`). `hooks/journal.mjs` **shall** emit a warning when a DECISION event arrives without `data.id` and **shall** still persist the event (non-blocking). No other journal operation requires `data.id`.

- **Why** — a DECISION event without a stable id cannot be referenced from MAP.md, from ticket cross-links, or from future supersession events (which record `data.retires: ["D-X"]`). An unaddressable decision is effectively invisible to tooling that traces the rationale chain. Persisting the event despite the warning avoids breaking in-flight sessions while surfacing the omission for later repair (D-36).
- **Fit criterion** — `journal append --type DECISION --motive x --msg m --data '{"id":"D-42","decision":"d","rationale":"r"}'` exits 0 with no warning; omitting `data.id` from an otherwise valid DECISION payload causes the CLI to print a warning line containing the text `DECISION event has no data.id` and still exits 0 with the event persisted.
- **Verification**: automated — `hooks/journal.mjs` enforces the warning on every DECISION append; T6-AC1 in `test/hooks/t6-decision-discipline.test.ts` covers exit 0, event persistence, and stderr warning for the missing-data.id path.
- **Criticality**: must · **Source** groundwork-development#D-36
