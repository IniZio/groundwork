---
name: continue
description: Resume an in-flight motive from the motive spine — charter, compiled journal, and run ledger — without relying on the transcript.
disable-model-invocation: false
---

# Continue

## Trigger

Invoke when the user runs `/continue [<slug>]`, a session starts that should pick up a motive, or context compacts mid-motive.

Do not use to author charter updates (`motive` owns those), or when there is no motive directory for the work.

## Locate the motive

With a `<slug>` argument, work from `.groundwork/motives/<slug>/`. Without one, scan for active motives:

- Exactly one with in-flight ledger slices → use it.
- None → tell the user; offer to start one with `motive`.
- Multiple → list slug + objective excerpt; ask which to continue.

## Reconstruct state

Run these two commands first; derive every item below from their output rather than reading the transcript:

```bash
journal compile <slug> --stdout --json   # motive spine snapshot
ledger view                              # slice status, wave order, claimed_by
```

**Objective** — `agent.objective` from the compiled JSON; also the `## Objective` line in `motive.md`.

**AC coverage** — `agent.ac_coverage` cross-referenced against `ledger view` slice statuses:
- MET — all covering slices for that AC are `complete` in the ledger.
- UNMET — at least one covering slice is not yet `complete`.
- NO COVERAGE DECLARED — AC key absent from `agent.ac_coverage`; flag explicitly. Never invent completion.

**Negative scope** — the `## Negative scope` section in `motive.md`. If the charter has no negative-scope section, state that explicitly.

**Program counter** — `agent.resume.next_actions` (populated automatically from the latest PAUSE event, if one was recorded); `agent.last_pause` carries the full `{pointer, summary, next_actions}` snapshot. Corroborate against `ledger view` slice statuses. If `agent.resume` is absent or empty in the compiled JSON (no PAUSE event recorded), fall back to the open ledger slices as the program counter.

Stale-pause failure mode: when the PAUSE pointer names a slice the ledger shows as `complete`, treat the ledger as authoritative — the prior session may have finished that work after pausing.

**Concurrent sessions** — if `claimed_by` in `ledger view` names a session other than the current one, surface it before claiming any slice.

Run-ledger files may be pruned after 7 days; if a path no longer exists on disk, the motive journal and the current ledger are sufficient to reconstruct state.

Present the reconstruction briefly to the user before acting.

## Then act

| Motive state | Action |
|---|---|
| All ACs met, no open slices | Report done; offer to archive or run the advisor gate. |
| Any slice `blocked` | Surface the block and reason from `ledger show <id>`; ask user to unblock or REPLAN. |
| Open TBD/TBR items blocking work | Surface the open-items register (`journal compile --tbd`); resolve before proceeding. |
| Open slices, no blockers | Claim the pointed slice (`ledger claim <id>`); fan out unblocked same-wave peers. |
| REPLAN decision in log | Re-enter `feature-interview` (objective wrong) or `vertical-slice` (decomposition wrong). Do not resume impl waves. |
| Concurrent `claimed_by` detected | Ask user whether to wait, take over, or split work. |

## Integration

`pause` writes PAUSE events; this skill reads them. `journal compile` is the single authoritative source for objective, ac_coverage, decision log, next_actions, and last_pause. `ledger` holds session-scoped slice state. `motive` owns the charter.
