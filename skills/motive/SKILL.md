---
name: motive
description: Author a motive charter — persistent intent doc with objective, decisions, and open questions.
---

<!-- token-target: ≤407 (v1 motive skill was 1220 tokens; 1/3 = 407) -->

## What a motive is

Durable record of intent for a significant effort.
Lives at `.groundwork/motives/<slug>/motive.md`. Survives session boundaries.
Grounding for advisor and reviewer to verify work stayed on course.

## Charter structure

```markdown
---
id: <slug>
title: <one line>
status: active | complete | abandoned
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

1. Use `mattpocock-skills:grilling` to capture intent if the objective is unclear.
2. Write the charter at `.groundwork/motives/<slug>/motive.md`.
3. Run `$GW init` to create the work store.
4. Tell user to run `/to-tickets` (or `/wayfinder` for large work) to decompose into tickets.
   Load `/vertical-slice` yourself without asking — no confirmation prompt.

## Recording decisions

```
$GW event append --type DECISION --msg "<decision statement>" --data '{"rationale":"..."}' --token T
```

## Upstream coverage

Interview: `mattpocock-skills:grilling`. Decomposition: user runs `/to-tickets` or `/wayfinder`.
Both are upstream; this skill adds the persistent `.groundwork/` charter and gw event log.
