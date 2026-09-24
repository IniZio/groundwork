---
name: housekeep
description: Regression-safe codebase hygiene — deslop (default), deps, lint-debt, docs-staleness; also runs house-rules to fix automated rule violations. Triggers on: deslop, anti-slop, ai slop, cleanup, tidy, housekeep, fix violations, house-rules fix.
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

## Automated rule-violation fixing

For findings already tracked by house-rules, run:

```
house-rules housekeep
```

Default scope: files changed since merge-base with the default branch (same as `house-rules check`).

Common invocations:
- **Branch-only (default):** `house-rules housekeep`
- **Burn down baseline debt:** `house-rules housekeep --baseline --paths 'src/api/**' --max 20`
- **Preview without writing:** `house-rules housekeep --dry-run`

Flags:
- `--rules <a,b>` — limit to specific rule IDs
- `--paths <glob,...>` — restrict to files matching glob(s)
- `--since <ref>` — override the base git ref
- `--baseline` — target entries recorded in `.house-rules/baseline.json` instead of the diff scope
- `--max <n>` — cap the number of auto-fixes applied
- `--dry-run` — show what would be fixed without writing

After `--baseline` runs, fixed entries are automatically pruned from the baseline file.
Untracked scratch files are reported under "Untracked strays (not blocking)" but do not affect exit code.

## Completion

`groundwork:advisor` gate returns APPROVE and the cleanup report is presented to the user. REVISE or REJECT blocks completion.
