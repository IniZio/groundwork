---
type: constraints
id: C-ENFORCEMENT
---

# Enforcement Constraints

## ENFORCEMENT-R-001 — Impl-guard blocks orchestrator direct edits outside permitted paths {#enforcement-r-001}

If an Edit or Write call is received from the orchestrator identity on a path that is not a permitted memory file, then the enforcement hook **shall** return a deny block.

- **Why** — The orchestrator role is to classify, delegate, and review work — never to implement directly. Direct implementation by the orchestrator consumes the expensive session model (opus) for file edits that should be delegated to subagents (which run on sonnet per model-registry.json). Under real context pressure, this advisory is routinely dropped: observed groundwork sessions ran 200+ Edits + 37+ Writes on the orchestrator's model despite correct fan-out machinery being available, resulting in ~88% of output-token load landing on the expensive model. This hook enforces the division of labor mechanically. The one permitted path (session/project memory under `~/.claude/projects/<hash>/memory/`) covers composition-in-context documents the orchestrator must write in a single turn; code and test and tooling changes belong to delegated subagents.
- **Fit criterion** — The enforcement hook test suite passes all deny cases: Edit and Write calls from the orchestrator on paths outside the permitted shape are blocked; calls from subagents are passed through; the permit path (memory files under the user home claude projects directory) is allowed; and spoof paths resolving outside that shape are blocked.
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

## PACING-R-007 — Milestone policy gates on human-verified shippable deliverables, not wave count {#pacing-r-007}

When `pacing.policy` is `"milestone"`, the pacing unit is a named shippable increment rather than a wave or slice count. A milestone is defined by the set of evidence artifacts declared in `pacing.milestone_artifacts`. The pacing gate **shall** hold (block new units from starting beyond the current in-flight set) until a human sign-off is recorded in `pacing.milestone_signoff` with `verdict: "APPROVE"`. Until S7 implements milestone enforcement, the policy falls back to wave-unit counting (see `hooks/lib/pacing.mjs` S7 stub comment).

- **Why** — Wave/slice count pacing is a proxy for delivery checkpoints. Milestone pacing replaces the proxy with a direct human-verified shippable increment: the gate releases only when a named human has confirmed the named artifacts. This aligns the pacing model with the motive definition of a milestone ("a shippable increment with named artifacts that a human signs off on; pacing gate releases on human verification, not wave count").
- **Fit criterion** — With `pacing.policy = "milestone"` and `milestone_artifacts` declared but `milestone_signoff` absent (or `verdict: "REJECT"`), `ledger claim` for a slice in a new unit exits 1 and the block message names the outstanding milestone. With `milestone_signoff.verdict = "APPROVE"` present, `ledger claim` exits 0.
- **Verification**: automated — covered by tests in S7's test suite (milestone enforcement). S6 (this spec) is design-only; the fit criterion is not testable until S7 lands.
- **Criticality**: must
- **Source**: spine-beads-hitl-portability#S6

## PACING-R-008 — Milestone sign-off requires write_token authority; subagents must not self-sign {#pacing-r-008}

When S7 records a `milestone_signoff` object in the ledger, the CLI command that writes it **shall** require the orchestrator `write_token` (the same token that gates `ledger gate` and `ledger complete`). Invoking the sign-off command without a valid `write_token` **shall** exit 1 with a message naming the missing authority. A subagent that cannot present the `write_token` cannot record a sign-off — preventing a subagent from approving its own work.

- **Why** — The milestone sign-off is the human verification event that releases the pacing gate. If a subagent can write it without token authority, the human-in-the-loop guarantee is defeated: any subagent can self-certify completion. The write_token is the existing credential that denotes orchestrator-level authority; requiring it here extends the same trust boundary that already protects `ledger gate advisor APPROVE`. The token is never passed to subagents (CLAUDE.md: "MUST NOT pass it to subagents"), so requiring it structurally excludes them.
- **Fit criterion** — Invoking the sign-off command without `--token <write_token>` exits 1 with an error citing missing token authority. Invoking it with a valid token succeeds and writes `milestone_signoff` to the ledger.
- **Verification**: automated — S7 test suite covers both token-absent (exit 1) and token-present (exit 0 + ledger updated) cases.
- **Criticality**: must
- **Source**: spine-beads-hitl-portability#S6

## PACING-R-009 — Milestone artifacts are hook-validatable; staleness is derived from build-hash comparison {#pacing-r-009}

