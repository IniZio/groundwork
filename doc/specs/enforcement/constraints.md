---
type: constraints
id: C-ENFORCEMENT
---

# Enforcement Constraints

## ENFORCEMENT-R-001 — Impl-guard blocks orchestrator direct edits outside permitted paths {#enforcement-r-001}

If an Edit or Write call is received from the orchestrator identity on a path that is not a permitted memory file or handoff document, then the enforcement hook **shall** return a deny block.

- **Why** — The orchestrator role is to classify, delegate, and review work — never to implement directly. Direct implementation by the orchestrator consumes the expensive session model (opus) for file edits that should be delegated to subagents (which run on sonnet per model-registry.json). Under real context pressure, this advisory is routinely dropped: observed groundwork sessions ran 200+ Edits + 37+ Writes on the orchestrator's model despite correct fan-out machinery being available, resulting in ~88% of output-token load landing on the expensive model. This hook enforces the division of labor mechanically. The two permitted paths (memory under `~/.claude/projects/<hash>/memory/` and handoffs at `.groundwork/handoffs/handoff-*.md`) are composition-in-context documents the orchestrator must write in a single turn; code and test and tooling changes belong to delegated subagents.
- **Fit criterion** — The enforcement hook test suite passes all deny cases: Edit and Write calls from the orchestrator on paths outside the two permitted shapes are blocked; calls from subagents are passed through; the two permit paths (memory files under the user home claude projects directory and handoff documents under the groundwork handoffs subdirectory) are allowed; and spoof paths resolving outside those shapes are blocked.
- **Verification**: automated — the hook is tested against all deny cases in the test suite.
- **Criticality**: must

## PACING-R-001 — Wave-default pace policy initialised at ledger init; absent pacing disables enforcement {#pacing-r-001}

When `ledger init` creates a new run and no `pacing` object is supplied, the ledger **shall** stamp `pacing` as `{policy:"wave", budget:1, exempt_kinds:["plan","diagnose","design","fog"]}`. When a run ledger carries no `pacing` field, the pacing module **shall** treat pacing as disabled and impose no start-time restrictions on any slice.

- **Why** — The default of one resolved wave per session enforces wayfinder-style one-checkpoint-per-session discipline while leaving intra-wave parallelism (unlimited subagent fan-out within the in-flight unit) untouched. Exempting `plan`, `diagnose`, `design`, and `fog` kind slices mirrors wayfinder exempting research tickets: these are orientation work, not delivery. The absent-means-disabled rule means every pre-existing ledger (without a `pacing` field) keeps working unchanged — no shim, no migration, full backward compatibility.
- **Fit criterion** — `ledger init` with no pacing arguments produces a ledger where `pacing.policy = "wave"`, `pacing.budget = 1`, and `pacing.exempt_kinds` equals `["plan","diagnose","design","fog"]`. A ledger file with no `pacing` field passes through `ledger claim` for any slice without a block or exit-code 1.
- **Verification**: automated — confirmed by inspecting the ledger produced by `ledger init` for the default `pacing` object, and by running `ledger claim` against a pacing-absent ledger and observing no block.
- **Criticality**: must
- **Source**: groundwork-development#D-28

## PACING-R-002 — Start-time hard block with exact-reason messaging {#pacing-r-002}

If `ledger claim` or `ledger set --status in_progress` is invoked for a slice that belongs to a new unit (a unit other than the lowest-numbered unit holding any non-exempt `in_progress` slice) and `resolved_units >= budget + grant.range`, then the ledger CLI **shall** exit 1 and emit a block message that states all three of: which budget was consumed, which unit was refused, and the two available remedies (`ledger autopilot --range N` or handoff to a new session).

