# Groundwork Skillset Research — Synthesis & Recommendations

**Status:** RESEARCH ARTIFACT (not a PRD; not staged/committed). Gates any implementation.
**Date:** 2026-07-25
**Method:** 4 read-only scouts fanned out in parallel, framed against 3 user-identified pain points.
**Sources:** scout reports `local://sliceA-mattpocock.md`, `local://sliceB-external.md`, `local://sliceC-groundwork.md`, `local://sliceD-resumption.md` (each source-cited to external URLs / `path:lines`).

---

## 0. TL;DR

| Pain point | Today (groundwork) | Best-in-class pattern | Recommended change | Tier |
|---|---|---|---|---|
| **P1** Spec-refinement underused | Strong prose, **weak mechanics**; `planner` keyword route bypasses interview; `kind:plan` is metadata-only, never gates stop; many short-circuits | Superpowers `<HARD-GATE>`; Spec Kit `clarify→analyze(CRITICAL)→tasks→implement` | Add a **spec/plan soundness pre-gate** (advisor or stop-gate) + **sharpen interview mandate** + close the planner-route bypass | **P0** |
| **P2** Cross-session feature tracking weak | All artifacts **session-scoped**; explicit anti-feature-tracking signals; no feature-grain resume pointer | OpenSpec `changes/<id>/`+Stores; Spec Kit feature dir+`[X]`; Linear Project+AgentSession | New **`.groundwork/features/<slug>.json`** feature ledger + **`resume` skill/command**; `handoff` becomes a renderer | **P1** |
| **P3** Gating shallow | Axes = `correctness·completeness·over_engineering` only; qa informational; no re-plan/re-slice axis | OpenSpec Completeness/Correctness/Coherence; mattpocock Spec∥Standards; Superpowers BLOCKED→re-plan | Add **`contract_fitness` + `plan_soundness` axes** to advisor; add **`REPLAN` verdict** | **P1** |

**Highest leverage / lowest risk first:** P1 pre-gate (pure skill/agent prose + stop-gate `kind` promotion) is the cheapest high-impact win. P3 axes are additive rubric changes. P2 is the largest new surface (new artifact + skill + optional hook).

**Biggest differentiation opportunity:** P3b — *no surveyed peer* has a blocking mid-flight **REPLAN** verdict with APPROVE/REVISE teeth (Slice B gap analysis). Groundwork's existing advisor-gate + run ledger is the natural home for it.

---

## 1. Pain point framing (the three things to fix)

1. **P1 — Spec-refinement is underused.** Agents jump to implementation. The `interview → planner → implement` chain exists but is neither enforced nor effective.
2. **P2 — Cross-session feature tracking is weak.** Large multi-session features are hard to resume; there is no reliable "pick up here" pointer at the *feature* grain.
3. **P3 — Gating is shallow.** `advisor-gate` rubrics correctness/completeness/over-engineering but does NOT verify (a) whether QA tests the *right contract*, nor (b) whether the orchestrator should *step back* and re-plan/re-slice before continuing.

---

## 2. Current-state gaps (from Slice C — `local://sliceC-groundwork.md`)

### P1 — enforcement strength: **WEAK** (strong prose, weak/no mechanics)

What claims MANDATORY:
- `bootstrap-orchestrator.md:11` — *"Always plan and slice before implementation — non-trivial features require `interview` → `vertical-slice` → fan out. Never start coding without a plan and a slice ledger."*
- `CLAUDE.md:16,59` — feature (>1h) row mandates interview → vertical-slice → fan-out → advisor.
- `routing-detail.md:90-91` — *"Mandatory skill-tool invocations: `interview` → `implement` (→ `vertical-slice`) → `advisor-gate`. Never skip."*
- `implement/SKILL.md:22-28`, `vertical-slice/SKILL.md:39-41`.

What makes it skippable (the leaks):
- **Trivial / SmallClear / Docs** → `implement directly` (`routing-detail.md:36-39,54,80-82`).
- **`planner` keyword route** → `planner → read .groundwork/plans/*.md → fan-out general-purpose` — **interview NOT named** (`CLAUDE.md:66`; `keyword-router.mjs:21-29`).
- **`kind:plan` is metadata only** — *"Gating is status-keyed — kind is metadata only and does not affect stop-gate logic"* (`vertical-slice/SKILL.md:140`).
- **Stop-gate fail-open** when no ledger; never requires a `plan_ref` or interview artifact (`stop-gate.mjs:306-311`).
- **Codex/non-hook hosts** — ledger/gate advisory only.

