# motive: groundwork-development

## Objective

Build a plugin where intent has a single durable home (motive/spec), signals are never swallowed between detection and decision, independent work runs in parallel with the orchestrator's window protected, enforcement costs near-zero to obey, and human-readable artifacts are never contaminated by agent bookkeeping — solving P-A through P-E as defined in .groundwork/plans/groundwork-problem-definition.md.

## Acceptance criteria

- AC-1: `journal compile <motive> --json` produces a non-empty `objective`, `decision_log`, and `open_items` even when only `motive.md` exists — no plan doc, handoff file, or derived artifact required.
    The motive charter is the single source of truth; the compiler must be able to build a complete view from it alone, without depending on derived artifacts that may not exist in a fresh checkout.
    refs: enforced by `opts.charter` feeding `open_items` and `acceptance_criteria`; `objective` populated by `MOTIVE_CREATED` event handler. Note: `objectiveSource = 'charter'` is a mislabel — the value comes from the event, not the charter file. (`hooks/lib/motive-compile.mjs:480-481`, `:671-672`, `:331-335`)

- AC-2: Every DECISION event with a structured id appears in `agent.decision_log` with a non-null title — no decision is silently dropped from the compiled view.
    This directly addresses P-B (signals swallowed between detection and decision): a recorded decision must always surface in compiled output so later sessions can reconstruct why choices were made.
    refs: enforced by `hooks/lib/motive-compile.mjs:182` (`title: d.title ?? d.decision ?? null`); legacy id-less events go to `agent.decisions[]`, not `decision_log`.

- AC-3: Every acceptance criterion declared in this charter appears in `agent.ac_coverage` when compiled — unclaimed criteria show up as `unmet` rather than disappearing silently.
    A criterion absent from the compiled view is indistinguishable from one never written, so unmet criteria must be explicitly present with `covering: []`.
    refs: enforced by charter seeding at `hooks/lib/motive-compile.mjs:704-711` and unmet classification at `:727-742` (`isCompleteAnywhereComposite`, session-scoped composite ids).

- AC-4: The session stop hook blocks completion until `gate.advisor === 'APPROVE'` is recorded in the active run ledger — mechanical enforcement, not reliant on agent memory or self-report.
    An agent cannot close a session by asserting completion; the gate reads a ledger field that only the orchestrator token can write, so the barrier cannot be bypassed by a subagent's self-declaration.
    refs: enforced by `hooks/stop-gate.mjs` via `advisorVerdict()` (line 317), blocks unless result equals `'APPROVE'` (line 616).

- AC-5: A decision appended with `journal append --type DECISION` appears in the next `journal compile --json` `decision_log` immediately, with no intermediate sync or regeneration step required.
    One command is sufficient; requiring a second step would make the journal feel unreliable and invite agents to skip verification.
    refs: verifiable by appending a test decision, running compile, and confirming the new `data.id` appears in `decision_log`; if absent, AC-5 fails.

- AC-6: All machine-readable tracking artifacts (journal shards, run ledgers, ticket files) live under `.groundwork/` and are gitignored in host repos; no committed document in `doc/` or `skills/` contains bare inline agent bookkeeping markers.
    Human documents must remain clean without needing to strip agent side-channels — deleting `.groundwork/` should leave `doc/` and `skills/` complete and uncontaminated.
    refs: gitignored via `.git/info/exclude` in host repos; verifiable by `git ls-files -- doc/ skills/ | xargs grep -n 'TASK_COMPLETE\|@verifies' 2>/dev/null | grep -v $'\x60'` returning no output.

- AC-7: `MAP.md` for each motive regenerates automatically on every state mutation — a human can read the current motive state without running any CLI.
    The map is the canonical human read path; it must be ambient and always current, not a view you have to invoke.
    refs: enforced by `hooks/lib/motive-map.mjs:regenerateMotiveMap` (line 30), called via `_tryRefreshMap()` in `hooks/ledger.mjs` at lines 582 (`complete`), 804 (`add`), 899 (`set`), and in `hooks/journal.mjs` at line 603 (`append`).