- **Why** — Enforcing at claim time (before work starts) rather than at completion time stops wasted work before it happens and keeps the ledger truthful: a slice in progress implies budget was available. The in-flight-unit rule preserves unlimited intra-wave parallelism — any number of subagents may claim slices inside the current wave without hitting the block — while closing the bypass where a session claims everything upfront and completes nothing. The three-part message (budget consumed, unit refused, remedies) satisfies P-B (no swallowed signal) and gives the operator exactly the information needed to choose a path forward without guessing. Pacing gates *starting* units of work via `claim` and `set --status in_progress` only; `add` and `complete` are deliberately ungated (P-B: refusing to record finished work would falsify the ledger).
- **Fit criterion** — With `pacing.budget = 1` and one wave fully resolved, invoking `ledger claim` for a slice in wave 2 exits 1 and the output names: the consumed budget (1 wave), the refused unit (wave 2 slice id), and both remedies (`ledger autopilot --range N` and handoff). Invoking `ledger claim` for a second slice within the in-flight wave exits 0 and succeeds.
- **Verification**: automated — invoke `ledger claim` for a wave-2 slice after wave 1 is complete with `budget=1`; confirm exit 1 and message content; invoke `ledger claim` for an in-flight-wave slice and confirm exit 0.
- **Criticality**: must
- **Source**: groundwork-development#D-28

## PACING-R-003 — `ledger complete` is never blocked by pacing {#pacing-r-003}

When `ledger complete` is invoked for any slice, the ledger CLI **shall** record the completion without restriction, regardless of pacing state or budget exhaustion.

- **Why** — Refusing to record finished work would be a lie in the ledger (violates P-B). A slice that is genuinely done must be recorded as complete regardless of whether the session has exceeded its pace budget; blocking `complete` would strand the audit trail and prevent the advisor gate from reading accurate state. Pacing blocks *starting* new units of work; it never reverses or suppresses work that already happened. Pacing gates *starting* units of work via `claim` and `set --status in_progress` only; `add` and `complete` are deliberately ungated (P-B: refusing to record finished work would falsify the ledger).
- **Fit criterion** — With pacing budget exhausted (`resolved_units >= budget + grant.range`), invoking `ledger complete <id>` for any slice exits 0 and sets that slice's status to `complete` in the ledger.
- **Verification**: automated — with pacing budget exhausted, invoke `ledger complete <id>` and confirm exit 0 and the slice's status reads `complete`.
- **Criticality**: must
- **Source**: groundwork-development#D-28

## PACING-R-004 — Autopilot grant is token-gated, recorded in the ledger, and run-scoped {#pacing-r-004}

When `ledger autopilot --range N` is invoked, the ledger CLI **shall** write `pacing.grant = {range: N, granted_at: <ISO-8601 timestamp>, granted_by: <session-id, falling back to "orchestrator">, reason: <reason string>}` to the active run ledger and emit a MILESTONE journal event; the grant **shall** expire automatically with the run because it is stored in the session-scoped ledger file. A second invocation of `ledger autopilot --range N` overwrites the existing grant (one-shot cap raise, not cumulative).

- **Why** — The autopilot grant is an explicit, auditable escape hatch for sessions that legitimately need to resolve more units than the default budget allows. Recording the grant in the ledger (with timestamp and reason) makes every overage visible in the audit trail and prevents silent budget inflation. Emitting a MILESTONE journal event makes the grant discoverable in the motive history. Scoping the grant to the run (rather than a global config) means each session's overage is independent and intentional — a new session always starts fresh from the configured budget.
- **Fit criterion** — After `ledger autopilot --range 2 --reason "multi-wave emergency"`, the active ledger's `pacing.grant` equals `{range:2, granted_by:<session-id or "orchestrator">, reason:"multi-wave emergency"}` and contains a valid `granted_at` ISO timestamp; `ledger claim` for a slice in the next new unit exits 0; the journal for the current motive contains a MILESTONE event referencing the autopilot grant.
- **Verification**: automated — run `ledger autopilot --range 2 --reason "test"` and inspect the ledger `pacing.grant` field and the journal MILESTONE event; confirm a subsequent `ledger claim` for a new unit exits 0.
- **Criticality**: must
- **Source**: groundwork-development#D-28

## PACING-R-005 — Pacing exhaustion is a sanctioned stop-gate release with directive handoff {#pacing-r-005}

If the Stop hook fires and pacing is exhausted (no claimable unit remains for the current session) and one or more incomplete slices remain in the ledger, the Stop hook **shall** allow the session to end and **shall** emit a directive (not an advisory) instructing the operator to run the handoff skill and open a new session, naming the motive MAP.md path and the exact ids of all remaining incomplete slices.

