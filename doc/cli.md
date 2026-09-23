# gw CLI reference

Binary: `gw` (`bun src/cli/main.ts`). DB path: `$GROUNDWORK_DB` or `<cwd>/.groundwork/work.db`.

All mutation commands require `--token <t>` matching the value printed by `gw init`.

## Commands

### `gw init [--objective TEXT]`
Creates the work store and prints the write token. Idempotent — safe to re-run.
If `--objective TEXT` is given, appends an `OBJECTIVE` event so the text appears in `gw compile`.

### `gw slice add <id> [--desc TEXT] [--wave N] [--covers-ac AC-1,AC-3] [--blocked-by a,b] [--acceptance "x;y"] --token T`
Adds a pending slice. `--wave` must be a numeric integer; a non-numeric value is a usage error (exit 1). `--covers-ac` is a comma-separated list of AC identifiers this slice satisfies.

### `gw slice claim <id> --by AGENT --token T`
Claims a slice for an agent: sets status to `in_progress` and records `claimed_by`. Refused (exit 1) if the slice is already claimed by any agent.

### `gw slice set-ac <id> --covers-ac AC-1,AC-3 --token T`
Sets (or replaces) the `covers_ac` field on an existing slice.

### `gw slice complete <id> --token T`
Marks a slice complete and records a `SLICE_COMPLETE` event. Works from `pending` or `in_progress`.

### `gw slice status`
Lists all slices with blocked-by, N/M complete count, gate state, hold state. Read-only.

### `gw slice rm <id> --token T`
Removes a slice. Writes a `RETENTION_ACTION` event first, then attempts DELETE.
Refused (exit 1) on completed/archived slices via the D-12 SQLite trigger.

### `gw gate approve --citation "file:line ..." --token T`
Records a `GATE_APPROVE` event. Citation must contain at least one `file:line` reference.
The stop-gate hook releases when this event exists.

### `gw hold set --reason "..." --token T`
Records a `HOLD` event. Hold reason appears in `gw slice status`.

### `gw hold clear --token T`
Records a `HOLD_CLEAR` event.

### `gw event append --type TYPE [--msg TEXT] [--data JSON] --token T`
Appends an event. `TYPE` must be one of the exported `EVENT_TYPES` list.

### `gw compile [--json]`
Resume view: objective, decisions, open slices, AC coverage, last PAUSE, gate state, hold state. Read-only.
AC coverage line: `ac coverage: N ACs covered by M slice(s)` followed by `AC-x: slice-id, ...` rows (sorted). If no slice has `covers_ac` set, prints `ac coverage: none`. The `--json` output includes an `ac_coverage` object mapping each AC id to the list of slice ids that cover it.

## v1 → v2 command mapping

| Raw mentions in transcripts | v1 command | v2 equivalent |
|----------------------------:|------------|---------------|
| 92 | `gw-hook ledger show --motive` | `gw compile` |
| 54 | `gw-hook ledger status --motive` | `gw slice status` |
| 50 | `bin/journal compile <motive>` | `gw compile` |
| 33 | `bin/journal append --motive` | `gw event append --type ...` |
| 24 | `gw-hook ledger add --motive` | `gw slice add` |
| 21 | `gw-hook journal append --motive` | `gw event append --type ...` |
| 20 | `gw-hook ledger complete --motive` | `gw slice complete` |
| 16 | `gw-hook ledger help init` | `gw init` |
| 10 | `gw-hook ledger view --motive` | `gw compile` |
| 10 | `gw-hook ledger gate --motive` | `gw gate approve --citation` |
| 8 | `gw-hook ledger gate --motive` (v2 run) | `gw gate approve --citation` |
| 6 | `gw-hook ledger checkpoint --motive` | `gw event append --type CHECKPOINT` |
| 5 | `bin/journal compile --json` | `gw compile --json` |
| 4 | `gw-hook ledger abandon --motive` | `gw slice rm` |

## Multi-motive design (T11)

**Structure.** A `motives` table holds slugs + status. Slices and events carry a `motive_id` column (DEFAULT `'default'`). The active motive pointer is stored in `meta['active_motive']`.

**Token.** One token per store. All motives in a store share the same write token.

**Stop-gate.** Evaluates every active motive that has at least one slice. Blocks if any motive has incomplete slices or no `GATE_APPROVE`. Block message names which motive has incomplete slices. `HOLD` is checked globally (any event in the store, not per-motive) because it is a session-level signal.

**Migration 5.** Adds `motives` table, inserts `'default'` row, adds `motive_id TEXT NOT NULL DEFAULT 'default'` to `slices` and `events`. Existing rows silently inherit `motive_id = 'default'`. Sets `meta['active_motive'] = 'default'`.

### `gw --motive <slug> <command>`
Global flag parsed before subcommand. Targets all reads and writes at `<slug>` instead of the active motive.

### `gw motive add <slug> [--use] --token T`
Creates a new motive. `--use` sets it as active.

### `gw motive use <slug> --token T`
Persistently sets the active motive (written to `meta['active_motive']`).

### `gw motive list`
Lists all motives; marks the active one with `*`.

### `gw motive complete <slug> --token T`
Marks the motive complete (excluded from future stop-gate evaluation).

## Event types

Exported as `EVENT_TYPES` from `src/store/store.ts`. Used by both `gw event append` and `gw compile`.

`GATE_APPROVE`, `HOLD`, `HOLD_CLEAR`, `DECISION`, `OBJECTIVE`, `PAUSE`, `VERIFICATION`, `FAILURE`,
`MILESTONE`, `HANDOFF`, `SESSION_START`, `CHECKPOINT`, `SLICE_COMPLETE`, `RETENTION_ACTION`

`DECISION` — records a decision; `msg` is the decision text. Shown in `gw compile` under `decisions (N)`.
`OBJECTIVE` — sets the motive objective; `msg` is the objective text. `gw compile` shows the newest.