## Notes

### Five core problems (P-A … P-E)

**P-A. Intent has no durable, single, machine-readable home.**
~14 overlapping intent artifacts (plan/spec/RFC/ledger/feature/goal/journal/checkpoint/handoff/PRD…); rule text duplicated across ~15 mirror files; intent decays across sessions because handoffs are prose and the run ledger records tasks, not purpose.
Success: one writable source of intent, everything else compiled from it; a successor session can reconstruct *why*, not just *what*.

**P-B. Signals are swallowed between detection and decision.**
Spec tooling silently dropped requirements and mislabeled verification methods; implementer self-reports overstate evidence; advisor APPROVE has cited fabricated evidence; tests passed vacuously via ambient env; ledger cannot see unregistered slices.
Success: every detected anomaly is surfaced loudly or explicitly accepted — never dropped; load-bearing claims verified against source.

**P-C. Parallel orchestration with a protected context window.**
Value proposition: classify → conflict-free slices → fan out wide → gate on evidence. Threats: routing gaps, context pollution from raw tool output, single-slice waves.
Success: independent work always runs in parallel; orchestrator's window holds decisions, not file dumps; stop-gate mechanically holds until evidence lands.

**P-D. Enforcement must cost ~zero to obey (constraint AND goal).**
Decisive precedent: `spec-guard.mjs` was disabled by its own author because it obstructed authoring. Enforcement that imposes continuous authoring cost gets disabled.
Success: mechanical enforcement rides on actions agents already perform (hooks on writes, ledger CLI calls, session stop) — one-time capture over continuous ceremony.

**P-E. Content is human-first; agent bookkeeping stays out of human documents.**
Human docs are for people. Machine tracking lives in agent-owned side channels: gitignored sidecars, inline `@verifies` markers, separate scratchpads.
Success: deleting every agent side-channel leaves human documents complete; regenerating them requires no human edits.

### Decision model (D-4 architecture)
Charter (`motive.md`) + DECISION events + baselines are the spine. Plan docs are retired inputs — their settled decisions are promoted to DECISION events on the motive; the files archive to `.groundwork/archive/`.

### External field report — spec subsystem (2.6.0, Kotlin project, 119 requirements)

A user built a 7-concept / 119-requirement spec tree on 2.6.0 and reported ten defects (`feedback.txt`).
Re-verified against HEAD: items 1–7 and 10b/10c/10d are already fixed by `904de0f` (silent-failure
audit) and `a150816` (RFC removal). Item 9 (anchor resolution) is confirmed open, item 8 is partially
fixed, item 10a (no `spec` on `PATH`) is documented but unshipped. See D-7 … D-9.

The report's positive findings are worth preserving as design invariants: `automated-unverified` drift
as a burndown metric, the mandatory `Why` / `Fit criterion` pair, `xref-dangling` making restructures
safe, and views-as-peers. None of the planned work may weaken these.

### Motive-compile divergence reconciliation

`journal compile` reports `0/3 slices complete` and a high-severity `slice_state_mismatch` for a motive
whose work is done. Two distinct causes, evidence in D-12: the ledger's `motive` field is unset, so
`TASK_COMPLETE` events carry a synthetic `session:<id>` motive; and the Progress reconstruction ignores
ledger status. Slice ids are reused across sessions and motives, so any cross-ledger view must key on
`(session_id, slice_id)`. Diagnose before fixing.

### Ticket/slice inversion (D-32 … D-37)

Tickets become the primary durable work object; slices become a derived, session-scoped scheduling
projection that references a ticket id. The ticket is a mattpocock-shaped document — Question,
Context, Evidence, a bold one-sentence Decision, "ruled out and why", dated retractions, cross-links —
authored as work happens rather than rendered from the ledger. Reference standard read directly:
`/home/newman/magic/nexus3/.scratch/nexus3-architecture/issues/*.md`.