- **Why** — Pacing blocks starting work; the stop-gate blocks ending a session with work remaining. Composed naively these two rules deadlock a session that can neither claim new slices nor exit — this is the single failure mode that would make the pacing feature unusable. Making exhaustion a release path resolves the deadlock. Emitting a directive (not an advisory) satisfies P-B (no swallowed signal) and ensures the operator receives an unambiguous instruction rather than a hint. The pacing release does not bypass the advisor gate for work that was completed in the session — the advisor requirement is unchanged.
- **Fit criterion** — With pacing exhausted and two incomplete slices remaining, the Stop hook exits 0 (session is permitted to end) and its output contains a directive line naming: the motive MAP.md path and both incomplete slice ids. With pacing active (budget not exhausted) and incomplete slices remaining, the Stop hook still blocks as before (unchanged behaviour).
- **Verification**: automated — with pacing exhausted and two incomplete slices, confirm Stop hook exits 0 and its output includes a directive naming the MAP.md path and both slice ids; with budget remaining, confirm Stop hook still blocks on incomplete slices.
- **Criticality**: must
- **Source**: groundwork-development#D-29

## PACING-R-006 — Autopilot grant requires a non-empty reason; block message routes authorization through the operator; stop-gate surfaces active grants {#pacing-r-006}

Three HITL (human-in-the-loop) requirements for the pacing escape hatch:

**(a) Non-empty reason required.** When `ledger autopilot` is invoked without `--reason` or with a blank/whitespace-only value, the ledger CLI **shall** exit 1 and print a usage message explaining that `--reason` is required with a non-empty operator-supplied rationale.

**(b) Block message routes authorization through the operator.** The claim-block remedy for Option A **shall** instruct the agent to ask the operator for authorization (e.g. "ask the operator to authorize `ledger autopilot --range N --reason "…"` — do not self-grant") rather than directing the agent to run the command itself. Option B (handoff) is unchanged.

**(c) Stop-gate surfaces active grants.** When the Stop hook allows a session to end and the active ledger contains `pacing.grant`, the Stop hook **shall** emit a human-readable summary line in its output stating the grant's range, reason, and granted_by session — so a grant is never silent at session end. This is non-blocking; it does not prevent the session from ending.

- **Why** — Without (a), an agent can self-grant by omitting a reason, defeating the audit trail. Without (b), the block message itself advertises the self-grant path as the primary remedy ("Option A"), making agent bypass the path of least resistance. Without (c), an operator reviewing session output has no visibility into an autopilot grant that silently extended the session budget. Together, these three changes make the escape hatch operator-mediated rather than agent-self-serve, satisfying the HITL design intent of D-28.
- **Fit criterion** — (a) `ledger autopilot --range 2 --token <t>` (no `--reason`) exits 1 with a message containing "reason"; `ledger autopilot --range 2 --token <t> --reason "  "` (whitespace-only) also exits 1. (b) `ledger claim` on an exhausted budget prints a block message whose Option A contains "ask the operator" and does not contain "run `ledger autopilot`" as a direct instruction. (c) When a Stop hook fires on a ledger with `pacing.grant = {range:2, reason:"test", granted_by:"sess-x"}`, the hook output contains a summary line mentioning "+2 unit", "test", and "sess-x".
- **Verification**: automated — covered by tests in `test/hooks/ledger-pacing.test.ts` (cases a and b) and `test/hooks/stop-gate-pacing.test.ts` (case c).
- **Criticality**: must
- **Source**: groundwork-development#D-28

## Fail-Open Guards

The nesting guard and spec guard **shall** fail-open when the caller's depth or RFC coverage cannot be determined: if the detection signal is absent, the call is permitted and a warning is emitted. This preserves liveness over strictness for advisory checks, in contrast to the hard-block behavior of the orchestrator impl-guard.

- **Fit criterion** — remove the agent depth signal from a test invocation and confirm the nesting guard emits a warning and permits the call rather than blocking.
- **Verification**: automated — the fail-open path is covered by the guard test suite.
- **Criticality**: must
