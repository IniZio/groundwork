---
name: motive
description: Author a motive charter — persistent intent doc with objective, decisions, and open questions.
---

<!-- token-target: ≤407 -->

## What a motive is

Durable record of intent for a significant effort.
Lives at `.groundwork/work/<slug>/motive.md`. Survives session boundaries.
Grounding for advisor and reviewer to verify work stayed on course.

## Charter structure

```markdown
---
created: YYYY-MM-DD
status: active
---
# <title>

## Objective
<1-3 sentences: what success looks like>

## Decisions
<!-- DECISION events appended here by gw event append -->

## Open questions
<!-- Questions to resolve before proceeding -->
```

## Authoring steps

1. Call the Skill tool with `mattpocock-skills:grilling` to capture intent if the objective is unclear.
2. Write the charter at `.groundwork/work/<slug>/motive.md`.
3. Run `$GW event append --type OBJECTIVE --msg "<motive.md Objective text>" --token T`, then `$GW compile`; confirm `objective:` matches.
4. Create `.groundwork/work/<slug>/spec.md`; set `folds_into:` to a living spec path
   like `doc/spec/<area>.md`, or `none` plus a `reason:` line.
5. Write the PR body draft `.groundwork/work/<slug>/pr-body.md` (What changed only) from
   `templates/doc-types/pr-body.md`. No `doc/<slug>/` folder.
   Spawn `groundwork:human-doc-reviewer` with only that path + check cmd
   `bun <root>/src/review/human-doc-check.ts <file>` (`<root>` = dir holding `src/cli/main.ts` from `$GW`).
   Apply deletions; re-run until `status: PASS`.
   Charter approval binds `motive.md` plus the draft's What changed; filling Evidence or Residual risk later does not void it.
6. Run `$GW init` to create the work store.
7. Tell user to run `/to-tickets` (or `/wayfinder` for large work) to decompose into tickets.
   Call the Skill tool with `groundwork:vertical-slice` yourself without asking — no confirmation prompt.

## Recording decisions

```
$GW event append --type DECISION --msg "<decision statement>" --data '{"rationale":"..."}' --token T
```

## Upstream coverage

Interview: `mattpocock-skills:grilling`. Decomposition: user runs `/to-tickets` or `/wayfinder`.
Both are upstream; this skill adds the persistent `.groundwork/` charter and gw event log.