Each entry in `pacing.milestone_artifacts` **shall** carry a `path` (local file path or URL), a `kind` (one of `screenshot`, `run_output`, `live_url`, `file`), and a `captured_build_hash` — **required** for `screenshot` and `run_output` (rejected without one); **optional** for `live_url` and `file`. A hook **shall** be able to validate milestone artifacts mechanically: (1) for `file` artifacts, confirm the local file exists; for `live_url` artifacts, confirm a captured companion (`file`, `run_output`, or `screenshot`) is present in the same milestone — no network probe is performed; (2) when `captured_build_hash` is present, compare it against the current build hash and classify the artifact as `fresh` or `stale` — using the same comparison semantics as the traceability evidence freshness mechanism (`traceability-classify.mjs`) rather than a second independent scheme.

**Fail-closed enforcement (V9 amendment):** When an artifact declares a `captured_build_hash` and the current build hash is not supplied (i.e. `--build-hash` is absent from `ledger claim` or `ledger set --status in_progress`), the artifact **shall** be classified as STALE and the gate **shall** block. Omitting `--build-hash` is not a bypass — it is treated as inability to verify freshness, which fails closed. To release the gate, the operator must pass `--build-hash <current>` explicitly. Artifacts of kind `screenshot` or `run_output` that declare no `captured_build_hash` are **rejected** (missing required field — fail-closed, not existence-only). `file` artifacts that declare no `captured_build_hash` are validated for local-file existence only (no hash check). `live_url` artifacts require a captured companion (`file`, `run_output`, or `screenshot`) in the same milestone — a URL alone is not a capture; no network reachability probe is performed. An artifact with an unknown or absent kind is also rejected fail-closed.

- **Why** — Milestone artifacts must be machine-checkable for the gate to be meaningful. For `file` artifacts, local-file existence is sufficient for mechanical validation. For `live_url` artifacts, a URL is a string, not a capture; gate-time reachability proves only that a URL resolved at gate time, not that it showed the claimed behaviour — therefore a `live_url` requires a captured companion (`file` for a HAR or export, `run_output` for a newman/postman run report, or `screenshot`) in the same milestone. No network probe is performed on any `live_url` (by design: no probe means no false-fails from network flakiness). For `screenshot` and `run_output` artifacts, `captured_build_hash` is additionally required — omitting it is a required-field violation, not a bypass. Adding `captured_build_hash` enables staleness detection: if the underlying data was regenerated after the artifact was captured, the hash drifts and the hook marks the artifact stale — preventing a human from approving screenshots that do not reflect the current state of the system. Reusing the existing freshness mechanism (`captured_build_hash` field, `fresh`/`stale` classification) avoids inventing a second freshness scheme and keeps the two mechanisms consistent by design. The fail-closed rule (V9) closes the gap where the deployed path (`bin/ledger claim` with no `--build-hash`) silently skipped the freshness check while the pure-function tests appeared green — matching the exact shape documented in the `tests-bypass-deployed-invocation-path` memory entry.
- **Fit criterion** — Given a `milestone_artifact` with `captured_build_hash` equal to the current build hash, the hook classifies it as `fresh`. After a data regeneration that changes the build hash, the same artifact is classified as `stale`. A `milestone_artifact` of kind `file` with no `captured_build_hash` is checked for local-file existence only (no freshness check). A `milestone_artifact` of kind `live_url` with no captured companion (`file`, `run_output`, or `screenshot`) in the same milestone is **rejected** — a URL alone is not a capture; a `live_url` with a captured companion passes (no hash check required for the URL itself). A `milestone_artifact` of kind `screenshot` or `run_output` with no `captured_build_hash` is **rejected** — the field is required for those kinds. Invoking `bin/ledger claim <id>` with NO `--build-hash` against a ledger with APPROVE sign-off and a hashed artifact exits 1 (blocked); the same invocation with `--build-hash <matching>` exits 0 (released).
- **Verification**: automated — deployed-path coverage in `test/hooks/ledger-claim-milestone-deployed.test.ts`; pure-function coverage in `test/hooks/pacing-milestone.test.ts`.
- **Criticality**: must
- **Source**: spine-beads-hitl-portability#S6, spine-beads-hitl-portability#V9

## PACING-R-010 — Milestone sign-off composes with awaiting_human; the two mechanisms must not conflict {#pacing-r-010}

When `pacing.policy = "milestone"` and the gate is waiting for human sign-off, the orchestrator **shall** be able to set `awaiting_human = true` (via `ledger await-human --token <write_token>`) to suppress the stop-gate nag while the human decides. The `awaiting_human` hold does not release the milestone gate — it only suppresses the nagging until the human either approves or rejects. Clearing `awaiting_human` (via `--clear`) resumes normal milestone enforcement. S7 MUST ensure that clearing the hold AND receiving `milestone_signoff.verdict = "APPROVE"` are two separate events — collapsing them into one write would lose auditability.