Net: the *only* mechanical teeth are "orchestrator must not edit" (`orchestrator-impl-guard.mjs`) and "if a ledger exists, finish slices + advisor APPROVE." Nothing verifies a plan/spec existed before coding.

### P2 — enforcement strength: **WEAK** (multi-session) / **STRONG** (same-session)

Artifacts that exist, all **session-scoped**: run ledger (`.groundwork/runs/<sid>.json`), SessionStart "RESUME HERE" block, per-session goal files, handoff markdown, `xd://handoff_session`, `xd://set_goal`. Plus durable-but-passive files: `.groundwork/plans/`, `.groundwork/out-of-scope/`, `.groundwork/learnings/`.

Explicit anti-feature-tracking signals:
- `stop-gate.mjs:19-20` — *"SESSION-SCOPED… prevents cross-session leakage of stale runs"*.
- `docs/prds/interview/session-specific-goals.md:8` — *"All goals are session-specific. No project-level goals remain."*
- Ledger prune at 7d/inactive (`ledger-io.mjs:174-190`); new session → new path; foreign `session_id` ignored (`session-reminder.mjs:43-45,53`).

Net: **no feature-level identity, no multi-run history, no stable cross-session resume pointer.** Closest proxies are a plan file someone happens to re-read and a handoff doc that mentions "Active run state."

### P3 — axes today: `correctness · completeness · over_engineering`

From `agents-src/advisor.md:115-134` + `advisor-gate/SKILL.md:77-80`. Verdicts `APPROVE | GAPS | CORRECTION | STOP | PLAN`. qa is explicitly *"NOT itself a gate"* (`qa.md:10-13`); Stop-gate treats verifier as *"informational only"* (`stop-gate.mjs:262`); release requires only *slices terminal + advisor APPROVE* (`stop-gate.mjs:318-324`).

- **(a) "Is QA testing the right contract?"** → **No axis, no checklist item.** Advisor Stage 1 checks impl vs *stated requirements*, never that qa's scenarios match the contract (`advisor.md:70-73`).
- **(b) "Should we step back and re-plan/re-slice?"** → **No.** CORRECTION/GAPS resume *implementation*; no mandated re-interview/re-slice. *"Steer the plan in place; pivots get re-interviewed"* (`bootstrap-orchestrator.md:12`) is orchestrator prose, not an advisor rubric check.

---

## 3. External best practices (from Slices A, B, D)

### P1 — refine-before-code

| Source | Mechanism | Strength |
|---|---|---|
| **obra/superpowers** `brainstorming/SKILL.md` | `<HARD-GATE> Do NOT invoke any implementation skill, write any code… until you have presented a design and the user has approved it.` Applies *even to trivial*. Terminal state is `writing-plans` only. | **Strongest instructional** |
| **github/spec-kit** | `constitution → specify → clarify → plan → tasks → analyze → implement → converge`. `analyze` maps FR/SC↔tasks, flags zero-coverage + constitution MUST violations; **CRITICAL → "recommend resolving before implement."** Incomplete checklist → interactive STOP. | Strong process |
| **Fission-AI/OpenSpec** | `propose → REVIEW PLAN → apply → REVIEW CODE → archive`. `apply` blocks when `state:"blocked"` (missing artifacts). *"Agree on what to build before any code is written."* Anti-waterfall: *"fluid not rigid — no phase gates."* | Strong social + CLI state |
| **bmad-code-org/BMAD-METHOD** | 4-phase Analysis→Planning→Solutioning→Implementation; `bmad-check-implementation-readiness` PASS/CONCERNS/FAIL; solutioning required for multi-epic; `quick-dev` escape hatch. | Medium (track-adaptive) |
| **mattpocock/skills** | `grill-with-docs → to-spec → to-tickets → implement → code-review`. `grilling`: *"Do not act on it until I confirm we have reached a shared understanding."* Planning skills **user-invoked only** (model cannot skip-to-code by auto-firing them). | Process-strong, harness-weak |
| anthropics/skills, Aider, cursor-rules | None / style-only. | Weak |

**Universal truth (Slice B gap):** P1 is solved *in prose*, almost never *in hooks*. OpenSpec proudly rejects phase locks. Superpowers' HARD-GATE is the closest to mechanical, but still relies on agent compliance.

### P2 — cross-session feature resume

