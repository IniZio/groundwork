---
name: continue
description: Resume a motive's in-flight work — reconstruct goal, open slices, and next actions from the motive spine (charter + journal + ledger). If a prior /pause was recorded, agent.last_pause and agent.resume.next_actions are pre-populated — no transcript needed.
disable-model-invocation: true
---

# Continue

## Purpose

Continue a multi-session initiative from durable motive state. **Read the motive spine FIRST** — not the transcript, not a prior session's notes. The spine is the program counter: charter → compiled journal → run ledger.

## Entry conditions — when to use this skill

Use `continue` when:

- User invokes `/continue` or `/continue <slug>`
- Starting a session that should pick up an in-flight motive
- After context compression when a motive exists

Do **not** use `continue` when:

- The goal is to **author or update a motive charter** — use `motive` instead (it owns the charter workflow).
- The work is a one-off task that never had a motive (no `.groundwork/motives/<slug>/` dir).

## Locate the motive

1. If `<slug>` was provided: work from `.groundwork/motives/<slug>/`.
2. Else scan `.groundwork/motives/*/motive.md` for active work:
   - **Exactly one** motive with in-flight ledger slices → use it.
   - **None** found → tell the user; offer to create one via `motive`.
   - **Multiple** → list them (slug + objective excerpt) and ask which to continue.

```bash
ls .groundwork/motives/               # enumerate slugs
```

## Reconstruct working state (always, in this order)

Run these two commands up front; every state item below derives from their output.

```bash
journal compile <slug> --stdout --json   # motive spine snapshot
ledger view                              # run ledger (slice status, wave order, claimed_by)
```

Both commands are runnable without a build step (`journal` and `ledger` are in `hooks/`).

---

### 1. Objective (was: "Goal")

**Source:** `agent.objective` from `journal compile --json`; also readable as the `## Objective` line in `.groundwork/motives/<slug>/motive.md`.

State the objective in one short paragraph. This replaces reading `spec.md` via `spec_ref`.

---

### 2. AC met / unmet (was: "`ac_coverage` × `runs[*].slices_completed`")

**Source:** `agent.ac_coverage` from `journal compile --json`.

The compiled JSON carries an `ac_coverage` map built from `AC_COVERAGE` events (added in motive-compile/1.2.0). Each key is an AC identifier; the value lists the slice ids that cover it.

Cross-reference with `ledger view` slice statuses:

- **MET** — all covering slices for that AC are `complete` in the ledger.
- **UNMET** — covering slices missing, or at least one is not yet `complete`.
- **NO COVERAGE DECLARED** — AC key absent from `agent.ac_coverage`; flag explicitly.

List each AC with met/unmet and covering slice ids. Never invent completion.

---

### 3. Negative scope rails (was: "`spec.md` `## Negative scope`")

**Source:** The `## Negative scope` section (or equivalent) in `.groundwork/motives/<slug>/motive.md`.

If the charter has no negative-scope section, state that explicitly — do not silently omit.

---

### 4. Program counter (was: "`resume.pointer|slice_id|next_actions|blocked_reason|waiting_on`")

**Source (primary):** `agent.resume.next_actions` from `journal compile --json` — the compiled list of next steps derived from the journal event stream. If a prior `/pause` was recorded, the compiler folds its `next_actions` payload here automatically; `agent.last_pause` (`{pointer, summary, next_actions}`) carries the full pause snapshot.

**Source (secondary / corroborating):** `ledger view` — shows which slices are `in_progress`, `blocked`, or `complete`, and which session holds each `claimed_by` lock.

If `agent.resume` is absent or empty in the compiled JSON (no PAUSE event recorded), fall back to the open ledger slices as the program counter.

---

### 5. Open slices in wave order (was: "from `plan.md` / `tasks.md` with `blocked_by`")

**Source:** `ledger view` (wave-grouped Markdown table) or `ledger status` (compact one-liner per slice).

```bash
ledger status            # compact view
ledger view              # full wave/status table with blocked_by and claimed_by
```

Highlight any slice that is `blocked` or `in_progress`. The `claimed_by` column surfaces concurrent sessions holding a slice.

---

### 6. Active slice context (was: "`plan_ref`, `branch`, files for current slice")

**Source:** `ledger show <id>` for the slice currently in progress or pointed to by the program counter.

```bash
ledger show <slice-id>   # all fields: description, acceptance, blocked_by, claimed_by, status
```

---

### 7. Last session link (was: "last `runs[]` row")

