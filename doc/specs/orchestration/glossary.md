---
tags: [glossary, orchestration]
---

# Orchestration Model — Glossary

Terms used across the orchestration concept. Definitions are normative within this concept folder.

---

## Acceptance criteria (AC)

Observable outcome strings attached to a ledger slice via `--acceptance`. Each criterion describes a state a reviewer can confirm without reading implementation code. Criteria are stored as `string[]`; multiple criteria are semicolon-separated on the CLI.

## Active run

A run ledger with `active: true`. The stop-gate only blocks sessions for active runs. A run becomes inactive via `ledger abandon` (`active: false`).

## Advisor

The `groundwork:advisor` agent. The only entity whose APPROVE verdict can satisfy the stop-gate. The advisor operates on real evidence — test output, transcript inspection, source review. A filtered or fabricated evidence set voids the verdict.

## APPROVE

The only stop-gate-releasing advisor verdict. Written to the ledger by the orchestrator via `gw ledger gate --motive <slug> advisor APPROVE --token <write_token>`. Other verdicts (`CORRECTION`, `STOP`, `GAPS`, `REPLAN`) keep the gate blocking.

## Blocked-by

A slice field (`blocked_by: string[]`) listing slice ids that must reach `complete` before this slice can be claimed. Referential integrity is not schema-enforced — the orchestrator is responsible for correctness.

## Context window

The finite token budget available to an orchestrator agent. Execution work (Edit, Write, Bash, Read) fills the window faster than delegation summaries. Delegating to subagents preserves orchestrator context for classification, coordination, and quality gating.

## Depth

The nesting level in the delegation hierarchy. Depth 0 is the primary orchestrator. Depth 1 is a `junior-orchestrator` or `general-purpose` leaf spawned directly by the orchestrator. Depth 2 is a `general-purpose` worker spawned by a `junior-orchestrator`.

## Fan-out

The act of dispatching multiple subagents in parallel to cover independent slices within a wave. Fan-out is the primary lever for reducing wall-clock time on multi-slice runs.

## Fog slice

A ledger slice with `kind: "fog"`. Represents an open question that cannot yet be scoped as actionable work. Excluded from `gw ledger frontier --motive <slug>` output. Must not carry acceptance criteria.

## Frontier

The set of slices that are `pending` and not blocked. Returned by `gw ledger frontier --motive <slug>`. Fog slices and complete/skipped slices are excluded. The frontier is what the orchestrator fans out in the next wave.

## Gate note

The `gate` object in the run ledger. Stores named reviewer verdicts (`advisor`, `verifier`, `qa`). See [[design/components/gate-note]].

## General-purpose

The `groundwork:general-purpose` agent. A leaf implementer — implements its own slice and does not spawn children other than read-only specialists. Used at depth 1 only when all four leaf-carve-out conditions hold.

## Junior-orchestrator

The `groundwork:junior-orchestrator` agent. A sub-domain orchestrator at depth 1. Owns one domain end-to-end, decomposes it into leaf slices, and fans out `general-purpose` workers. MUST NOT forward its task 1:1 to a single child.

## Leaf-carve-out conditions

Four conditions that must ALL hold for a slice to be dispatched to `general-purpose` instead of `junior-orchestrator`: (1) single domain, no sub-domains; (2) ≤ 2 files touched; (3) no internal sequencing; (4) small verification surface (≤ 5 QA scenarios, single platform, no real hardware).

## Ledger

The run ledger file (`.groundwork/runs/<session_id>.json`). Tracks all slices, their statuses, the gate object, pacing state, and the write token. Managed exclusively via the `gw ledger` CLI — never edited by hand.

## Nesting guard

`hooks/nesting-guard.mjs`. A `PreToolUse` hook that enforces the delegation topology mechanically. Blocks `junior → junior` and `general-purpose → general-purpose` spawns at the hook layer.

## Orchestrator

The primary orchestrator agent (`groundwork:orchestrator`, model: opus). Classifies tasks, decomposes them, fans out subagents, and operates the completion gate. MUST NOT implement code or edit files directly.

## Pacing

A ledger-level constraint (`pacing.policy`, `pacing.budget`) that limits how many implementation waves can be claimed per session. Default: `policy=wave`, `budget=1`. Exempt kinds (`plan`, `diagnose`, `design`, `fog`) do not consume the budget.

## Read-only specialists

Agents that do not spawn other agents and carry no nesting risk: `explore`, `advisor`, `designer`, `test-engineer`, `qa`. May be spawned at any delegation depth.

## Reinforcement counter

An integer stored in the ledger (`reinforcements`). Incremented each time the stop-gate blocks without observable progress. Resets when a slice changes status or a gate verdict flips. When the counter reaches the cap (12), the gate releases to prevent a permanently stuck session (BOUNDED guarantee).

## Run

One session's unit of tracked work. Identified by `session_id`. A run has slices, a gate, pacing state, and an `active` flag. The stop-gate only acts on the run whose `session_id` matches the current session.

## Seal

A cryptographic integrity marker (`gate.seal`) written by the ledger CLI on terminal mutations. The stop-gate verifies the seal on completion and abandon paths. A manually edited ledger fails the seal check.

## Session end

The `SESSION_END` journal event emitted when the stop-gate allows a stop on a completed, approved run. Signals that the session closed cleanly.

## Slice

A unit of work registered in the run ledger. Has an `id`, `kind`, `status`, optional `acceptance` criteria, optional `ticket` link, and optional `blocked_by` dependencies. See [[design/components/run-ledger-slice]].

## Stop-gate

`hooks/stop-gate.mjs`. A `Stop` hook that fires every time a session tries to end. Reads the run ledger and blocks the stop if slices are incomplete or the advisor has not approved. See [[design/concepts/stop-gate]].

## Ticket

A durable work object stored at `.groundwork/motives/<slug>/tickets/<id>.md`. Linked from a slice via the `ticket` field (bare id, no path, no `.md` suffix). Tickets survive regeneration cycles; they are never auto-deleted.

## Vertical slice

A unit of work that cuts through the full stack of a single domain and delivers one observable user-facing behaviour. Contrasted with a layer cut ("all the models"). See [[design/concepts/vertical-slice]].

## Wave

A parallelisable set of slices — those not blocked by any incomplete dependency. The orchestrator fans out one wave per session under the default pacing policy.

## Write token

A cryptographic secret (`write_token`) minted at `ledger init` and re-surfaced in the SessionStart injection. Required to write terminal slice statuses and the gate verdict. Orchestrator-only — MUST NOT be passed to subagents.
