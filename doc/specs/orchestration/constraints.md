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
