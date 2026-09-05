# PAUSE Event Contract

A PAUSE event is the single durable continuation pointer for an in-flight motive. Write it with `journal append --type PAUSE`; see `journal help` for the full command signature and field schema.

## Fields

| Field | Type | Contents |
|---|---|---|
| `pointer` | string | Slice-id or phase name where you stopped |
| `summary` | string | 2–4 sentences: what is done, what is in flight, any active blockers |
| `next_actions` | array of objects | Ordered steps the next session takes |

Each `next_actions` entry: `{"action": "…", "slice": "<slice-id>", "note": "…"}` — `slice` and `note` are optional.

## What good next_actions look like

- **Concrete and ordered** — the first entry is exactly what the next session does first; subsequent entries are the natural chain.
- **Resumable cold** — phrase each step so an agent reading without the transcript can act on it; prefer "implement X in file Y" or "run tests for slice Z" over "continue working on X".
- **Slice-linked** — include `slice` when the action is ledger-tracked; `/continue` corroborates these against `ledger view`.
- **Avoid vague verbs** — "continue", "work on", and "finish" give the next session nothing to act on.
- **3–7 entries** — fewer risks omitting key steps; more adds noise.

## Writing a good --msg

One line, enough to identify the stop event without reading the data. Example: `"mid-wave pause after slice auth-01 complete, auth-02 in flight"`.

## How /continue reads it back

`journal compile <slug> --json` folds the latest PAUSE event's `next_actions` into `agent.resume.next_actions` and exposes `agent.last_pause` as `{pointer, summary, next_actions}`. `/continue` reads `agent.resume.next_actions` first; if absent (no PAUSE recorded), it falls back to open ledger slices.

Stale-pause failure mode: if the PAUSE pointer names a slice the ledger shows as `complete`, treat the ledger as authoritative — the prior session may have completed that slice after the PAUSE was written, or its changes may not have landed.
