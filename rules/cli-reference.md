## gw CLI reference

Agent-facing. Human overview: doc/cli.md.

### Reference

| Command | Flags | Effect |
|---|---|---|
| `gw init` | `--objective TEXT` | Creates the store and prints the token once. Safe to re-run; the token shows on the first run only. `--objective` records the objective for `gw compile`. Excludes the working-tier directory through git's local exclude file, never `.gitignore`. In a tree linked to a parent slice it creates a child store instead and prints no token. A direct-mode link creates no store. See [nested work scope](https://github.com/IniZio/groundwork/blob/cc3f4e32aff23bc44798cd668375e8c9ad8e29ec/doc/spec/nested-work-scope.md). |
| `gw token` | | Prints the write token again. Main session only; subagents are denied by the store-write-guard hook. Use on session resume. |
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
| `gw gate status` | `--json` | Prints `scope: <child\|root\|orphan>  gate: <verdict\|none>  slices: N complete, M open`, plus suffix `  H1: <state>  H2: <state>` when intent gates apply (states `approved`, `void`, `missing`; `void` = artifact edited after approval). `--json` adds `v`, `approved_at` (time of the newest verdict of any kind), for children `mode` and `parent`, and `intent` `{applies,slug,h1,h2}`. |
| `gw approve charter\|spec` | `--auto` `--token T` | Records a human approval of the charter (`doc/<slug>/motive.md` or `.groundwork/work/<slug>/motive.md`) or spec (`.../spec.md`) as an APPROVE_CHARTER / APPROVE_SPEC event holding a sha256 hash of the file(s). Prints `H1 charter approved: <hash>` / `H2 spec approved: <hash>`. Exit 0 ok; exit 1 if the artifact is missing or the subcommand is not charter\|spec (usage printed); exit 2 only with `spec --auto` when classification needs a human (a Human row): appends a HOLD event whose reason is `H2 needs human approval: <rows>`, prints `H2 awaiting human: <reason>`. `--auto` passes (prints `H2 auto-pass: <rows>`, records by=auto) only when the spec's frontmatter `change_kinds` has no Human row. A human `approve spec` (no --auto) also appends HOLD_CLEAR when the current hold starts with `H2 `. `--auto` applies to spec only. |
| `gw hold set` | `--reason "..."` | Pauses the run for a human. The reason shows in `gw slice status`. |
| `gw hold clear` | | Ends the hold. |
| `gw event append` | `--type TYPE` `--msg TEXT` `--data JSON` | Appends an event. Gate verdict types and scope event types are rejected; use `gw gate` and `gw scope`. TYPE list below. |
| `gw compile` | `--json` | Resume view. Read-only. Prints `H1 charter: <state>` and `H2 spec: <state>` lines (state `approved (human\|auto)`, `void`, `missing`) or `intent gates: n/a (no doc/<slug>/ human view)`. `--json` adds `intent`. |
| `gw archive <slug>` | | Moves a finished unit to the archive and marks its motive complete. |
| `gw migrate` | `--apply` | Moves older layouts into the current one. |
| `gw recipe` | | Prints the working-tier `artifact-structure` rule as JSON. |
| `gw --motive <slug> <command>` | | Global flag, parsed before the subcommand. |
| `gw motive add <slug>` | `--use` | Creates a motive. `--use` makes it active. |
| `gw motive use <slug>` | | Persists across sessions. |
| `gw motive list` | | Lists motives. The active one is marked `*`. |
| `gw motive complete <slug>` | | Marks the motive complete. The stop-gate stops checking it. |

Unknown-command usage list: `init, token, slice add|complete|claim|set-ac|status|rm, gate status [--json]|<verdicts>, scope link|unlink|verify, hold set|clear, approve charter|spec [--auto], event append, compile, motive add|use|list|complete, archive, migrate, recipe`.

### Intent gates

