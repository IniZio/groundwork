---
name: pause
description: Record a PAUSE event into the motive journal — pointer, summary, and ordered next actions — so /continue reconstructs state without the transcript.
disable-model-invocation: false
---

# Pause

## Trigger

Invoke when the user runs `/pause [<slug>]`, a session is wrapping up with open slices, or a context handoff is imminent.

Do not use when work is fully complete (run the advisor gate instead), or the goal is charter authoring (`motive` owns that).

## Locate the motive

With a `<slug>` argument, work from `.groundwork/motives/<slug>/`. Without one, scan for active motives:

- Exactly one with in-flight ledger slices → use it.
- None → tell the user; nothing to pause.
- Multiple → list slug + objective excerpt; ask which to pause.

## Update the ledger first

Failure mode: writing a PAUSE event before the ledger reflects reality means `/continue` reads stale slice state — it may re-execute work that is already done, or claim a slice already held by another session.

Run `ledger complete`, `ledger set`, or `ledger claim` as needed so slice statuses match actual progress. Do not write the PAUSE event until the ledger is current.

## Capture the pause point

Use `journal append --type PAUSE`. See `journal help` for the full command signature.

The PAUSE event must carry:

- **pointer** — the slice-id or phase name where you stopped.
- **summary** — 2–4 sentences: what is done, what is in flight, any active blockers.
- **next_actions** — an ordered list of concrete, resumable steps.

For what makes good `next_actions` entries and how `/continue` reads the event back, see [`reference/pause-event.md`](reference/pause-event.md).

Do not hand-edit journal shard files — always use `journal append`. Do not write a parallel prose handoff document — the PAUSE event is the handoff; a separate doc creates drift.

After appending, run `journal compile <slug> --stdout --json` to verify that `agent.last_pause` appears in the snapshot.

## What the ledger already handles

Ledger slice state (`complete`, `in_progress`, `blocked`, `claimed_by`) is durable across sessions without a PAUSE event. Do not duplicate ledger state into the `next_actions` list — reference slice ids instead. The PAUSE event captures the narrative and intent that the ledger cannot: why you stopped where you did, what mental state to restore, and what ordering or branching decisions are in play.

## Integration

`continue` is the read side: at session start, `journal compile <slug> --json` folds the latest PAUSE event's `next_actions` into `agent.resume.next_actions` and exposes `agent.last_pause` (`{pointer, summary, next_actions}`). `motive` owns the charter; `pause` never edits it. `pause` supersedes the removed `handoff` skill for in-motive continuation state.