The load-bearing hazard, confirmed against source: `hooks/lib/motive-tickets.mjs` (lines 134-139)
enumerates `tickets/` and `rmSync`s every `.md` whose stem is not in its generated set. Durable
tickets in that directory would be destroyed on the first regeneration under a fresh session ledger.
Hence D-33: per-slice ticket generation is removed outright, derived open-item drill-downs move to
`open-items/`, and no groundwork code path may delete a markdown file it did not itself generate.

Implementation runs in three waves — T1 spec requirements, T2 the `ticket` slice key (tracer bullet),
T3 the ticket document format; then T4 ownership inversion, T5 MAP renders from tickets, T6 journal
id discipline; then T7 skills/docs sweep and T8 migration + tests. Negative scope is explicit: pacing
semantics (D-28), stop-gate release paths (D-29), and advisor gating are untouched. The pilot 2 rail
(D-30) is retired — pilot 2 concluded (D-54) — and implementation slices now execute freely.

## Tickets

The live ticket index — type-grouped, with ledger status — is auto-maintained in
MAP.md → `## Tickets`. Open items below link their graduating ticket inline (`graduated-to:`).
Not every ticket graduates from an open item: e.g. ticket `01-research-first-class-ticket-pattern`
is research with no originating TBD.

## Open items

- TBD-22: Ticket default path is gitignored, so tickets lose git history and PR review
    Documents that P-E calls human-first vanish on a clean checkout and never get code-reviewed when they live under the default `.groundwork/` path. An opt-in `tickets_dir` pointing at a committed path provides an escape hatch; revisit once the corpus is large enough to judge whether the default should flip.
    refs: D-37
- TBD-3: DECISION id merge cannot distinguish intentional revision from accidental id collision
    When two DECISION events share the same id, the later one silently overwrites the earlier — a deliberate refinement and an accidental reuse look identical to the compiler. D-1 and D-13 suffered accidental reuse that destroyed earlier decision text; D-40 used the same mechanism correctly as a refinement. Fix: add a uniqueness signal at append time and a `revises` field to mark intentional revision; data repair of D-1/D-13 follows once the signal exists.
    refs: `motive-compile.mjs:206-226`, affected ids D-1 ×2, D-13 ×2, D-15 ×2, D-40 ×3; see D-50, TBD-30
- TBD-1: Whether to rename the `journal`/`motive`/`compile` commands to match current vocabulary is still undecided
    Existing names work; a rename is only worth the disruption if ergonomics clearly justify it. Low priority.

- TBD-2: Motive files are per-machine only, not shareable with collaborators
    Gitignored motives are durable per-machine but invisible to collaborators. Accepted for now; a sharing strategy remains to be decided.
- TBD-4: ~~**Blocks WS2 (hitl-visualization) beyond its diagnose slice.** The interaction graph must join
  DECISION events to ledger slices, but `hooks/ledger.mjs` writes no `motive` field at all (grep: zero
  hits), so `TASK_COMPLETE` carries a synthetic `session:<id>` and no motive-keyed join exists. Per the
  divergence note above, the join must key on `(session_id, slice_id)`. Diagnose (slice V1) before any
  renderer work; V2–V4 stay unstarted until this resolves. See D-14.~~ **RESOLVED** — ledger↔journal join
  implemented via slices `tbd4-join-fix`, `F1`, `F2`; commit 156629a. The `motive` field is now written by
  `hooks/ledger.mjs` and the join keys on `(session_id, slice_id)` as required.
- TBD-5: Blast-radius for research requirements is self-declared by the authoring agent, not mechanically derived
    The `data.blast` field is set by whoever appends the event, with no tool verification. Accepted as a pragmatic one-time capture per P-D (enforcement must cost near-zero to obey); revisit only if self-declaration proves unreliable in practice.
    refs: D-13
- TBD-6: A "fog" register for acknowledged-but-not-yet-specifiable intent is not yet implemented
    Fog items are distinct from TBD (decision pending): they are in-scope but blocked on design clarity. Borrowed from wayfinder's fog/frontier vocabulary. Items here graduate to the backlog once they become specifiable enough to design.
