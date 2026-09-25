# groundwork

A Claude Code plugin that adapts to each repo's own conventions, tracks agent work to completion, and enforces best-practice direction in new code only.

## Language

### Work tracking

**Work store**:
The single per-repo record of slices, events, decisions and motives for a run of agent work.
_Avoid_: Ledger, journal, database

**Slice**:
One conflict-free unit of work with acceptance criteria and a fenced set of files, completed by one agent.
_Avoid_: Task, ticket, step

**Acceptance criterion**:
A checkable statement a slice must satisfy before it can be marked complete.
_Avoid_: Requirement, AC list item

**Motive**:
A persistent unit of intent that outlives a session and groups the slices and decisions serving it.
_Avoid_: Plan, epic, project

**Charter**:
A motive's written objective, decisions and open questions.
_Avoid_: Motive doc, plan

**Event**:
An append-only fact recorded in the work store.
_Avoid_: Log entry, journal line

**Decision**:
An event that records a settled choice, its rationale and the alternatives rejected.
_Avoid_: ADR

**Write token**:
The secret that authorises changes to the work store; only the main session holds it.
_Avoid_: Key, password

### Completion

**Stop-gate**:
The check that refuses to end a session while any slice is open or the newest verdict is not an APPROVE that still holds for the current work; a human hold lets the session end.
_Avoid_: Gate (unqualified)

**Advisor gate**:
The evidence-graded review that issues a verdict before work may be called done.
_Avoid_: Gate (unqualified), sign-off

**Verdict**:
The advisor gate's outcome: APPROVE, CORRECTION, STOP, GAPS or REPLAN.
_Avoid_: Result, status

**New-code-gate**:
The check that blocks rule violations introduced by the current change, leaving existing code alone.
_Avoid_: Gate (unqualified), linter

### Conventions

**Convention**:
A repo-owned practice (commit message shape, PR template, Makefile rule, handbook) that groundwork detects, confirms with the user, then writes back into the repo's own files.
_Avoid_: Setting, config

**Unknown**:
An open question recorded for later resolution, so that "known" is built from explicit answers rather than guesses.
_Avoid_: TODO, gap

### Agents

**Orchestrator**:
The agent that classifies requests, delegates and reviews, and never implements.
_Avoid_: Main agent, manager

**Implementer**:
A leaf agent that edits code for one slice.
_Avoid_: Worker, coder

**Fan-out**:
Launching every independent agent for a wave in a single turn.
_Avoid_: Parallel dispatch, spawning

### house-rules

**Rule**:
A named, testable constraint that house-rules checks on edits and at stop.
_Avoid_: Lint, policy

**Baseline**:
The recorded set of violations that existed before a rule was adopted, tolerated until burned down.
_Avoid_: Allowlist, ignore list

**Stray artifact**:
A file written where it does not belong, such as a root scratch file or a synonym directory beside its sibling.
_Avoid_: Junk file, leftover
