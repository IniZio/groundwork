---
name: housekeep
description: Deletion-first codebase hygiene — deslop (default), deps, lint-debt, docs-staleness, and learnings-staleness modes. Triggers on: deslop, anti-slop, ai slop, cleanup, tidy, housekeep.
disable-model-invocation: true
---

# Housekeep

Regression-safe, deletion-first codebase hygiene. The default mode (`deslop`) removes AI-generated slop without drifting scope or changing intended behavior. Four opt-in modes cover dependency audits, accumulated lint/type-debt, stale docs, and stale promoted learnings.

## Glossary

Use these terms exactly in all cleanup plans and reports.

- **Slop** — code that works but is bloated, repetitive, weakly tested, or over-abstracted; the residue of unreviewed AI-generated patches
- **Smell** — a concrete, classifiable hygiene problem (one of seven categories in `deslop` mode; each mode has its own catalog)
- **Finding** — one identified smell instance, assigned an id (F1, F2…), severity tier, location, and suggested action; the atomic unit of the backlog
- **Severity** — a 4-tier rating (SEV1–SEV4) that drives triage priority; derived from the rubric (consequence × blast-radius), not the smell category alone. Tiers:
  - **SEV1** — correctness / safety; do first
  - **SEV2** — intent-masking / latent risk
  - **SEV3** — maintainability
  - **SEV4** — cosmetic
- **Backlog** — the complete, severity-sorted table of Findings collected during the scan; presented to the user at the triage gate before any edits
- **Triage** — the interactive step where the user reviews the backlog and selects which Findings to clean; only selected Findings proceed to cleanup
- **Behavior lock** — a regression test (added or confirmed) that pins down behavior BEFORE cleanup edits begin
- **Pass** — one smell-focused edit cycle; each pass re-runs verification before the next begins
- **Deletion-first** — prefer removing code over adding code; consolidation before introduction; reuse before new deps

## Severity model

**Rubric:** `severity = consequence-if-left-uncleaned × blast-radius`. The smell category gives a DEFAULT tier; context can bump it **one tier** up or down:
- Bump UP: the smell lives on a critical path, shared/public surface, or security boundary
- Bump DOWN: the smell is isolated, covered by tests, or in a rarely-touched module

These are defaults the rubric can adjust — not a rigid lookup.

| Tier | Label | Default smell categories |
|---|---|---|
| SEV1 | Correctness / safety | Boundary violations on a critical path; Missing tests on a critical path |
| SEV2 | Intent-masking / latent risk | Dead code that masks intent; Needless abstraction that blurs boundaries. (Also where type-safety erosion lands for `lint-debt` mode.) |
| SEV3 | Maintainability | Duplication; Naming / error-handling issues |
| SEV4 | Cosmetic | Redundant comments; UI/design defaults |

## Shared findings backlog format

Every mode uses this table schema. The backlog is grouped and sorted by severity (SEV1 first).

| id | severity | category | location | finding | suggested action | effort |
|---|---|---|---|---|---|---|
| F1 | SEV2 | Dead code | `src/auth/session.ts:44` | `refreshTokenLegacy()` never called after migration | Delete function | S |
| F2 | SEV3 | Duplication | `src/api/users.ts:12`, `src/api/orders.ts:18` | Identical `paginateQuery` helper copied in two files | Extract to `src/lib/paginate.ts` | M |
| F3 | SEV1 | Boundary violations | `src/ui/UserCard.tsx:88` | Direct DB import in component bypasses service layer | Move query to `UserService` | L |

**Effort key:** S = <30 min, M = 30–90 min, L = >90 min.

Collect EVERY smell as a Finding during the scan — do not fix in place. Assemble the full backlog before presenting it.

## Mode selection

| User says / arg | Mode | Reference to load |
|---|---|---|
| `housekeep`, `deslop`, `ai slop`, `cleanup the slop` (no arg / default) | `deslop` | none — workflow is inline below |
| `housekeep deps`, `dependency hygiene`, `audit deps` | `deps` | `reference/deps.md` |
| `housekeep lint-debt`, `lint debt`, `type debt`, `cleanup suppressions` | `lint-debt` | `reference/lint-debt.md` |
| `housekeep docs`, `stale docs`, `dead comments` | `docs-staleness` | `reference/docs-staleness.md` |
| `housekeep learnings`, `stale learnings`, `revalidate learnings` | `learnings-staleness` | `reference/learnings-staleness.md` |
| `housekeep all` | all five | load all four reference files sequentially |

**Progressive-disclosure rule:** Load ONLY the reference file for the selected mode. Do not load non-default mode detail unless that mode is selected. The shared posture, completion gate, and context-budget rules below apply to every mode.

**All four modes share the same scan → score → triage → report phases.** Only the smell catalog and passes differ per mode; each reference file provides its own smell→severity mapping using the same SEV1–SEV4 tiers.

## When to Use