- TBD-7: A `frontier` query command showing open, unblocked, unclaimed work items is not yet shipped
    A `journal frontier` (or `ledger frontier`) command would let a session quickly find what work is available to claim without manually cross-checking the ledger. Tracked as ledger slice `frontier-query`.
- TBD-8: The acceptance-criterion × slice traceability matrix is not yet rendered
    A compiled view mapping each acceptance criterion to the ledger slice(s) that satisfy it would make coverage auditable at a glance. Tracked as ledger slice `traceability-matrix`. Previously blocked by the motive-keyed join gap (TBD-4), which is now resolved.
- TBD-9: The slice dependency DAG is not yet rendered in compiled output
    A Mermaid diagram showing blocked_by edges across all slices in a run would make scheduling constraints visible at a glance. Previously blocked by the same motive-keyed join gap as TBD-8 (TBD-4, now resolved).
- TBD-10: Cross-session ledger timeline view is not yet built
    A unified chronological view spanning multiple run ledgers for a given motive — showing slice completion and wave boundaries across sessions — would make multi-session progress readable without CLI access. Future work.
- TBD-11: Decision rationale is not yet queryable as a structured index
    A successor session reconstructs decisions today by scanning raw journal shards; a queryable index by motive, date, and affected slices would let any session recover *why* a design choice was made without reading raw events. Future work; directly addresses P-A (intent has a single durable home).
- TBD-12: Decision entries have no schema guidance, causing inconsistent and null fields in compiled output
    `journal append --type DECISION` accepts free-form JSON, so agents omit the `decision` key or use non-standard field names, causing compiled output to show `"decision": null`. A minimum schema prompt or validator — `{decision, rationale, alternatives[]}` — would prevent the most common gaps. Backlog.
    refs: pilot comparison G3
- TBD-13: Adding fog items via `ledger add` is too verbose for routine use
    Creating a fog slice requires spelling out flags that do not apply to fog items (`--acceptance`, `--blocked-by`, etc.). A shorthand like `ledger fog <id> --desc "..." --question "..."` that creates a `kind: fog` slice with no acceptance criteria required would lower the authoring barrier. Backlog.
    refs: pilot comparison G4
- TBD-14: No human narrative layer linking decisions to the slices that implement them
    Structured data in the ledger and journal is machine-readable but not human-navigable for design rationale. A `ledger show <id>` enhancement that pulls DECISION events intersecting `covers_ac` would give a combined human-readable brief without requiring cross-referencing tools. Backlog.
    refs: pilot comparison G5
- TBD-15: Concurrent claim collision scenario is untested
    If two sessions try to claim the same slice simultaneously, the second claim should be rejected or queued — but no test covers this scenario. Write a test that spawns two ledger processes simultaneously and confirms the second `claim` is rejected. Backlog.
    refs: pilot comparison G6
- TBD-16: ~~**Journal compile: multi-ledger/multi-run support** (pilot comparison G7) — If a motive spans multiple runs (common multi-session feature), compile should fold events from all runs. Currently run-context seam makes this brittle. Backlog.~~ **CLOSED** — multi-run event folding already ships: `readAllEvents` at `hooks/lib/journal-io.mjs:274` folds events across all runs; ledgers union in `motive-ground-truth.mjs`. Closed per D-22.
- TBD-17: MAP.md does not yet auto-regenerate on every ledger mutation
    Without automatic map regeneration, users must run a CLI to see current motive state — violating the principle that the map should be ambient and always current. Groundwork's run ledger and journal are non-human-readable formats; users should not need to know the CLIs exist to read the map. Tracked as ledger slice `map-autogen`.
- TBD-18: No established pattern requiring new machine stores to ship a human projection alongside them
    P-E says agent bookkeeping stays out of human documents — but there is no rule requiring a human-readable projection to ship with every new machine-readable store. The pattern to establish: whenever a new store is added (ledger, journal, etc.), ship a `.md` projection in the same change; the projection is the canonical human read path. Backlog (architectural principle for future stores).
