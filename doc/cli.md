# gw CLI reference

Binary: `gw` (`bun src/cli/main.ts`). DB path: `$GROUNDWORK_DB` or `<cwd>/.groundwork/work.db`.

All mutation commands require `--token <t>` matching the value printed by `gw init`.

## Commands

### `gw init`
Creates the work store and prints the write token. Idempotent — safe to re-run.

### `gw slice add <id> [--desc TEXT] [--wave N] [--blocked-by a,b] [--acceptance "x;y"] --token T`
Adds a pending slice.

### `gw slice complete <id> --token T`
Marks a slice complete and records a `SLICE_COMPLETE` event.

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
Resume view: objective, decisions, open slices, last PAUSE, gate state, hold state. Read-only.

### `gw import-v1 --ledger PATH --journal PATH-OR-DIR --motive SLUG --token T`
Imports v1 slices and journal events. Prints `N slices, M events`.

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

## Event types

Exported as `EVENT_TYPES` from `src/store/store.ts`. Used by both `gw event append` and `gw compile`.

`GATE_APPROVE`, `HOLD`, `HOLD_CLEAR`, `DECISION`, `PAUSE`, `VERIFICATION`, `FAILURE`,
`MILESTONE`, `HANDOFF`, `SESSION_START`, `CHECKPOINT`, `SLICE_COMPLETE`, `RETENTION_ACTION`
