---
name: pause
description: Pause an active session — capture the continuation state (pointer, summary, next actions) into the motive spine as a PAUSE event so a later /resume picks up exactly where you left off. The write-side complement to resume.
disable-model-invocation: false
---

# Pause

## Purpose

Durably record where you stopped so the next session can pick up with zero reconstruction overhead. **Write a PAUSE event into the motive journal** — not a prose note, not a handoff file. The journal is the program counter; a PAUSE event advances it with a pointer, a state summary, and an ordered list of next actions that `resume` reads back automatically via `agent.last_pause` and `agent.resume.next_actions`.

## Entry conditions — when to use this skill

Use `pause` when:

- User invokes `/pause` or `/pause <slug>`
- Wrapping up a session with work still in progress (open slices, mid-wave)
- Before a context handoff or a long break where transcript context will be lost

Do **not** use `pause` when:

- The work is fully complete — close the motive or run the advisor gate instead.
- The goal is to **author or update a motive charter** — use `motive` instead (it owns charter workflow).
- The goal is to update ledger slice status — do that directly with `ledger`; pause captures narrative the ledger cannot.

## Locate the motive

1. If `<slug>` was provided: work from `.groundwork/motives/<slug>/`.
2. Else scan `.groundwork/motives/*/motive.md` for active work:
   - **Exactly one** motive with in-flight ledger slices → use it.
   - **None** found → tell the user; nothing to pause.
   - **Multiple** → list them (slug + objective excerpt) and ask which to pause.

```bash
ls .groundwork/motives/               # enumerate slugs
```

## Capture the pause point

Run a single `journal append` call. Construct each field from what you know right now — do not invent.

```bash
journal append \
  --motive <slug> \
  --type PAUSE \
  --msg "<one-line reason for stopping>" \
  --data '{
    "pointer": "<slice-id or phase name where you stopped>",
    "summary": "<2–4 sentence state recap: what is done, what is in flight, any active blockers>",
    "next_actions": [
      {"action": "<concrete resumable step>", "slice": "<slice-id if applicable>", "note": "<optional context>"},
      {"action": "<next step after that>"}
    ]
  }'
```

**Writing a good `--msg`:** one line, enough to identify the stop event without reading the data — e.g. `"mid-wave pause after slice auth-01 complete, auth-02 in flight"`.

**Writing good `next_actions`:**

- **Concrete and ordered** — the first entry should be exactly what the next session does first; subsequent entries are the natural chain.
- **Each action is resumable on its own** — phrase it so an agent reading it cold can act without needing the transcript.
- **Include slice ids** when the action is ledger-tracked; the `resume` skill corroborates these against `ledger view`.
- **Avoid vague verbs** like "continue" or "work on" — prefer "implement X in file Y", "run tests for slice Z", "claim slice W and fan out wave 2".
- **Three to seven actions** is the sweet spot; fewer may miss key steps, more adds noise.

## What the ledger already handles

Ledger slice state (`complete`, `in_progress`, `blocked`, `claimed_by`) is durable across sessions without a PAUSE event. Do **not** duplicate ledger state into the `next_actions` list — reference slice ids instead. The PAUSE event captures the **narrative and intent** that the ledger cannot: why you stopped where you did, what mental state to restore, and what ordering or branching decisions are in play.

## What NOT to do

- Do NOT hand-edit the journal shard files — always use `journal append`.
- Do NOT use PAUSE to author charter changes — that is `motive`'s job.
- Do NOT skip updating the ledger before pausing — `ledger complete`, `ledger set`, or `ledger claim` should reflect actual slice state; pause captures intent on top of that ground truth.
- Do NOT write a prose handoff document in addition to a PAUSE event — the event IS the handoff; a parallel doc creates drift.
- Do NOT invent `next_actions` that are not grounded in current slice state or open TBD/TBR items.

## Integration

- **`resume`** — the read side: at session start, `journal compile <slug> --json` folds the latest PAUSE event's `next_actions` into `agent.resume.next_actions` and exposes `agent.last_pause` (`{pointer, summary, next_actions}`). The program-counter section of `resume` reads these directly.
- **`motive`** — owns the charter; `pause` never edits it.
- **`ledger`** — the authoritative slice-status store; ensure it is current before appending a PAUSE event.
- **`journal compile`** — produces the compiled snapshot; run it after pausing to verify the event was recorded (`agent.last_pause` should be present).

`pause` supersedes the removed `handoff` skill for in-motive continuation state. For cross-motive or team-facing summaries, write prose separately — but that is not a groundwork skill concern.

## Minimal pause checklist

```
[ ] Resolved slug (arg | inferred from active ledger | user picked)
[ ] Ledger is current (complete/in_progress slices reflect reality)
[ ] Drafted pointer — slice-id or phase name where stopped
[ ] Drafted summary — 2–4 sentences: done, in-flight, blockers
[ ] Drafted next_actions — concrete, ordered, slice-id-linked where applicable
[ ] journal append --motive <slug> --type PAUSE --msg "…" --data '{…}'
[ ] Optionally: journal compile <slug> --stdout --json  (verify agent.last_pause appears)
```