- TBD-19: ~~**Discoverability: point docs/session-start at MAP.md, not CLIs** — Session-start reminders and user-facing documentation should direct users to read `.groundwork/runs/<session_id>/MAP.md` rather than listing available CLI commands. The map is the human interface; CLIs are an implementation detail. Include in next docs pass and session-reminder hook update.~~ **RESOLVED** — MAP.md is written to `.groundwork/motives/<slug>/MAP.md` (per-motive path, not per-run); session-reminder hook and CLAUDE.md now direct readers there. Delivered by slices `reminder-map`, `claudemd-map`, `fix-map-path`.
- TBD-20: ~~**MAP.md "Out of scope" section renders empty** — DECISION events record explicit rejections (e.g. ASD-STE100 "do not adopt"), and `.groundwork/out-of-scope/` files exist for rejected items, but MAP.md's "Out of scope" section renders empty. The map renderer should surface both rejection-DECISION events and out-of-scope/ entries in that section. Origin: advisor gate open question, 2026-08-04.~~ **RESOLVED** — "Out of scope" section now renders both rejection-DECISION events and `.groundwork/out-of-scope/` entries. Delivered by slices `map-oos`, `oos-dedup`.
- TBD-21: Run ledger JSON is non-human-readable, with no per-slice drilldown path available
    MAP.md lists slice and TBD IDs but offers no drilldown to the story behind each item. Implementing as ledger slice `tickets-autogen`: ambient `tickets/<id>.md` per slice and open item, linked from MAP.md. Complements TBD-14 (narrative layer for design rationale) and embodies TBD-18 (principle: every machine store ships a human projection).
    refs: D-21
- TBD-23: Ledger slices have no `decisions` field, so there is no direct link from a decision to the slice implementing it
    A DECISION event captures why a design choice was made, but there is nowhere on the implementing slice to record which decision it executes. Without this link the interaction graph cannot be traversed from intent to work item. Add a `decisions: [...]` field to the ledger slice schema. Backlog.
    refs: pilot comparison G1, `.groundwork/pilots/COMPARISON-MATTPOCOCK.md`
- TBD-24: DECISION events have no enforced schema for ruled-out alternatives
    Agents append free-form JSON, so most DECISION events have no `alternatives` key and no "ruled out because" rationale. Without it, decisions get re-litigated in later sessions. Add `alternatives: [{option, ruled_out_because}]` as a required field, validated at append time. Pair with TBD-12.
    refs: pilot comparison G2, `.groundwork/pilots/COMPARISON-MATTPOCOCK.md`
- TBD-25: Acceptance blocks have no co-located verifying test name
    MAP.md lists acceptance criteria text but not the test that verifies each criterion, so tracing from a work item to its test requires knowing the test file layout. Add an optional `verifying_test: <name>` field to acceptance blocks and render it in MAP.md so a human can trace directly from work item to test. Backlog.
    refs: pilot comparison G3, `.groundwork/pilots/COMPARISON-MATTPOCOCK.md`
- TBD-26: Stale next_actions from completed runs surface on every fresh session resume
    `journal compile --json` emits `agent.resume.next_actions` pointing at slices from closed runs even after those runs are fully complete with gate APPROVE. A successor session must manually cross-check `ledger view` to dismiss these stale pointers — a P-B failure where "that run is finished" is swallowed before it reaches the resume decision. Expected fix: derive next_actions only from runs that are active and have at least one incomplete slice.
    refs: observed 2026-08-04 (session resume and post-G1 gate verification)

- TBD-27: D-1 and D-13 original decision text was destroyed by id collision and has not been recovered
    D-1's original "Problem definition adopted (P-A through P-E) as the evaluation yardstick" and D-13's "divergence findings must render the slice id" are absent from compiled `decision_log`; both survive only in raw journal shards. D-1's original is load-bearing — P-A..P-E is the evaluation yardstick for this entire motive. The cause: the same-id merge in the compiler applies last-wins on `title`; a second DECISION event for each id supplied a different `data.title`, silently overwriting the first. D-70 closed a separate drop path but did not fix this case. Recovery requires a data-correction step using the `revises` mechanism.
    refs: D-1 original at `.groundwork/journal/2026-08-03-d7a17626-ed73-44c9-86ed-7ac8af507fde.jsonl` line 105; D-13 original at `.groundwork/journal/2026-08-03-9d6ca522-1d8b-48e1-ad2b-9010ef5d68d3.jsonl` line 7; `hooks/lib/motive-compile.mjs` same-id merge; see D-70
