---
name: housekeep
description: Regression-safe, deletion-first codebase hygiene — deslop (default), deps, lint-debt, docs-staleness. Triggers on: deslop, anti-slop, ai slop, cleanup, tidy, housekeep.
disable-model-invocation: true
---

<!-- token-target: ≤500 (v1 was ~1500 tokens; 1/3 = 500) -->

## Named failure mode: addition default

Cleaning code defaults to adding. Each new helper accumulates the slop it was meant to cure.
Prefer removing over adding. Consolidate before introducing utilities.
Ask "can I remove this?" before asking "what should replace it?"

## Glossary

- **Slop** — code that works but is bloated, repetitive, weakly tested, or over-abstracted
- **Finding** — one smell instance: id (F1, F2…), severity, category, location, suggested action
- **Severity** — SEV1 (correctness/safety), SEV2 (intent-masking/latent risk), SEV3 (maintainability), SEV4 (cosmetic)
- **Triage** — mandatory user gate: Accept / Defer / Skip; only accepted Findings proceed

## Shared backlog format

| id | severity | category | location | finding | suggested action | effort |
|---|---|---|---|---|---|---|
| F1 | SEV2 | Dead code | `src/auth/session.ts:44` | `refreshTokenLegacy()` never called | Delete function | S |

**Effort:** S = <30 min, M = 30–90 min, L = >90 min. Collect every smell as a Finding during scan — never fix in place.

## Mode selection

| User says | Mode | Load |
|---|---|---|
| `housekeep` / `deslop` / `ai slop` / `cleanup` | `deslop` | `reference/deslop.md` |
| `housekeep deps` / `dependency hygiene` / `audit deps` | `deps` | `reference/deps.md` |
| `housekeep lint-debt` / `lint debt` / `cleanup suppressions` | `lint-debt` | `reference/lint-debt.md` |
| `housekeep docs` / `stale docs` / `dead comments` | `docs-staleness` | `reference/docs-staleness.md` |
| `housekeep all` | all four | load all reference files after deslop |

Load only the reference file for the selected mode.

## Execution posture

Lock behavior with regression tests before editing. Write a cleanup plan before touching code.
Keep diffs small, reversible, smell-focused. Never expand a scoped surface silently.

For large surfaces, fan out `groundwork:explore` subagents for scan; `groundwork:implementer` for cleanup.
Collect findings via return values before any edits begin.

## Completion

`groundwork:advisor` gate returns APPROVE and the cleanup report is presented to the user. REVISE or REJECT blocks completion.
