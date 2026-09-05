# Orchestrator Bootstrap

Read only by the orchestrator at session start. Enforcement rules here; verbose detail in `reference/`.

---

## Ledger Writing Obligations

The stop-gate hook reads the ledger but does not write it. The orchestrator writes:

1. **Emit the banner first** — `GROUNDWORK ▸ ultrawork: <N> slices across <M> waves → .groundwork/runs/<session_id>.json` (or `GROUNDWORK ▸ trivial: single general-purpose, no slicing` for trivial tasks).
2. **Mark each verified slice complete** as waves land — `gw ledger complete --motive <slug> <id> … --token <write_token>`.
3. **Record the advisor verdict** — `gw ledger gate --motive <slug> advisor APPROVE --token <write_token>` after the advisor gate approves.
4. **Abandon** — `gw ledger abandon --motive <slug>` sets `active:false`. Trivial tasks write no ledger.

---

## Fan-Out Rules

**All parallel task calls launch in ONE message. Never sequential across messages.**

**Do not call `question` while background tasks are running.** Doing so blocks completion notifications. End your turn — notifications re-invoke you automatically when each task finishes.

Full patterns and anti-patterns → `reference/fan-out-patterns.md`

---

## 1:1-Forwarding Failure Mode

The nesting-guard enforces spawn topology but cannot detect whether a junior-orchestrator forwarded its brief unchanged to a single child. When a junior's domain fits the leaf carve-out (single domain, ≤2 files, no internal sequencing, small verification surface), it implements directly. Otherwise it decomposes into multiple workers — not a 1:1 relay to a single general-purpose agent.

---

## What NOT to Do

- **Do not explore when you should delegate.** Read, glob, grep → `explore`'s job.
- **Do not do implementation work directly when a general-purpose fails.** Relaunch with a corrected prompt first.
- **Do not send task calls across multiple messages.** All parallel tasks launch in one message.
- **Worktrees** — subagents must not create them manually (`git worktree add`). The orchestrator uses `Task(..., isolation:"worktree")` as a conflict-fallback when two slices own the same file (see `vertical-slice` skill) — orchestrator-only, not the default.
- **Self-review failure mode:** Self-review passes its own work — it is not an evidence check. Escalate to the advisor instead; see advisor-gate §When to Escalate.

Task scoping rules, retry patterns, context isolation → `reference/task-scoping.md`

---

## Routing and Delegation

See CLAUDE.md §Issue-type routing and §Delegation matrix for classification, routing paths, agent models, and the delegation hierarchy. Always use the `groundwork:` prefix: `Task(subagent_type="groundwork:advisor", ...)`. Agent roster and model recommendations → `reference/agent-selection.md`.

Every routing path ends at the advisor gate. "Should work" is not evidence.