- TBD-28: The `alternatives` field is silently dropped for structured-id decisions in compiled output
    When a DECISION event carries a well-formed `alternatives` array, that array does not appear in compiled `decision_log` entries — only the legacy id-less `agent.decisions` path exposes it. Authors are never warned, so decisions intended to document ruled-out options lose their alternatives silently. Fix the compile-side drop before adding any authoring-side validation, or the validator will demand a field the compiler discards.
    refs: `motive-compile.mjs:177-184` (no `alternatives` copy); D-45 through D-49 each carry well-formed `alternatives` arrays absent from `decision_log`; see TBD-24
- TBD-29: MAP.md renders resolved open items as still open, even when the compiled JSON knows they are closed
    Compiled JSON correctly tracks which items are resolved, but MAP.md's open items section does not consult that resolution state — so three items closed by DECISION events (TBD-7, TBD-17, TBD-21) continue to appear as open in the human-facing map. The burn-down moved in JSON only; the canonical human read path (MAP.md) is stale. Fix: have the MAP renderer filter on resolution state, or have compile populate `resolved_by` on the item itself.
    refs: D-45/D-46/D-47 closed TBD-7/TBD-17/TBD-21; `resolvedByDecisions` in `motive-compile.mjs:237`; `motive-tickets.mjs` open-items sweep   ·   graduated-to: 03-fix-map-resolved-items-still-shown
- TBD-30: Seven legacy id-less DECISION events produce duplicate entries in MAP.md's "Decisions so far" section
    A 2026-08-03 backfill created structured D-1..D-6 entries alongside the original id-less events but never added `data.retires` linkage to retire the originals — so both survive. The deduplication step in the MAP renderer uses strict prefix matching, which fails for all six legacy pairs because the structured versions use slightly different wording (e.g. "problem definition adopted (p-a…" vs "problem definition p-a through…"). Fix: append one retraction event per id-less original carrying `data.retires`, routing them through the step-1 dedup path.
    refs: journal shard `.groundwork/journal/2026-08-03-d7a17626-ed73-44c9-86ed-7ac8af507fde.jsonl` lines 98-110; `motive-map.mjs:186-208` (step 1 dedup), `motive-map.mjs:225-243` (step 2 strict-prefix); the original TBD-3 count of six omitted the 'pilot comparison complete' event (seven total)   ·   graduated-to: 05-fix-duplicate-decision-map-entries
- TBD-31: Compile and MAP use different keying strategies for AC status, so they can diverge on multi-session scenarios
    MAP.md keys AC met/unmet status on a composite `(session_id, slice_id)` per D-12, while the compiler still uses bare-id complete-wins dedup. Today all groundwork-development ACs are covered by a single session so both agree — but any scenario where the same slice id appears in two sessions will produce disagreement. Fix: key compile AC status on the composite id and add a MAP↔compile status parity test.
    refs: D-12, D-85, D-86
- TBD-32: A subagent was able to write `gate.advisor=APPROVE` to the run ledger without the orchestrator token
    The advisor completion gate is supposed to be orchestrator-only, but the token check was not enforced — a general-purpose subagent bypassed it entirely. The ledger `gate` write must reject requests that lack a valid `--token` so subagents cannot self-approve a run they did not orchestrate. This is a security hole in the stop-gate itself.
    refs: observed session 8f86b81a   ·   graduated-to: 02-fix-stop-gate-token-bypass