| Source | Resume unit & artifact | Durability |
|---|---|---|
| **OpenSpec** | `openspec/changes/<id>/{proposal,design,tasks,specs/**}` + `archive/` + optional **Stores** (dedicated planning repo, cross-repo/cross-team). `status --change <id>` → task checkboxes. | **Strongest** (survives any session death) |
| **spec-kit** | `specs/[###-name]/{spec,plan,tasks}.md`; `[X]` checkboxes; `converge` appends remaining work as new tasks; `complex-features` scopes implement per session. | Strong if committed |
| **mattpocock wayfinder** | Single `wayfinder:map` issue: Destination / Decisions-so-far / fog / out-of-scope + native blocked decision tickets; **≤1 ticket/session**; claim-before-work. | Strong (feature-scoped) |
| **BMAD** | `_bmad-output/`, `sprint-status.yaml`, `story-[slug].md`, `.memlog.md`, `project-context.md`; `bmad-correct-course` mid-sprint. | Strong (agile-native) |
| **superpowers** | Committed `plans/*.md` + git-ignored `.superpowers/sdd/<plan>/progress.md` ledger (anti-compaction). *"After compaction, trust the ledger and `git log`."* | Medium (ledger dies to `git clean -fdx`) |
| **Linear** | Project + Milestone + ProjectUpdate(health) + Issue graph + **AgentSession** (`status∈{pending,active,awaitingInput,complete,error,stale}`, `plan` JSON, `summary`, `workspaceDiff`) — models AI runs as children of durable issues. | Strong (cloud) |
| **MADR/Nygard/arc42** | Append-only immutable decisions with supersession links. | Strong (VCS) |
| **DAP** | `continue`/`restart`/`restartFrame`; `StackFrame` + `StoppedEvent.reason` — **mental model** for a resume program-counter. | n/a (metaphor) |

**Universal gap (Slice B):** *No surveyed peer has a first-class "active features" pointer at feature grain that survives both compaction AND clean checkouts.* Superpowers ledger is git-ignored scratch; Spec Kit/OpenSpec rely on checkbox archaeology. **This is solvable and worth owning.**

### P3 — gating depth

**(a) Right-contract QA:**
- **OpenSpec `verify`** splits **Completeness** (tasks+reqs) / **Correctness** (impl matches intent + scenario coverage) / **Coherence** (design followed); warns *"⚠ Scenario '…' has no test coverage."* Does not block archive.
- **spec-kit `checklist`** — *"Checklists are UNIT TESTS FOR REQUIREMENTS WRITING… NOT whether the implementation works."* Incomplete checklist → STOP implement.
- **mattpocock `code-review`** — two-axis **Spec ∥ Standards** in parallel sub-agents; *"Quote the spec line for each finding"*; *"Code that follows every standard but implements the wrong thing → Standards pass, Spec fail."* Never merge/rerank across axes.
- **superpowers** — per-task **spec-compliance AND quality** both required; *"requirements met ≠ tests pass."*

**(b) Step-back / re-plan:**
- **superpowers** BLOCKED → *"escalate to the human"* when plan itself wrong; finding↔plan conflict → *"ask which governs."*
- **spec-kit** `analyze` CRITICAL (pre-implement); `converge` gap-types `missing|partial|contradicts|unrequested`; `spec-of-specs` decompose when a phase is too large.
- **OpenSpec** `apply` pause on design issue → *"suggest updating artifacts"*; update-vs-new identity heuristic (*"same thing, refined" vs "different work"*).
- **BMAD** `correct-course`; readiness FAIL → stay in solutioning.

**Universal gap (Slice B):** *"Nobody surveyed cleanly separates advisor-style 're-plan now' from QA 'tests assert the wrong contract' as two distinct automated gates."* That separation is exactly what groundwork wants — and groundwork already has the advisor-gate + run-ledger machinery to host it.

---

## 4. Recommendations (concrete, file-level)

Each recommendation is independent and independently approvable. Files referenced are **source** files only (`agents-src/*.md`, `skills/groundwork/*/SKILL.md`, `hooks/*.mjs`) — never generated output.

### R1 (P1, **P0**) — A spec/plan soundness pre-gate before fan-out

**Problem:** Nothing verifies a plan/spec exists and is sound before `implement`/fan-out. The `planner` keyword route bypasses interview entirely.