**Source:** The most recent entries in `agent.decision_log` from `journal compile --json`. Timestamps (`ts`) identify when decisions were recorded; `claimed_by` in the ledger identifies the last session to hold a slice.

Ephemeral run-ledger files may be pruned after 7 days. If a run ledger path no longer exists on disk, **do not fail** — the motive journal and the current ledger are sufficient to reconstruct state.

---

### 8. Recent memory (was: "last ~5 `history` + `decisions`")

**Source:** The last ~5 entries in `agent.decision_log` from `journal compile --json` (summaries: id, title, rationale).

Also run with `--tbd` to surface open TBD/TBR items from the charter:

```bash
journal compile <slug> --stdout --tbd    # prints open-items count
```

---

### 9. Concurrent sessions (new — no prior equivalent)

**Source:** `claimed_by` column in `ledger view`. If any slice is claimed by a session other than the current one, surface this before continuing. Do not silently overwrite a concurrent claim.

---

Present this reconstruction briefly to the user before acting.

## Then act

Branch on motive state:

| Condition | Action |
|-----------|--------|
| All ACs met and no open slices | Report done. Offer to close/archive the motive or confirm with `advisor`. |
| Any slice `blocked` | Surface **blocked** state + reason from `ledger show <id>`; do not silently continue impl. Ask user how to unblock or whether to REPLAN. |
| Open TBD/TBR items | Surface the open-items register (`journal compile --tbd`); resolve before proceeding if they block the work. |
| Open slices, no blockers | **Claim and continue**: `ledger claim <slice-id>`, restore goal rails, fan out work for the pointed slice and unblocked same-wave peers. |
| `agent.decision_log` shows a REPLAN decision | Surface **REPLAN** — re-enter `interview` (objective wrong) or `vertical-slice` (decomposition wrong). Do not resume impl waves. |
| Concurrent `claimed_by` detected | Surface the conflict; ask user whether to wait, take over, or split work. |

## Integration

- **`motive`** — owns charter authoring and event appending; `continue` reads what `motive` writes.
- **`pause`** — the write-side complement to `continue`. Records a PAUSE event with `{pointer, summary, next_actions}` into the motive journal; the compiler surfaces it as `agent.last_pause` and folds `next_actions` into `agent.resume.next_actions` for the next session. Use `/pause` at end-of-session; use `/continue` at start-of-session.
- **`vertical-slice` / implement** — continue or open slices; seed acceptance criteria from the charter's AC list; append `AC_COVERAGE` events when a slice completes an AC.
- **`journal compile`** — the single authoritative source for objective, ac_coverage, decision log, next_actions, and last_pause. Re-run it at the start of each session to get a fresh snapshot.
- **`ledger`** — session-scoped run state: slice status, claimed_by, blocked_by, wave order.

## Minimal continue checklist

```
[ ] Resolved slug (arg | inferred from active ledger | user picked)
[ ] journal compile <slug> --stdout --json  (motive spine snapshot)
[ ] ledger view  (slice status, wave order, claimed_by)
[ ] Objective stated (from agent.objective)
[ ] AC met/unmet from agent.ac_coverage × ledger slice statuses
[ ] Negative scope noted (or explicitly absent from charter)
[ ] Program counter (agent.resume.next_actions + open/blocked ledger slices)
[ ] Open slices in wave order (ledger view); blocked_by highlighted
[ ] Active slice detail (ledger show <id>)
[ ] Last session link (decision_log timestamps + claimed_by)
[ ] Recent memory (last ~5 decision_log entries; open TBD/TBR via --tbd)
[ ] Concurrent-session check (claimed_by column)
[ ] Act: claim slice + continue | surface blocked/REPLAN | report done
```

## What NOT to Do

- Do NOT resume by grepping the transcript — the motive spine is the program counter.
- Do NOT open impl waves when all ACs are met or a REPLAN decision is in the log.
- Do NOT ignore `blocked` slices or open TBD/TBR items.
- Do NOT claim a slice already held by another session without surfacing the conflict.
- Do NOT invent AC completion — only mark met via `agent.ac_coverage` × completed slice ids.
- Do NOT fail when ephemeral run-ledger files have been pruned; the motive journal is the durable record.
- Do NOT use `continue` to author charter updates — that is `motive`'s job.
- Do NOT use `continue` to write continuation state — use `pause` instead (it appends the PAUSE event).
- Do NOT hand-edit the Decision Log — it is generated by `journal compile`.