- TBD-33: The AC-seam parity test uses two separate fixtures instead of one shared cross-surface assertion
    `test/hooks/ac-seam-session-parity.test.ts` guards the MAP↔compile AC status seam with Test 1 (compile UNMET off journal shards) and Test 2 (MAP UNMET off ledger files). Both surfaces are pinned to UNMET, so drift on either side goes red. A stronger test would feed a single same-slice-id-two-sessions fixture into both surfaces and assert `mapStatus === compileStatus` directly, catching divergence rather than individual-surface failures. Non-blocking; optional strengthening.
    refs: D-68 AC-3 forward-carrier completion gate
- TBD-34: When a DECISION event supplies both a title and a decision field, the decision text is silently dropped
    `journal append --type DECISION` requires `data.decision`, but the compiler derives the compiled title as `d.title ?? d.decision` and exposes no standalone `decision` field. Any event supplying both loses its `decision` text silently, with no warning to the author. This is a P-B violation: a required field detected at write time, dropped before it reaches the human read path. Reproduced: a D-88 recovery append carried both title and decision; the phrase "evaluation yardstick" (the decision text) was absent from the compiled log until the append was redone omitting the title. Candidate fixes: expose a standalone `decision` field in the compiled entry, reject both-fields at append time, or drop the append-time requirement.
    refs: `hooks/journal.mjs` cmdAppend (decision required, exit 2); `hooks/lib/motive-compile.mjs` (title derivation `d.title ?? d.decision`); distinct from TBD-28 (`alternatives` dropped) and TBD-12 (`decision` key omitted)   ·   graduated-to: 04-fix-journal-decision-dropped-when-title-present
- TBD-35: `ledger init --no-token` can silently overwrite an active tokened ledger, re-opening the stop-gate bypass that TBD-32's fail-closed fix was meant to close
    Any caller — including a subagent — can run `ledger init --no-token` over an active tokened run, replacing the `write_token` with `token_free: true` and then writing `gate.advisor=APPROVE` with no token. This defeats the fail-closed guard in `assertWriteToken` because the early-return on `token_free === true` has no way to distinguish a legitimately token-free run from one that was downgraded by clobber. The guard needed: `init` must refuse to overwrite an active tokened run unless the caller supplies the existing write token, or the token-free path must be blocked once a token has been issued.
    refs: `hooks/ledger.mjs` cmdInit calls `atomicWriteJsonSync(ledgerPath(), obj)` unconditionally (no active-tokened-run guard); `assertWriteToken` early-return on `token_free === true`; distinct from TBD-32 (original stop-gate token bypass, resolved by the fail-closed fix — this is a residual downgrade hole through a different door)
- TBD-36: Model the motive as a graph and build an infinite-canvas visualization of motive + specs (potential suite showcase via a pilot project)
    The motive is already a latent graph: graduated_to, blocked_by, covers_ac/AC-coverage, decisions on slices, resolved_by, and spec traceability xrefs are all edges already present in the data — they are just not surfaced as a traversable structure. An infinite-canvas view would make the full motive + spec navigable at a glance, exposing cross-cutting relationships (e.g. which decision motivated which slice, which open item a spec requirement traces to) that are currently machine-readable only. This is also a strong showcase opportunity: building it end-to-end via a throwaway pilot project would dogfood the interview→planner→slice→gate flow on a fresh, self-contained initiative, demonstrating how well the suite handles a new feature from scratch. It is a new initiative requiring its own interview→planner pass; it is not yet scoped or sliced.
    refs: inspiration https://data4sci.com/blog/building-an-advanced-agentic-harness ; existing edge sources in the data: graduated_to, blocked_by, covers_ac/AC-coverage, slice decisions field, resolved_by, spec traceability xrefs; feature/initiative, not a bug

## Out of scope

<!-- Pointers to .groundwork/out-of-scope/ for rejected items. -->

`--covers-ac` MUST NOT be retro-stamped onto already-complete slices to inflate coverage numbers. Doing so flips an AC to MET with no verification behind it — a false green is strictly worse than an honest empty. Coverage is claimed only by a slice that actually executes and verifies the criterion during its own run. Backfilling completed slices with AC ids purely to populate the traceability matrix is explicitly out of scope for any implementation wave.