- The user explicitly says `deslop`, `anti-slop`, `AI slop`, `housekeep`, `tidy`, or `cleanup`
- A feature landed and left bloat: duplicate logic, dead code, wrapper layers, boundary leaks, weak tests
- Between tasks: sweep residual slop before it compounds
- The goal is simplification and hygiene, not new feature delivery

`housekeep` is orchestrator-run. When the target area is large, the orchestrator fans out `Explore` subagents for the smell scan and collects findings via Task return values; cleanup edits are then delegated to `general-purpose` agents. (If the skill is loaded by a delegated leaf subagent, use the fallback tools noted in "Context budget rules" below.)

## When NOT to Use

- The task is a new feature build or product change → use `implement`
- A bug needs root-cause analysis → use `diagnose`
- A broad architecture refactor or coupling redesign → use `arch-review`
- Behavior is too unclear to lock with regression tests or a concrete verification plan

## Execution posture

- Preserve behavior unless the user explicitly asks for behavior changes.
- Lock behavior with focused regression tests FIRST, whenever practical.
- Write a cleanup plan before editing code.
- Prefer deletion over addition; consolidate before introducing new utilities; reuse existing patterns before adding deps.
- Avoid new dependencies unless the user explicitly requests them.
- Keep diffs small, reversible, and smell-focused.
- Stay evidence-dense: inspect, edit, verify, report.
- Treat new user instructions as local scope updates without dropping earlier non-conflicting constraints.
- Do NOT silently expand a changed-file scope into broader cleanup work.

## Process — the deslop workflow

This workflow is inline because `deslop` is the default mode. The other modes point to their own `reference/*.md` passes but follow the same 8-step spine.

### Step 1 — Protect current behavior (behavior lock)

- Identify what must stay the same.
- Add or run the narrowest regression tests needed before editing.
- If tests cannot come first, record the verification plan explicitly before touching code.

### Step 2 — Scan & inventory

Sweep the scoped surface. Collect EVERY smell instance as a Finding — do not fix in place. Use the seven deslop categories below to recognize smells.

| Smell | Definition |
|---|---|
| **Duplication** | Repeated logic, copy-paste branches, redundant helpers |
| **Dead code** | Unused code, unreachable branches, stale flags, debug leftovers |
| **Needless abstraction** | Pass-through wrappers, speculative indirection, single-use helper layers |
| **Boundary violations** | Hidden coupling, misplaced responsibilities, wrong-layer imports or side effects |
| **Missing tests** | Behavior not locked, weak regression coverage, edge-case gaps |
| **UI/design defaults** | Generic visual patterns that make an AI-built interface feel unreviewed |
| **Redundant comments** | Narration (`// Let's...`, `// Now we...`), step markers (`// Step 1`), restatements of obvious code (`// increment counter` above `count++`), section-divider banners, apologetic/hedging filler. **Keep:** non-obvious *why* rationale, invariants/constraints, warnings/gotchas, issue/spec links, public API doc-comments |

### Step 3 — Classify & score by severity

Map each Finding to its smell category, then apply the severity rubric (consequence × blast-radius; context bumps ±1). Assemble the full backlog table sorted SEV1 → SEV4. Do not begin edits yet.

### Step 4 — Triage gate (user selection — mandatory)

Present the prioritized backlog to the user, grouped by severity (SEV1 first). The user selects which Findings to clean:

- **Accept** — include in the cleanup pass
- **Defer** — record in the report; do not action now
- **Skip** — record in the report; do not action

ONLY user-selected (accepted) Findings enter the cleanup pass. Deferred and skipped Findings are recorded in the final report's Deferred/Skipped Backlog slot — never silently dropped and never silently expanded. This gate happens BEFORE any cleanup edits.

### Step 5 — Cleanup plan for selected findings

Bound the plan to accepted Findings only. Order the work from safest deletion to riskier consolidation.

### Step 6 — Run one smell-focused pass at a time

- **Pass 1: Dead code deletion**
- **Pass 2: Duplicate removal**
- **Pass 3: Naming and error-handling cleanup**
- **Pass 4: Comment cleanup** — remove narration, step markers, restatements; keep *why*, invariants, gotchas, doc-comments (see the Redundant comments smell above; `hooks/deslop-guard.mjs` flags some patterns at write-time as an advisory signal)
- **Pass 5: Test reinforcement**
- Re-run targeted verification after EACH pass.
- Do not bundle unrelated refactors into the same edit set.
- If a pass finds no violations after an evidence-based scan, record the empty finding (which area was scanned, why nothing qualified) and proceed to the next pass. Do NOT manufacture deletions or changes to justify a pass. A clean pass is a valid result.

### Step 7 — Run quality gates

- Keep regression tests green.
- Run the relevant lint, typecheck, and unit/integration tests for the touched area.
- Run existing static or security checks when available.
- If a gate fails, fix the issue or back out the risky cleanup. Never force a cleanup through a failing gate.

