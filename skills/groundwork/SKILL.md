---
name: groundwork
description: Route to the right groundwork skill — on-ramps, the feature flow, and context-window boundaries.
---

# Groundwork Skill Router

`use-groundwork` is pre-loaded at session start and establishes core rules. Do not invoke it again unless context was lost to compaction. Read this file to find your on-ramp.

## On-ramps

| Signal | Skill |
|---|---|
| "build X", "add a feature", >1h, non-trivial | `feature-interview` |
| ambiguous small change, touches shared code, API, or auth | `quick-interview` |
| "capture scope", "what do I want to build", charter only | `requirements` |
| "doesn't work", "broken", stack trace, regression | `diagnose` |
| "how's the architecture", "any structural concerns" | `arch-review` |
| "deslop", "clean up the codebase", dead deps, lint debt, stale docs | `housekeep` |
| "spike", "try this out", throwaway exploration | `prototype` |
| "reflect on this session", session retrospective | `retrospective` |
| "continue from last session", "pick up where I left off" | `continue` / `pause` |
| "update spec", "write requirements", traceability | `spec` |
| "run eval", plugin eval suite | `eval` |
| "track this work", name a persistent work thread | `motive` |
| "ultrawork", "ulw", "max fan-out", ≥5 independent slices | `ultrawork` |

## The feature flow

`feature-interview` runs the `interview` primitive — the questioning logic — to capture feature intent, then dispatches to the `planner` agent (opus). The planner emits a motive charter with DECISION events, recording structure and test-strategy choices per `engineering-judgment`. Interview, charter, and plan run in one unbroken context window so the planner builds on the grilling.

`vertical-slice` turns the plan into a ledger: conflict-free parallel slices, one file owned per slice per wave.

`plan-review` audits coverage — maps charter acceptance criteria to ledger slices and flags gaps — before any implementation agent dispatches.

Implementers fan out: `junior-orchestrator` by default; `general-purpose` for leaf slices (single domain, ≤2 files, no internal sequencing, small verification surface). Each slice runs in its own fresh context window. Implementers model-invoke `engineering-judgment` to choose toolchain-enforced structure; gates model-invoke `prove-the-check-can-fail` to verify assertions bite before they are declared green.

`advisor-gate` closes every flow, issuing APPROVE / GAPS / CORRECTION / STOP / REPLAN before the session ends.

`quick-interview` and `requirements` also invoke the `interview` primitive. `quick-interview` limits to 3–4 questions and briefs `general-purpose` directly. `requirements` produces a charter only, with no implementation dispatch.

`implement` fans out agent waves and gates completion; use it after a plan is approved or after `quick-interview` for a small change.

## Context-window boundaries

**Interview → plan: one window.** Keep `feature-interview`, the charter, and the planner in one unbroken window so the grilling informs the plan. Compact only at a phase boundary if the window fills.

**Implementation: fresh window per slice.** Each implementer starts from a scoped brief, not the planning transcript. The ledger written by `vertical-slice` is the handoff artifact.

**Cross-session continuity.** `pause` writes a handoff at the end of a session; `continue` reads it at the start of the next, reconstructing context from the motive spine without relying on the transcript.

**Retrospective fork.** `retrospective` runs as a fork because it needs full session history — a sanctioned exception; all other execution uses named subagents.

**Planned: prewalk-style implement fork (D-16).** A deferred option — prewalk in the main window (opus), then a `general-purpose` fork (sonnet) inheriting the transcript — held back because the fork copies the full transcript and inherits the orchestrator identity.

## Authoring

Load `authoring-standard` before editing any SKILL.md under `skills/groundwork/`. It names eight failure modes and provides the per-skill audit-table format.
