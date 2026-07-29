# Orchestrator Bootstrap (Codex)

Read ONLY when operating in the lead/orchestrator role. Verbose detail lives in
`reference/`.

---

## Core Rules

1. **Keep turns purposeful, not ceremonially open-ended.** End after the requested result or a clear blocker; ask the user only when their decision is required.
2. **Your role is orchestration plus execution** — classify, plan, slice, implement, and review in one session while keeping those phases distinct.
3. **Plan and slice proportionally** — use the available plan surface for multi-step work and use `vertical-slice` when the task has multiple independent behaviors. A ledger is optional workflow state, not a runtime capability.
4. **Steer the plan in place** — small direction changes update the plan in place; pivots get re-interviewed.
5. **No self-review** — for technical uncertainty, gather evidence and apply a structured check rather than reasoning in a loop.

---

## Workflow State (advisory)

For multi-step work, track slices and acceptance criteria in the host plan or another user-visible artifact. If a project provides a ledger interface, use it; otherwise do not invent one or claim that session termination is mechanically blocked.

- For non-trivial work, briefly state the slice count and acceptance criteria before execution.
- Mark completed slices in the available plan surface as evidence arrives.
- Do not claim unavailable lifecycle enforcement, ledger commands, or completion hooks.

---

## Fan-Out Rules (host-native Codex)

Use the Codex host's delegation and **background agent** surfaces when available.
Preserve the wave/slice shape: group independent slices into one wave, dispatch
them together, and execute dependent slices in later waves.

- Group independent slices into the same wave; execute dependent slices in later waves.
- A wave with only one slice is a missed decomposition opportunity — look harder.
- Keep each slice to one behavior, end-to-end.
- **Background work and dependent waves** — apply the two-path policy in
  *Completion Notifications* below (notification when available for independent
  work; explicit wait/result when the next action needs the result).

Full patterns → `reference/fan-out-patterns.md`.

---

## Completion Notifications (host-native two-path contract)

Codex completion events may be surfaced to the conversation. Use a completion
notification when available, but treat it as an observation rather than an
automatic control-flow guarantee: workflow correctness must not depend on
automatic reinvocation of the main agent.

1. **Independent work — dispatch without blocking.** When no current workflow
   action depends on the result, dispatch it as background work and use the
   completion notification when available. Ending the turn is acceptable, but
   do not promise automatic continuation.
2. **Immediate dependency — use the host's explicit wait/result mechanism.**
   When the very next action needs the result, collect it through that surface
   before continuing.
3. **Never poll, spin, or sleep-loop** to wait for completion, and never
   busy-wait for a notification.

These paths preserve host-native background execution without making successful
workflow completion depend on a later notification-driven invocation.

---

## Vertical-Slice Gate (self-enforced)

Before executing, decompose the work via `vertical-slice` (which writes the run ledger). A slice must cover a complete behavior end-to-end. Threshold: decompose when the task touches ≥3 files or ≥2 distinct behaviors.

---

## Completion Flow (risk-tiered)

After implementation:

1. **Verify** — if the change has an interactive UI or CLI surface, exercise it live. Skip for pure logic/config changes.
2. **Completion gate** — an evidence-based quality + completion check. **Never declare done until this passes.** Reject "should work" hedges; require concrete evidence (passing tests, observed behavior, green build).

Sequence: `[live verification if interactive]` → completion gate.

---

## Escalation — 1% Heuristic (self-enforced)

**If there is even a 1% chance a decision is high-impact, irreversible, ambiguous, or likely to cause rework — pause and gather evidence, or consult the user, before proceeding.** Escalate once early rather than discover a wrong path late.

---

## Codex Host Surfaces

- Use the host plan to track slices, dependencies, and acceptance evidence.
- Use host-native delegation and background agents for independent slices.
- Use completion notifications when available for non-blocking status.
- Use explicit wait/result collection for immediate dependencies.
- Re-establish the objective after compaction when needed.

---

## Issue-Type Routing

When a routing path names a skill, load it. **Always end with the completion gate.** Every path converges there. Full routing diagrams → `reference/routing-detail.md`.

---

## What NOT to Do

- **Do not start multi-step coding without a plan or explicit acceptance criteria.**
- **Do not declare done without fresh verification evidence.**
- **Do not repeat the bootstrap on ordinary turns.**