### Step 8 — Close with the structured report

Use this template exactly. Present it as the final deliverable.

````
## Housekeep Report

**Scope:** <files / directories covered>

**Behavior Lock:**
- <test(s) added or confirmed; or verification plan if tests could not come first>

**Triaged Backlog:**
- SEV1: <n> findings | SEV2: <n> | SEV3: <n> | SEV4: <n> | Total: <n>
- Accepted: <n> | Deferred: <n> | Skipped: <n>

**Selected For Cleanup:** <list of accepted Finding ids>

**Passes Completed:**
- Pass 1 (Dead code): <concise summary or "nothing qualified">
- Pass 2 (Duplication): <concise summary or "nothing qualified">
- Pass 3 (Naming/error-handling): <concise summary or "nothing qualified">
- Pass 4 (Comments): <concise summary or "nothing qualified">
- Pass 5 (Tests): <concise summary or "nothing qualified">

**Quality Gates:**
- Regression tests: PASS / FAIL
- Lint: PASS / FAIL
- Typecheck: PASS / FAIL
- Other: <gate name>: PASS / FAIL

**Changed Files:**
| file | simplification |
|---|---|
| <path> | <one-line description of what was removed/simplified> |

**Deferred/Skipped Backlog:**
| id | severity | finding | disposition | reason |
|---|---|---|---|---|
| <Fn> | <SEVn> | <finding> | Deferred / Skipped | <user-stated reason or "no reason given"> |

**Remaining Risks:** <known gaps, untested edges, deferred SEV1/2 items, scope not covered>
````

## UI/design reviewer checklist

The 5-item UI/design checklist lives in `reference/ui-checklist.md`. Load it ONLY when the target has a rendered UI/CLI surface; otherwise skip — it is dead weight on backend-only cleanups.

## Scoped file-list usage

This skill can be bounded to an explicit file list or changed-file scope when the caller already knows the safe cleanup surface.

- Good fit: `housekeep src/auth/ src/models/`
- Good fit: a parent session handing off only the files changed in that session
- Preserve the regression-safe workflow even on a short file list.
- Do not silently expand a changed-file scope unless the user explicitly asks.

## Non-deslop modes

For `deps`, `lint-debt`, `docs-staleness`, or `learnings-staleness` modes, load the matching `reference/<mode>.md`. Those files carry the mode-specific smells, passes, and tooling. The shared posture, execution rules, context-budget rules, and completion gate in this file apply to all modes. Each reference file maps its mode-specific smells onto the SEV1–SEV4 tiers defined above.

## Context budget rules

These are mandatory, not advisory:

1. Collect findings via `Explore` subagents when scanning a large area (orchestrator context) — do not read raw files into main context to hunt for smells. If `Explore` subagents cannot be spawned (leaf-subagent context where `task` is unavailable), fall back to `ctx_batch_execute` for structural scans, `ctx_execute` for computations, and `ctx_execute_file` for targeted file reads — NEVER `Read` raw files into context to hunt for smells. The philosophy is unchanged either way: raw exploration output stays out of context.
2. Use `ctx_batch_execute` for any file-count or structural analysis — never sequential grep calls.
3. The cleanup report is the full artifact; keep your in-context summary to the user ≤12 lines.
4. No files created in the repo for the report — temp dir only if an artifact is needed.
5. Load ONLY the reference file for the selected mode.

## Completion gate

After the cleanup report, invoke `advisor-gate` with:
- Changed-file count
- Behavior-lock evidence (which tests were added/run)
- Verification run results (lint/typecheck/tests)
- Remaining risks

`advisor-gate` response governs:
- **APPROVE** → present the cleanup report to the user
- **REVISE** → address the flagged risks (un-removed smell, weakened test, scope creep) and re-run the workflow
- **REJECT** → back out the risky cleanup and re-plan with a narrower scope

**Interactive surfaces:** if the change touches an interactive UI or CLI surface, run `qa` (live verification) first. Otherwise go straight to `advisor-gate`.

`advisor` satisfies the writer/reviewer separation that a dedicated `--review` mode would provide: it is an independent reviewer that inspects the cleanup plan, changed files, and verification evidence, and never both edits and approves in the same pass.

## What NOT to Do

- Do not change behavior unless the user explicitly asks for behavior changes.
- Do not bundle unrelated refactors into one pass.
- Do not introduce new dependencies during a cleanup pass.
- Do not skip regression tests before editing — lock behavior first.
- Do not silently expand a changed-file scope into broader cleanup.
- Do not force a cleanup through when a quality gate fails — back it out.
- Do not run sequential grep calls when one `ctx_batch_execute` covers discovery.
- Do not skip `advisor-gate` — every housekeep run ends at the gate.
- Do not begin edits before the triage gate — the user must select Findings first.
- Do not silently drop deferred or skipped Findings — record them in the report.