- **Why** — Without `awaiting_human` composition, the stop-gate would nag continuously while a milestone is awaiting human review — the nag is correct (work is incomplete) but disruptive during a legitimate wait. The `awaiting_human` field was introduced exactly for this pattern (token-gated hold that pauses enforcement without bypassing it). Milestone pacing is the most natural consumer. The two-event separation preserves the audit trail: the ledger records both when the hold was set and when the sign-off arrived, providing a complete timeline.
- **Fit criterion** — With `pacing.policy = "milestone"` and `milestone_signoff` absent, setting `awaiting_human = true` causes the stop-gate to suppress the block nag. The milestone gate itself still holds (no new units may be claimed). Clearing `awaiting_human` restores normal stop-gate behavior. Receiving `milestone_signoff.verdict = "APPROVE"` releases the milestone gate independently of the `awaiting_human` state.
- **Verification**: automated — S7 test suite covers the interaction between `awaiting_human` and the milestone gate.
- **Criticality**: must
- **Source**: spine-beads-hitl-portability#S6

## PACING-R-011 — Evidence artifacts under `.groundwork/` are never committed {#pacing-r-011}

Evidence artifacts recorded in `pacing.milestone_artifacts` and stored under `.groundwork/` **shall** never be committed to the repository. HAR files routinely carry `Authorization` headers, `Cookie`/`Set-Cookie` headers, and session tokens; committing them exposes credentials to every consumer of the repository's history.

- **Scope** — This rule addresses the commit path only. It does not prevent an agent from reading a HAR file during a session, or a human from pasting a response excerpt elsewhere. A scrubber was considered (to strip sensitive headers before committing) and deferred; the simpler rule is: do not commit.
- **Why** — The `.groundwork/` runtime directory is gitignored in the groundwork repo and excluded via `.git/info/exclude` in host repos. Artifacts under it inherit that exclusion. An explicit rule is stated here because the exclusion is an implementation detail that could change, and the security rationale should be durable.
- **Fit criterion** — `.groundwork/` is listed in `.gitignore` (groundwork repo) or `.git/info/exclude` (host repos). No evidence artifact path under `.groundwork/` appears in `git ls-files`.
- **Verification**: manual — confirm `.groundwork/` is excluded before any commit that touches milestone_artifacts.
- **Criticality**: must
- **Source**: groundwork-development#D-27

## Fail-Open Guards

The nesting guard and spec guard **shall** fail-open when the caller's depth or RFC coverage cannot be determined: if the detection signal is absent, the call is permitted and a warning is emitted. This preserves liveness over strictness for advisory checks, in contrast to the hard-block behavior of the orchestrator impl-guard.

- **Fit criterion** — remove the agent depth signal from a test invocation and confirm the nesting guard emits a warning and permits the call rather than blocking.
- **Verification**: automated — the fail-open path is covered by the guard test suite.
- **Criticality**: must

## SEAL-R-001 — Accepted residual: arbitrary-code-execution as the same OS user can forge a valid seal {#seal-r-001}

The sealed-gate design provides tamper-evidence against the realistic threat model (CLI misuse, direct `Write`/`Edit` tool calls, and simple Bash mutation patterns) but **shall not** be construed as guaranteeing containment against a subagent with arbitrary code execution running as the same OS user. Such a subagent can read the seal key from disk and write a correctly re-sealed ledger via `computeSeal(canonicalReleaseState(ledger), key)`, bypassing the stop-gate entirely. This is an accepted, documented residual risk.

- **Why** — Perfect containment without OS-level isolation (a separate UID, container boundary, seccomp policy, or equivalent mechanism) is impossible: any process running as the same user can read and write any file that user owns. The sealed-gate feature is a defense-in-depth measure against common, non-adversarial failure modes — accidental CLI misuse, guard-bypass via direct file writes, and simple Bash injection. It is not a security boundary. Documenting this residual explicitly prevents over-reliance on the mechanism and provides a clear anchor for future hardening decisions (e.g. storing the key in a separate process, kernel keyring, or external secret store).
- **Fit criterion** — Not automatically testable. Verification requires threat-model review: confirm that `hooks/lib/gate-seal.mjs` stores the key at a filesystem path readable by the ambient process user (`<projectDir>/.groundwork/runs/<sessionId>.seal.key`, mode 0600), and that nothing at the OS level prevents an arbitrary process running as that user from reading the key and calling `computeSeal` to produce a valid seal for any desired ledger state.
- **Verification**: manual — not automatable; the threat model is validated by review of `hooks/lib/gate-seal.mjs` (key storage) and `test/hooks/sealed-gate-vectors.test.ts` (documents the boundary of what IS tested).
- **Criticality**: must
- **Source**: sealed-gate#D-10
