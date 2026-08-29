---
tags: [moc, orchestration, design]
---

# Orchestration Model — Design

Map of Content for the **Orchestration** design folder. Start here; follow the reading path below.

---

## Start here: reading path

```
1. concepts/delegation-hierarchy   — what the three dispatch levels are and why
2. concepts/stop-gate              — what the gate is and what it guarantees
3. flows/stop-gate-decision-path   — how the gate actually decides (step-by-step)
4. components/run-ledger-slice     — the primary data artefact (anatomy + specs)
5. recipes/add-slice-with-ac       — do something with a slice right now
6. recipes/release-stop-gate       — close out a run
7. reference/ledger-cli-reference  — look up any command while working
```

---

## Concepts — explanations (Diátaxis: understanding)

| Note | What it explains |
|------|-----------------|
| [[concepts/delegation-hierarchy]] | The three-level dispatch model: who spawns whom, the four leaf conditions, mechanical enforcement |
| [[concepts/stop-gate]] | What the stop-gate is, its four design guarantees, and when it fires |
| [[concepts/vertical-slice]] | What a vertical slice is, how it differs from a layer cut, how it maps to agents |

---

## Flows — decision paths and state machines

| Note | What it traces |
|------|---------------|
| [[flows/stop-gate-decision-path]] | Full flowchart + step table: every branch the gate can take on a Stop hook |
| [[flows/slice-lifecycle]] | State diagram + step table: the four statuses a slice moves through |

---

## Components — design-system pages for concrete artefacts

| Note | What it describes |
|------|------------------|
| [[components/run-ledger-slice]] | Anatomy, variants (kinds), states, field-level specs, usage, ![[assets/run-ledger-slice-anatomy.svg]] |
| [[components/gate-note]] | Anatomy of the `gate` object, variants (advisor verdicts), specs, usage |

---

## Recipes — how-to guides (Diátaxis: task)

| Note | Goal |
|------|------|
| [[recipes/add-slice-with-acceptance-criteria]] | Register a new slice, attach ACs, and link it to a ticket |
| [[recipes/release-stop-gate-after-advisor-approve]] | Walk out of an active run cleanly |

---

## Reference

| Note | What it covers |
|------|---------------|
| [[reference/ledger-cli-reference]] | Every ledger command → fields touched → hook that reads them |

---

## Requirements (out-of-folder, same concept)

| Id | Title |
|----|-------|
| [[../requirements/orchestration-r-001-orchestrator-delegates-non-trivial-implementation\|R-001]] | Orchestrator delegates non-trivial implementation |
| [[../requirements/orchestration-r-002-ledger-fog-slice-tracks-open-questions-without-blocking-frontier\|R-002]] | Fog slice tracks open questions without blocking frontier |
| [[../requirements/orchestration-r-003-authorship-duties-for-ticket-sections\|R-003]] | Authorship duties for ticket sections |
| [[../requirements/orchestration-r-004-every-decision-event-carries-a-structured-data-id\|R-004]] | Every DECISION event carries a structured data.id |