- Apply only when `doc/<slug>/motive.md` or `doc/<slug>/spec.md` exists.
- `--auto` classifies `.groundwork/work/<slug>/spec.md` by frontmatter `change_kinds` (known: bugfix, refactor, cli-flag, config-key, data-format, migration, dependency; src/cli/gate-status.ts CHANGE_KINDS, classifySpec).
- Human rows (no auto-pass): bugfix without `repro_test`; cli-flag or config-key; data-format or migration; dependency; `TBD` in an `## Acceptance criteria` checkbox; Unclassified (no `change_kinds`, or unknown kinds).
- Auto rows: bugfix with `repro_test`; refactor.
- approve-guard hook (src/hooks/approve-guard.ts): agents cannot record a human approval; ask the human to run `! gw approve charter|spec --token T`. `gw approve spec --auto` is allowed.
- Limitations of the approve guard: it matches command text, not behavior.
  - Strict allowlist (HAH-D13): allow only when `--auto` is the token right after the target, with no `$` (except a leading `$GW`/`"$GW"`/`${GW}` program word), redirect, `-c`/bundled `-…c`, `eval`, or a `#` before `--auto` anywhere in the command. The `$GW` exemption lapses when the command also has `GW=`, `export GW`, `alias`, or `function`. Denies `approve $K --auto`, `--token T --auto` ordering, and `gw approve` with no target or a flag next (xargs/stdin form). Other direct forms are not matched.
  - Threat model (HAH-D14): speed bump against casual self-approval, not a determined agent.
  - Out of scope (not caught): interpreter one-liners building argv (`bun -e`, `node -e`, `perl -e`, `python3 -c`), scripts, aliases, run-time strings, other indirect execution.
  - Real fix (out-of-band signature or external review): next-iteration work (HAH-D14).
  - Second line of defense: `gw approve` itself exits 1 on extra positionals, unknown flags, `--`, `--token <flag>`, and repeated `--auto`.
  - Remaining limit: strings an agent builds at run time outside the guarded command (a generated script file run later, an alias) can still record a human approval. Closing this needs a check agents cannot fake, such as a secret only the human shell holds; deferred to the next iteration.
  - It falsely denies read-only commands whose text contains the word approve followed by charter or spec (grep, echo, heredocs, commit messages).
  - H2 hash seam: the CLI hashes from the db's repo dir (src/cli/main.ts:53); the hook hashes from CLAUDE_PROJECT_DIR (src/hooks/spawn-model-guard.ts:183). A mismatch makes approvals read as void, so dispatch is refused (fails closed).

### Dispatch refusal

spawn-model-guard (src/hooks/spawn-model-guard.ts) denies spawning `groundwork:implementer`, `groundwork:junior-orchestrator`, `groundwork:designer` when the active motive has intent gates that apply and H1 or H2 is not `approved`. Message begins `intent gate: implementation dispatch refused — `. It names `$GW approve charter --token T` (human) for H1, and `$GW approve spec --auto --token T` or a human `$GW approve spec --token T` for H2.

### Token security (hook detail)

The write token and gate-seal key live in ~/.config/groundwork/repos/<hash>/ (outside the repo, mode 0600, not in work.db). The `store-write-guard` PreToolUse hook denies subagents (those with `agent_type` set) from using Read/Bash/Grep/Glob to access paths containing `.config/groundwork`, `groundwork/repos`, `write.token`, or `seal.key`, and from invoking `gw init` or `gw token`. The main thread (no `agent_type`) is unrestricted.

**Limitation:** a subagent that builds the config-dir path fully dynamically at runtime (e.g. a `bun -e` script computing `$HOME` and the repo hash) can bypass the string-match guard. The HMAC seal on gate verdicts is the primary protection: forging a GATE_APPROVE requires the seal key, which only the `gw gate approve` CLI command reads.

### gw token

Use this on session resume — the main session only; subagents are denied this command by the `store-write-guard` hook.

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
