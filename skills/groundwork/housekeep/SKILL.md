---
name: housekeep
description: Remove AI-generated slop and hygiene debt — deslop (default), deps, lint-debt, docs-staleness, learnings-staleness. Triggers on: deslop, anti-slop, ai slop, cleanup, tidy, housekeep.
disable-model-invocation: true
---

# Housekeep

Regression-safe, deletion-first codebase hygiene. Five modes: `deslop` (default), `deps`, `lint-debt`, `docs-staleness`, `learnings-staleness`. Every mode follows the same scan → score → triage → cleanup → report spine.

## Named failure mode: Addition default

**Failure:** when cleaning code, the default impulse is to add — a new helper, a new abstraction, a new test harness. Each addition accumulates the slop it was meant to cure.

**Correction:** prefer removing code over adding it. Consolidate before introducing utilities. Reuse before adding deps. Each pass asks "can I remove this?" before asking "what should replace it?"

## Glossary

- **Slop** — code that works but is bloated, repetitive, weakly tested, or over-abstracted
- **Smell** — a concrete, classifiable hygiene problem; each mode has its own catalog
- **Finding** — one smell instance: id (F1, F2…), severity, category, location, suggested action
- **Severity** — SEV1 (correctness/safety), SEV2 (intent-masking/latent risk), SEV3 (maintainability), SEV4 (cosmetic); rubric: consequence × blast-radius, context bumps ±1
- **Backlog** — severity-sorted Finding table presented at triage before any edits
- **Triage** — mandatory user gate: Accept (clean this pass), Defer (record, skip now), Skip (record, skip); only accepted Findings proceed
- **Behavior lock** — regression test added or confirmed before any cleanup edits begin
- **Pass** — one smell-focused edit cycle; verification runs after each pass

## Shared backlog format

Every mode uses this schema, sorted SEV1 first:

| id | severity | category | location | finding | suggested action | effort |
|---|---|---|---|---|---|---|
| F1 | SEV2 | Dead code | `src/auth/session.ts:44` | `refreshTokenLegacy()` never called | Delete function | S |

**Effort:** S = <30 min, M = 30–90 min, L = >90 min. Collect every smell as a Finding during scan — never fix in place.

## Mode selection

| User says | Mode | Load |
|---|---|---|
| `housekeep` / `deslop` / `ai slop` / `cleanup the slop` | `deslop` | `reference/deslop.md` |
| `housekeep deps` / `dependency hygiene` / `audit deps` | `deps` | `reference/deps.md` |
| `housekeep lint-debt` / `lint debt` / `type debt` / `cleanup suppressions` | `lint-debt` | `reference/lint-debt.md` |
| `housekeep docs` / `stale docs` / `dead comments` | `docs-staleness` | `reference/docs-staleness.md` |
| `housekeep learnings` / `stale learnings` / `revalidate learnings` | `learnings-staleness` | `reference/learnings-staleness.md` |
| `housekeep all` | all five | load all four non-deslop reference files after deslop |

Load only the reference file for the selected mode. Shared posture, context budget, and completion below apply to all modes. Each reference file maps its smells onto the SEV1–SEV4 tiers above.

## When to use

- User says `deslop`, `anti-slop`, `AI slop`, `housekeep`, `tidy`, or `cleanup`
- Feature landed and left bloat: duplicate logic, dead code, wrapper layers, weak tests
- Between tasks: sweep residual slop before it compounds

## When NOT to use

- New feature build → `implement`
- Bug with root-cause analysis → `diagnose`
- Architecture refactor or coupling redesign → `arch-review`
- Behavior too unclear to lock with regression tests

## Execution posture

Preserve behavior; lock it with regression tests before editing. Write a cleanup plan before touching code. Keep diffs small, reversible, smell-focused. Never expand a scoped surface silently.

When the target area is large, fan out `Explore` subagents for the scan; collect findings via task return values; delegate cleanup edits to `general-purpose`. In leaf context (no `task` available), use `ctx_batch_execute` / `ctx_execute_file` — never raw `Read` into context to hunt smells.

## Context budget

- Scan via `Explore` subagents or `ctx_batch_execute` — never raw file reads into context
- `ctx_batch_execute` for file-count and structural analysis — never sequential grep calls
- Cleanup report is the full artifact; in-context summary to the user ≤12 lines
- No files created in the repo for the report (temp dir only)
- Load only the reference file for the selected mode

## Completion

Advisor-gate returns APPROVE and the cleanup report is presented to the user. REVISE or REJECT blocks completion: address flagged risks and re-run the workflow. For interactive UI/CLI surfaces, run `qa` first, then `advisor-gate`.
