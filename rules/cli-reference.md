## gw CLI reference

Agent-facing. Human overview: doc/cli.md.

### Reference

| Command | Flags | Effect |
|---|---|---|
| `gw init` | `--objective TEXT` | Creates the store and the gate-seal key. Safe to re-run. `--objective` records the objective for `gw compile`. Excludes the working-tier directory through git's local exclude file, never `.gitignore`. In a tree linked to a parent slice it creates a child store instead. A direct-mode link creates no store. See [nested work scope](https://github.com/IniZio/groundwork/blob/cc3f4e32aff23bc44798cd668375e8c9ad8e29ec/doc/spec/nested-work-scope.md). |
| `gw token` | | Prints a notice that tokens are no longer used. `gw` mutations need no token flag. |
| `gw slice add <id>` | `--desc TEXT` `--wave N` `--covers-ac AC-1,AC-3` `--blocked-by a,b` `--acceptance "x;y"` | Adds a pending slice. `--wave` must be an integer, else exit 1. |
| `gw slice claim <id>` | `--by AGENT` | Sets `in_progress` and records the claimer. Exit 1 if already claimed. |
| `gw slice set-ac <id>` | `--covers-ac AC-1,AC-3` | Sets or replaces the slice's covered acceptance criteria. |
| `gw slice complete <id>` | | Completes from `pending` or `in_progress`. Refused (exit 1) while a child-scope link is live, until the child's approved gate arrives (delegate) or `gw scope verify` ran (direct). No flag skips this. Unlink an abandoned child to free the slice. |
| `gw slice status` | | Lists slices with blockers, N/M complete, gate state, hold state. |
| `gw slice rm <id>` | | Removes a slice. Refused (exit 1) on completed or archived slices. Writes a RETENTION_ACTION event first, then attempts DELETE. Refusal on completed/archived slices comes from the D-12 SQLite trigger. |
| `gw scope link <dir>` | `--slice S` `--mode direct\|delegate` | Links the tree at `<dir>` to slice S (default `delegate`). Prints `linked <link_id>: slice S -> <dir> (<mode>)`. |
| `gw scope unlink` | `--slice S` `--reason "..."` | Removes the live link. Reason is required and recorded. |
| `gw scope verify` | `--slice S` `--citation file:line` | Records the host's own check of a direct-mode slice. Refused for delegate links. |
| `gw gate <verdict>` | `--citation "file:line ..."` | Records a verdict: `approve`, `correction`, `stop`, `gaps`, or `replan`. Citation needs at least one `file:line`. `approve` records base_commit (git HEAD) and an HMAC seal. In a linked child, the verdict is also forwarded to the parent inbox with base_commit and prints `forwarded to parent: <id>`; if forwarding fails it stays local and exits 1. A delegate-mode child cannot `gate approve` while the tree has uncommitted changes outside `.groundwork/`: exit 1, `cannot approve a linked child with uncommitted work` (src/cli/scope.ts assertCommittedForApprove). Direct-mode links are not checked. |
| `gw gate status` | `--json` | Prints `scope: <child\|root\|orphan>  gate: <verdict\|none>  slices: N complete, M open`. `--json` adds `v`, `approved_at` (time of the newest verdict of any kind), and for children `mode` and `parent`. |
| `gw hold set` | `--reason "..."` | Pauses the run for a human. The reason shows in `gw slice status`. |
| `gw hold clear` | | Ends the hold. |
| `gw event append` | `--type TYPE` `--msg TEXT` `--data JSON` | Appends an event. Gate verdict types and scope event types are rejected; use `gw gate` and `gw scope`. TYPE list below. |
| `gw compile` | `--json` | Resume view. Read-only. |
| `gw archive <slug>` | | Moves a finished unit to the archive and marks its motive complete. |
| `gw migrate` | `--apply` | Moves older layouts into the current one. |
| `gw migrate issues` | `--apply` `--root DIR` | Converts legacy ticket files under `<root>/.groundwork/work/*/tickets/` to the `issue` doc type (root defaults to the repo). Dry run by default: prints `would convert <file>: <notes>` / `would normalise ...`, skips and warnings, then `summary: N converted, M normalised, K skipped, W warnings (dry run, nothing written)`. `--apply` first writes a tar backup under `.groundwork/backup/` (prints `backup: <path>`), then rewrites the files; no backup when nothing converts. Exit 0; exit 1 if `--root` is missing or not a directory (usage printed) or the backup fails. |
| `gw recipe` | `--merge` | Prints the working-tier `artifact-structure` rule (with `$schema`) as JSON; `--merge` prints the repo's `.house-rules.json` with only that rule replaced. Never writes files. |
| `gw --motive <slug> <command>` | | Global flag, parsed before the subcommand. |
| `gw motive add <slug>` | `--use` | Creates a motive. `--use` makes it active. |
| `gw motive use <slug>` | | Persists across sessions. |
| `gw motive list` | | Lists motives. The active one is marked `*`. |
| `gw motive complete <slug>` | | Marks the motive complete. The stop-gate stops checking it. |

