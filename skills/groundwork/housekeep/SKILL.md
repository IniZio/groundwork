---
name: housekeep
description: Regression-safe, deletion-first codebase hygiene. Default mode `deslop` removes AI slop (dead code, duplication, needless abstraction, boundary violations, missing tests, UI/design defaults). Opt-in modes `deps`, `lint-debt`, `docs-staleness` for dependency audits, lint/type-debt cleanup, and stale doc sweeps. Triggers: housekeep, deslop, cleanup, tidy, code hygiene, anti-slop, AI slop, dependency audit, lint debt, stale docs.
---

# Housekeep

Regression-safe, deletion-first codebase hygiene. The default mode (`deslop`) removes AI-generated slop without drifting scope or changing intended behavior. Three opt-in modes cover dependency audits, accumulated lint/type-debt, and stale docs.

## Glossary

Use these terms exactly in all cleanup plans and reports.

- **Slop** — code that works but is bloated, repetitive, weakly tested, or over-abstracted; the residue of unreviewed AI-generated patches
- **Smell** — a concrete, classifiable hygiene problem (one of six categories in `deslop` mode)
- **Behavior lock** — a regression test (added or confirmed) that pins down behavior BEFORE cleanup edits begin
- **Pass** — one smell-focused edit cycle; each pass re-runs verification before the next begins
- **Deletion-first** — prefer removing code over adding code; consolidation before introduction; reuse before new deps

## Mode selection

| User says / arg | Mode | Reference to load |
|---|---|---|
| `housekeep`, `deslop`, `ai slop`, `cleanup the slop` (no arg / default) | `deslop` | none — workflow is inline below |
| `housekeep deps`, `dependency hygiene`, `audit deps` | `deps` | `reference/deps.md` |
| `housekeep lint-debt`, `lint debt`, `type debt`, `cleanup suppressions` | `lint-debt` | `reference/lint-debt.md` |
| `housekeep docs`, `stale docs`, `dead comments` | `docs-staleness` | `reference/docs-staleness.md` |
| `housekeep all` | all four | load all three reference files sequentially |

**Progressive-disclosure rule:** Load ONLY the reference file for the selected mode. Do not load non-default mode detail unless that mode is selected. The shared posture, completion gate, and context-budget rules below apply to every mode.

## When to Use

- The user explicitly says `deslop`, `anti-slop`, `AI slop`, `housekeep`, `tidy`, or `cleanup`
- A feature landed and left bloat: duplicate logic, dead code, wrapper layers, boundary leaks, weak tests
- Between tasks: sweep residual slop before it compounds
- The goal is simplification and hygiene, not new feature delivery

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

This workflow is inline because `deslop` is the default mode. The other modes point to their own `reference/*.md` passes.

### Step 1 — Protect current behavior first

- Identify what must stay the same.
- Add or run the narrowest regression tests needed before editing.
- If tests cannot come first, record the verification plan explicitly before touching code.

### Step 2 — Write a cleanup plan before code

- Bound the pass to the requested files or feature area.
- List the concrete smells to remove (use the six categories below).
- Order the work from safest deletion to riskier consolidation.

### Step 3 — Classify the slop before editing

| Smell | Definition |
|---|---|
| **Duplication** | Repeated logic, copy-paste branches, redundant helpers |
| **Dead code** | Unused code, unreachable branches, stale flags, debug leftovers |
| **Needless abstraction** | Pass-through wrappers, speculative indirection, single-use helper layers |
| **Boundary violations** | Hidden coupling, misplaced responsibilities, wrong-layer imports or side effects |
| **Missing tests** | Behavior not locked, weak regression coverage, edge-case gaps |
| **UI/design defaults** | Generic visual patterns that make an AI-built interface feel unreviewed |

### Step 4 — Run one smell-focused pass at a time

- **Pass 1: Dead code deletion**
- **Pass 2: Duplicate removal**
- **Pass 3: Naming and error-handling cleanup**
- **Pass 4: Test reinforcement**
- Re-run targeted verification after EACH pass.
- Do not bundle unrelated refactors into the same edit set.

### Step 5 — Run the quality gates

- Keep regression tests green.
- Run the relevant lint, typecheck, and unit/integration tests for the touched area.
- Run existing static or security checks when available.
- If a gate fails, fix the issue or back out the risky cleanup. Never force a cleanup through a failing gate.

### Step 6 — Close with an evidence-dense report

Always report:
- **Changed files**
- **Simplifications**
- **Behavior lock / verification run**
- **Remaining risks**

## UI/design reviewer checklist

Use these as review prompts, not absolute bans. Keep intentional brand, accessibility, product-density, or design-system choices when they have a clear rationale.

- **Shadow restraint:** question box shadows on every surface, logo, background, card, or icon; keep shadows only where they clarify elevation or interaction.
- **Content hierarchy:** remove repetitive eyebrow/title/description/extra `<p>` stuffing when the title already carries the message; avoid generic emoji badges unless they are part of the product voice.
- **Palette rationale:** challenge default AI blue/purple palettes, especially Tailwind-like `#3B82F6`, when no brand or system rationale exists.
- **Layout rhythm:** avoid overly perfect uniform grids when the product context benefits from rhythm, emphasis, asymmetry, carousel/bento treatment, or varied card weights.
- **Gradient restraint:** tone down extreme gradients unless the brand deliberately owns that visual language.

## Scoped file-list usage

This skill can be bounded to an explicit file list or changed-file scope when the caller already knows the safe cleanup surface.

- Good fit: `housekeep src/auth/ src/models/`
- Good fit: a parent session handing off only the files changed in that session
- Preserve the regression-safe workflow even on a short file list.
- Do not silently expand a changed-file scope unless the user explicitly asks.

## Non-deslop modes

For `deps`, `lint-debt`, or `docs-staleness` modes, load the matching `reference/<mode>.md`. Those files carry the mode-specific smells, passes, and tooling. The shared posture, execution rules, context-budget rules, and completion gate in this file apply to all modes.

## Context budget rules

These are mandatory, not advisory:

1. Collect findings via `Explore` subagents when scanning a large area — do not read raw files into main context to hunt for smells.
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

**Interactive surfaces:** if the change touches an interactive UI or CLI surface, run `qa` (live verification) BEFORE `critic`. Otherwise go straight `critic` → `advisor-gate`.

## What NOT to Do

- Do not change behavior unless the user explicitly asks for behavior changes.
- Do not bundle unrelated refactors into one pass.
- Do not introduce new dependencies during a cleanup pass.
- Do not skip regression tests before editing — lock behavior first.
- Do not silently expand a changed-file scope into broader cleanup.
- Do not force a cleanup through when a quality gate fails — back it out.
- Do not run sequential grep calls when one `ctx_batch_execute` covers discovery.
- Do not skip `advisor-gate` — every housekeep run ends at the gate.
