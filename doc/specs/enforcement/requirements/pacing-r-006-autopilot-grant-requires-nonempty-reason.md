---
id: pacing-r-006
type: requirement
concept: C-ENFORCEMENT
title: Autopilot grant requires non-empty reason; block message routes authorization through the operator; stop-gate surfaces active grants
status: implemented
verification: unverified
criticality: must
design: "[[design/recipes/authorize-autopilot-grant]]"
---

## PACING-R-006 — Autopilot grant requires non-empty reason; block message routes authorization through the operator; stop-gate surfaces active grants {#pacing-r-006}

Three HITL (human-in-the-loop) requirements for the pacing escape hatch:

**(a) Non-empty reason required.** When `ledger autopilot` is invoked without `--reason` or with a blank/whitespace-only value, the ledger CLI **shall** exit 1 and print a usage message explaining that `--reason` is required with a non-empty operator-supplied rationale.

**(b) Block message routes authorization through the operator.** The claim-block remedy for Option A **shall** instruct the agent to ask the operator for authorization (e.g. "ask the operator to authorize `ledger autopilot --range N --reason "…"` — do not self-grant") rather than directing the agent to run the command itself. Option B (handoff) is unchanged.

**(c) Stop-gate surfaces active grants.** When the Stop hook allows a session to end and the active ledger contains `pacing.grant`, the Stop hook **shall** emit a human-readable summary line in its output stating the grant's range, reason, and granted_by session — so a grant is never silent at session end. This is non-blocking; it does not prevent the session from ending.

- **Why** — Without (a), an agent can self-grant by omitting a reason, defeating the audit trail. Without (b), the block message itself advertises the self-grant path as the primary remedy ("Option A"), making agent bypass the path of least resistance. Without (c), an operator reviewing session output has no visibility into an autopilot grant that silently extended the session budget. Together, these three changes make the escape hatch operator-mediated rather than agent-self-serve, satisfying the HITL design intent of D-28.
- **Fit criterion** — (a) `ledger autopilot --range 2 --token <t>` (no `--reason`) exits 1 with a message containing "reason"; `ledger autopilot --range 2 --token <t> --reason "  "` (whitespace-only) also exits 1. (b) `ledger claim` on an exhausted budget prints a block message whose Option A contains "ask the operator" and does not contain "run `ledger autopilot`" as a direct instruction. (c) When a Stop hook fires on a ledger with `pacing.grant = {range:2, reason:"test", granted_by:"sess-x"}`, the hook output contains a summary line mentioning "+2 unit", "test", and "sess-x".
- **Verification**: unverified — covered by tests in `test/hooks/ledger-pacing.test.ts` (cases a and b) and `test/hooks/stop-gate-pacing.test.ts` (case c).
- **Criticality**: must