**Change:**
1. **Sharpen the interview mandate & close the bypass.** In `skills/groundwork/use-groundwork/reference/routing-detail.md` + `CLAUDE.md` routing rows: any feature (≥1d OR ≥3 files OR ≥2 behaviors) MUST produce a `plan_ref` before fan-out. Make the `planner` route **emit a plan artifact and link it as `plan_ref`** rather than fanning out from memory (`keyword-router.mjs` hint + `agents-src/planner.md`).
2. **Promote `kind:plan` from metadata to gate.** In `hooks/stop-gate.mjs`: when a run ledger is active AND the task was classified non-trivial, require either (a) a `plan_ref` pointing at an existing file, or (b) ≥1 slice with `kind:plan`/`kind:design` in `complete`. Keep the trivial escape (`ultrawork`/`implement` trivial banner writes no ledger → fail-open unchanged).
3. **Borrow Superpowers' HARD-GATE language** into `agents-src/general-purpose.md` and `skills/groundwork/implement/SKILL.md`: a fenced `<HARD-GATE>` block forbidding creative implementation until a user-approved plan/spec is referenced — *for non-trivial work only* (preserve the trivial fast-path verbatim).
4. **Borrow spec-kit `analyze` as a new lightweight step** (optional, Tier 2): a read-only "plan soundness" check before fan-out that flags zero-coverage ACs, contradictions, untestable criteria. Host it in a new `skills/groundwork/plan-review/SKILL.md` OR fold into `vertical-slice`'s pre-decomposition step.

**Risk:** Low–medium. Stop-gate change is additive (only bites when a ledger already exists AND classification is non-trivial). HARD-GATE language must be scoped to non-trivial or it regresses the trivial fast-path. **Acceptance:** a non-trivial feature cannot reach fan-out without a `plan_ref`; the `planner` keyword route writes a plan file.

### R2 (P3a, **P1**) — Add a `contract_fitness` axis to advisor-gate

**Problem:** Gating never asks "is QA testing the right contract?"

**Change:** In `agents-src/advisor.md` (axes) + `skills/groundwork/advisor-gate/SKILL.md` (rubric) + `hooks/ledger.mjs` (`--axes-*` flags) + `hooks/stop-gate.mjs` (APPROVE threshold): add a fourth scored axis **`contract_fitness`** (0-3) defined as: *do the verification scenarios (qa/evidence/tests) actually exercise each acceptance criterion / spec requirement — not merely pass?* Borrow mattpocock's *"quote the spec line"* rule and OpenSpec's scenario-coverage warning. APPROVE requires `contract_fitness ≥ 2` when qa/verification was run; the axis is N/A (exempt) for pure-logic/config changes with no behavioral contract.

**Risk:** Low. Additive axis; existing APPROVE math extends trivially. Must define the N/A path so trivial/bug fixes aren't falsely blocked. **Acceptance:** advisor completion payload must list, per acceptance criterion, the scenario that exercised it (or mark uncovered).

### R3 (P3b, **P1**) — Add a `plan_soundness` axis + a `REPLAN` verdict

**Problem:** Gating never asks "should we step back and re-plan/re-slice?"

**Change:**
1. Add a fifth axis **`plan_soundness`** (0-3): *are the slices still the right decomposition given what we learned?* Triggers for low scores: scope contradicts spec (`converge` "contradicts"), repeated slice failure, discovered cross-slice coupling, ACs that no slice covers. (Borrow spec-kit gap-types + OpenSpec update-vs-new identity test.)
2. Add a **`REPLAN`** verdict to advisor (alongside APPROVE/GAPS/CORRECTION/STOP): a blocking mid-flight verdict that forces re-interview OR re-slice before more implement slices run. Wire `stop-gate.mjs` to treat `REPLAN` as non-terminal (like CORRECTION) but route the orchestrator back to `interview`/`vertical-slice` rather than to more `impl` waves.
3. Decide-gate escalation (already exists for architecture) gains a "slice decomposition" trigger.

**Risk:** Medium. New verdict type touches stop-gate routing logic + advisor prompt + ledger CLI. Highest-value, highest-differentiation change (no peer has it). **Acceptance:** advisor can return REPLAN; stop-gate does not release on REPLAN; orchestrator is routed to re-slice, not to more impl.

### R4 (P2, **P1**) — Feature-level ledger + `resume` skill

**Problem:** No durable feature identity; no cross-session resume pointer.

