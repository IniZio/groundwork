---
tags: [moc, verification, design]
---

# Verification — Design

Map of Content for the **Verification** design folder. Start here; follow the reading path below.

## Start here: reading path

```
1. concepts/stop-gate       — what the stop gate is and what it guarantees
2. concepts/advisor-gate    — what the advisor gate is and how it releases the stop gate
3. concepts/completion      — what "genuinely complete" means in groundwork
4. flows/stop-gate-decision-path  — how the Stop hook actually decides (step-by-step)
5. components/stop-gate     — the stop-gate as a component (inputs, outputs, decision criteria)
6. recipes/release-stop-gate — how to get advisor APPROVE and release the gate
7. reference/verification-methods — verification methods reference table and stop-gate exit codes
```

## Concepts — explanations (Diátaxis: understanding)

| Note | What it explains |
|------|-----------------|
| [[concepts/stop-gate]] | What the Stop hook gate is, what it guarantees, and its design invariants |
| [[concepts/advisor-gate]] | What the advisor gate is, how APPROVE/CORRECTION/STOP verdicts work |
| [[concepts/completion]] | What real-world completeness means and why green tests are insufficient |

## Flows — decision paths and state machines

| Note | What it traces |
|------|---------------|
| [[flows/stop-gate-decision-path]] | Step-by-step: how the Stop hook checks slices, gate, and advisories |

## Components — design-system pages for concrete artefacts

| Note | What it describes |
|------|------------------|
| [[components/stop-gate]] | Anatomy of the Stop hook, inputs, outputs, exit codes, decision criteria |

## Recipes — how-to guides (Diátaxis: task)

| Note | Task |
|------|------|
| [[recipes/release-stop-gate]] | How to get advisor APPROVE and release the stop gate |

## Reference

| Note | Contents |
|------|----------|
| [[reference/verification-methods]] | Verification methods table and stop-gate exit codes |

## Requirements (out-of-folder, same concept)

| Id | Title |
|----|-------|
| [[../requirements/verification-r-001-stop-hook-blocks-session-end-while-slices-incomplete\|R-001]] | Stop hook blocks session end while slices are incomplete |
| [[../requirements/verification-r-002-orchestrator-invokes-advisor-to-validate-completion\|R-002]] | Orchestrator invokes advisor to validate completion |
| [[../requirements/verification-r-003-stop-hook-emits-advisory-for-decision-events-lacking-research\|R-003]] | Stop hook emits non-blocking advisory for DECISION events lacking research |
| [[../requirements/verification-r-004-stop-hook-emits-advisory-for-decision-events-empty-alternatives\|R-004]] | Stop hook emits non-blocking advisory for DECISION events with empty alternatives or unmarked id collisions |