Unknown-command usage list: `init, token, slice add|complete|claim|set-ac|status|rm, gate status [--json]|<verdicts>, scope link|unlink|verify, hold set|clear, event append, compile, motive add|use|list|complete, archive, migrate [issues], recipe [--merge]`.

### spawn-model-guard

spawn-model-guard (src/hooks/spawn-model-guard.ts) is a PreToolUse hook on `Agent`/`Task`. It denies a spawn outside the caller's depth allowlist, denies the bare built-ins `explore` and `general-purpose`, redirects a `groundwork:implementer` brief for a slice with 3 or more files to `groundwork:junior-orchestrator`, and injects the registry model when the spawn sets none.

### Seal key

The gate-seal key lives in `~/.config/groundwork/repos/<store_id>/seal.key` (`$XDG_CONFIG_HOME` when set), outside the repo, mode 0600, not in work.db (src/store/key-store.ts). `gw init` creates it. `gw gate approve` signs the verdict with an HMAC seal from this key; the stop gate fails closed without a valid seal. A subagent without the key cannot forge an approval.

### gw recipe (footer)

When a stop-time manifest finding is blocked, the gate footer tells the agent to move the file to the path named, fix its frontmatter or headings, or record decisions with `$GW event append --type DECISION`.

### Multi-motive internals

A `motives` table holds slugs + status. Slices and events carry a `motive_id` column (DEFAULT 'default'). The active motive pointer is stored in meta['active_motive'].
Migration 5 adds the `motives` table, inserts the 'default' row, adds `motive_id TEXT NOT NULL DEFAULT 'default'` to `slices` and `events`. Existing rows silently inherit 'default'. Sets meta['active_motive'] = 'default'.
Stop-gate block message names which motive has incomplete slices. HOLD is checked globally (any event in the store, not per-motive) because it is a session-level signal.

### gw slice rm

Writes a RETENTION_ACTION event first, then attempts DELETE. Refused on completed/archived slices via the D-12 SQLite trigger.

### gw event append

TYPE must be one of the exported EVENT_TYPES list (src/store/store.ts), used by both `gw event append` and `gw compile`:
GATE_APPROVE, GATE_CORRECTION, GATE_STOP, GATE_GAPS, GATE_REPLAN, HOLD, HOLD_CLEAR, DECISION, OBJECTIVE, PAUSE, VERIFICATION, FAILURE, MILESTONE, HANDOFF, SESSION_START, CHECKPOINT, SLICE_COMPLETE, RETENTION_ACTION
DECISION — msg is the decision text. Shown in `gw compile` under `decisions (N)`.
OBJECTIVE — msg is the objective text. `gw compile` shows the newest.
Scope rejection text: error: <TYPE> is a scope event and cannot be appended directly — use `$GW scope` commands

### Commit-message lint guard (Family 6)

The `commit-message-guard` PreToolUse hook intercepts `git commit` calls and lints the message before the commit runs. The style comes from `.house-rules.json`; run `house-rules config` to see the active preset.
Detectable forms (all linted): bare `git commit`, `command git commit`, `builtin git commit`, env-prefixed `FOO=1 git commit`, `git -C <path> commit`, `git -c key=val commit`, `git --git-dir=<dir> commit`, and any of these appearing after `&&`, `||`, `;`, or `|`.
Not detectable: shell function aliases such as `g(){ command git "$@"; }; g commit`. The git-level `commit-msg` hook installed by `session-commit-msg-installer` is the backstop.
core.hooksPath: if set and the target directory exists, the session installer skips silently. If the target directory does not exist, the installer emits a one-line warning naming the path and the fix (`git config --unset core.hooksPath`) and does not install. The installer never modifies git config.