**Change:**
1. New artifact **`.groundwork/features/<slug>.json`** (schema below, from Slice D). One feature aggregates many session runs; outlives the 7d ledger prune; not session-keyed.
2. New **`skills/groundwork/resume/SKILL.md`** (+ mirror as a command where the host supports it): on `/resume [slug]`, read the feature ledger **first** (not the transcript/handoff) and reconstruct: goal + unmet ACs (completion contract); `negative_scope` (rails); `resume.slice_id`/`next_actions`/`blocked_reason` (program counter); open slices in wave order with `blocked_by`; `plan_ref`/`spec_ref`/`branch`/files; last `runs[]` row; recent `history`/`decisions`.
3. **Additive `feature_slug` field** on session run ledgers (`hooks/ledger.mjs` + `vertical-slice` schema); feature `runs[]` is the authoritative cross-session index.
4. **Reposition `handoff` as a renderer** of feature+resume (handoff-shaped `.md` projection), not a parallel source of truth. `goal` mirrors `feature.goal` when one active feature exists; feature wins on conflict.
5. Keep stop-gate **session-scoped** (don't leak); feature `gate.advisor` = whole-feature completion (goal AC check), distinct from per-run stop-gate.

**Feature ledger schema (`.groundwork/features/<slug>.json`, v1):**
```json
{
  "$schema": "groundwork.feature-ledger.v1",
  "version": 1, "slug": "<slug>", "id": "feat_<ULID>",
  "active": true,
  "status": "planned|started|paused|completed| canceled",        // Linear ProjectStatusType
  "health": "onTrack|atRisk|offTrack",                            // Linear ProjectUpdateHealthType
  "goal": "<one-line>",
  "acceptance_criteria": [{"id":"AC1","text":"…","status":"pending|met|waived"}],
  "negative_scope": ["…"],
  "plan_ref": "<path|null>", "spec_ref": "<path|null>",
  "branch": "<branch>", "adr_refs": ["…"],
  "milestones": [{"id":"M1","name":"…","target_date":null,"status":"…"}],
  "slices": [{"id":"F1","behavior":"…","wave":0,"milestone_id":"M1",
              "kind":"plan|diagnose|design|impl","status":"pending|in_progress|complete|skipped",
              "blocked_by":[],"acceptance":["…"],"files":["…"],
              "last_session_id":"…","completed_at":null}],
  "resume": {"pointer":"slice:F2","slice_id":"F2","milestone_id":"M1",
             "next_actions":["…"],"blocked_reason":null,"waiting_on":null,
             "updated_at":"…","updated_by_session":"…"},          // DAP continue/restartFrame metaphor
  "runs": [{"session_id":"…","run_path":".groundwork/runs/<sid>.json",
            "started_at":"…","ended_at":"…","brief":"…",
            "gate_advisor":"pending|APPROVE|…","slices_completed":["F1"]}],
  "history": [{"at":"…","session_id":"…","type":"created|status_update|slice_complete|…","summary":"…","ref":null}],
  "decisions": [{"at":"…","summary":"…","adr":null}],              // MADR/Nygard
  "links": {"linear_project_id":null,"linear_issue_ids":[],"github_issue":null,"github_prs":[],"handoffs":["…"]},
  "gate": {"advisor":"pending|APPROVE|…","last_verdict_at":null},
  "created_at":"…","updated_at":"…","created_by_session":"…"
}
```

**Invariants:** (1) exactly one of `resume.slice_id`→non-complete slice OR `status∈{completed,canceled}`; (2) session runs optionally carry `feature_slug`; (3) feature files are NOT pruned with session ledgers; `active:false` = soft-archive; (4) no secrets; (5) PRDs stay untracked per policy — `plan_ref` may point at gitignored paths.

**Risk:** Medium–high (largest new surface). New artifact, new skill, schema field on run ledger, optional SessionStart hook to surface active features. Mitigations: ship the artifact + skill first (no hook), add hook later; keep everything additive so session-only flow is unchanged. **Acceptance:** a feature paused in session A is resumable in session B from the JSON alone; run ledgers link back via `feature_slug`.

### R5 (P1, **Tier 2**) — `plan-review` step (spec-kit `analyze` analogue)

Folded into R1.4 above. Standalone only if R1's stop-gate promotion is rejected. Read-only cross-artifact coverage map (FR/SC/AC ↔ slices; zero-coverage ACs; untestable criteria; contradictions). New `skills/groundwork/plan-review/SKILL.md`.

---

## 5. Prioritization & sequencing

```
Tier 0 (cheapest, highest impact, pure prose + 1 hook tweak):
  R1 (P1 pre-gate: sharpen mandate + close planner bypass + promote kind:plan + HARD-GATE language)

Tier 1 (additive rubric + new artifact; medium effort):
  R2 (P3a contract_fitness axis)
  R3 (P3b plan_soundness axis + REPLAN verdict)
  R4 (P2 feature ledger + resume skill)   ← largest; can land after R2/R3

Tier 2 (optional polish):
  R5 (plan-review step)
  OpenSpec-style "update vs new" identity heuristic for feature ledgers
  Optional SessionStart hook surfacing active features
```

**Recommended shipping order:** R1 → R2 → R3 → R4 → (R5).

---

## 6. What stays the same (negative scope)

- **Session run ledger stays session-scoped** and stop-gate stays session-keyed (do NOT leak cross-session). Feature ledger is a *layer above*, not a replacement.
- **Trivial fast-path unchanged** — trivial/small-clear/docs/obvious-bug still go direct → advisor. All new gates are N/A or absent for trivial work.
- **No SaaS dependency** — Linear/GitHub bridges are optional `links.*`; core resume is file-native JSON.
- **Codex/non-hook hosts** keep advisory semantics; the new mechanics apply where hooks run.
- **Generated files untouched** — all edits land in `agents-src/`, `skills/groundwork/`, `hooks/`; `pnpm run generate:agents` + `pnpm run check` run before commit.

---

## 7. Risks & tradeoffs

| Risk | Mitigation |
|---|---|
| HARD-GATE language over-fires on trivial work and regresses velocity | Scope the fence to non-trivial classification; preserve trivial banner/fast-path verbatim |
| New axes (`contract_fitness`/`plan_soundness`) falsely block legitimate completions | Define N/A paths; axes are exempt when no behavioral contract / no re-slice question |
| `REPLAN` verdict creates stop-gate routing bugs | Treat as non-terminal like CORRECTION; route to interview/vertical-slice; add a unit test mirroring the CORRECTION path |
| Feature ledger diverges from run ledger (two sources of truth) | Run ledger is the execution grain; feature ledger is the durable index; `feature_slug` is the only join; handoff becomes a renderer |
| Scope creep into multi-user/cloud sync | Negative-scoped out; file-native only; `links.*` optional |
| Codegen drift | Always edit sources, regenerate, run `pnpm run check`; never hand-edit `agents*/` or `*.generated.ts` |

---

## 8. Open questions for the user

1. **P1 depth:** Adopt Superpowers HARD-GATE verbatim-style (forbids *any* creative impl until user-approved plan) — or the softer spec-kit `analyze`-CRITICAL-recommend approach? (R1)
2. **P1 mechanics:** Promote `kind:plan` to a real stop-gate requirement, or keep it advisory + rely on HARD-GATE prose? (R1.2)
3. **P3 verdict:** Add `REPLAN` as a first-class verdict (R3), or express re-plan need via existing `STOP` + a new axis only?
4. **P2 scope:** Ship feature ledger + `resume` skill as a pure-skill layer first (no hook), or include a SessionStart "active features" surfacing hook in the first cut? (R4)
5. **P2 path:** `.groundwork/features/<slug>.json` (Slice D proposal) — or mirror spec-kit's markdown-directory shape (`features/<slug>/{spec,plan,tasks}.md`) for human readability? (JSON machine-authoritative vs markdown human-authoritative.)

---

## 9. Source index

- **Slice A** `local://sliceA-mattpocock.md` — mattpocock/skills deep dive (repo anatomy, main flow `grill→to-spec→to-tickets→implement→code-review`, wayfinder, two-axis code-review, grilling "do not act").
- **Slice B** `local://sliceB-external.md` — github/spec-kit, Fission-AI/OpenSpec, obra/superpowers, bmad-code-org/BMAD-METHOD, anthropics/skills, awesome-cursorrules, Aider.
- **Slice C** `local://sliceC-groundwork.md` — current-state gap map with `path:lines` for every assertion.
- **Slice D** `local://sliceD-resumption.md` — Linear/GitHub/Spec Kit/Kiro/MADR/DAP/gh-stack resumption patterns + the `.groundwork/features/<slug>.json` proposal + field provenance.

External primary sources (selected): github.com/github/spec-kit · github.com/Fission-AI/OpenSpec · github.com/obra/superpowers · github.com/bmad-code-org/BMAD-METHOD · github.com/mattpocock/skills · linear.app/docs · kiro.dev/docs/specs · madr template · microsoft debug-adapter-protocol.

---

*End of research synthesis. Implementation is gated on user approval of R1–R5 (per item).*
