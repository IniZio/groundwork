# Nested work scope

## Purpose

Work sometimes runs in a second checkout of the repository: an isolated worktree or sandbox where an agent carries out one slice of a motive. Without a link, running `gw init` there creates an orphan store that the host never hears about, and the host could complete the slice with no evidence from the work done on it.

Nested work scope links such a child scope to the host slice that dispatched it. The host cannot complete the slice until the child's evidence is in. A child scope also counts as ledgered work for the stop-gate.

Groundwork is the only tool involved. A plain git worktree, a sandbox, or anything else that can reach the host `.groundwork` directory works the same way.

## Modes

A link has one of two modes.

**delegate.** The child scope does the slice and runs its own gate. Before the host can complete the slice, the child must have recorded an approved gate and the host must have received it. If the child has not, `gw slice complete` refuses and lists what the child has recorded so far.

**direct.** The agent works in the child tree but the host verifies the result itself. Before the host can complete the slice, the host must record its own verification with a citation. The child's events are not needed and do not count.

In both modes the refusal is enforced in code. There is no flag to skip it.

## The pointer file

A linked tree holds a pointer at `.groundwork/parent`, relative to the tree root. The file is gitignored. Only the host `gw` writes it, when the host creates the link before dispatch. A child never writes or edits its own pointer.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| v | number | yes | Schema version. Currently 1. |
| motive | string | yes | The host motive the slice belongs to. |
| slice | string | yes | The host slice this tree works on. |
| link_id | string | yes | Identifier of the link, recorded by the host when it created the link. |
| mode | string | yes | Either `delegate` or `direct`. |
| root | string | yes | Path of the host repository directory, the one that holds `.groundwork`. |
| worktree | string | no | Path of this tree as the host sees it. |
| created | string | yes | Timestamp of link creation. |

Example:

```json
{
  "v": 1,
  "motive": "checkout-rework",
  "slice": "CR-04",
  "link_id": "7f3c9a1e",
  "mode": "delegate",
  "root": "/home/dev/shop",
  "worktree": "/home/dev/shop-wt/cr-04",
  "created": "2026-10-03T09:15:00Z"
}
```

Paths are compared by their resolved real location, so a path that reaches the same directory through an alias or symlink still matches.

## Versioning

The `v` field names the schema version. This `gw` reads version 1. A pointer with a higher version is a hard error: `gw` stops and tells you the version is unsupported, and does not guess at fields it does not know. A missing or non-numeric version is also an error. An absent file means the tree is not linked; a file that is present but invalid is never treated as absent.

## Trust model

The host does not trust a pointer file or a child's own claims by themselves.

- The host records each link as an event with its own link id. Only evidence that carries a link id the host recorded is considered.
- When a child reports an approved gate, the host checks that the cited commit exists in the repository before accepting it.
- A child's events never satisfy the host's own gate. The child's approval is evidence the host weighs when completing the slice. It does not stand in for the host gate.

## Transport

A child reports to the host through inbox files, never by writing to the host's database. The child drops a small file into the host's inbox directory, and the host `gw` reads and records it. This works everywhere, including where the host directory is mounted at a different path.

A shared SQLite database is not used. Concurrent writers from two trees are not proven safe, and the same directory can appear under different paths on each side, which breaks locking and identity checks.

## Notifications

When a child writes an inbox event, `gw` also emits a best-effort CloudEvents 1.0 notification to the local system log. The notification is sent only after the inbox file is in place. It never changes the exit code, never prints, and is not retried. The whole attempt is bounded to one second.

Fields:

| Field | Value |
| --- | --- |
| CE_SPECVERSION | `1.0` |
| CE_ID | The inbox `event_id`. |
| CE_SOURCE | `groundwork://` followed by the absolute repository root of the writer. |
| CE_TYPE | `groundwork.child_register` or `groundwork.child_gate`. |
| CE_SUBJECT | `link:` followed by the link id. |
| CE_TIME | Time of the write, ISO 8601 in UTC. |
| CE_DATACONTENTTYPE | `application/json` |
| MESSAGE | Exactly the inbox file JSON. |

Transport, first match wins:

1. If `/run/systemd/journal/socket` exists, the fields are sent to journald in its native format, one `KEY=VALUE` line each. The inbox JSON is a single line.
2. Otherwise, if `/dev/log` exists, one RFC 5424 message is sent with structured data `[ce@32473 specversion=".." id=".." source=".." type=".." subject=".." time=".."]` and the JSON as the message text. Values in the structured data escape `"`, `\` and `]` with a backslash.
3. Otherwise nothing is sent.

Set `GROUNDWORK_NOTIFY=off` to disable notifications, for example in test suites.

## Abandoned children

A child can disappear: the sandbox is destroyed, the agent stalls, or the tree is deleted. The host slice then stays blocked by a link that will never report.

To recover, do one of two things from the host:

- Re-link: create a fresh link for the same slice in a new tree. The newest live link decides whether the slice is satisfied, so the new child takes over. If that newer link is later unlinked, the previous live link counts again.
- Unlink: remove the link and give a reason. The reason is recorded so the history shows why the slice was freed.

## Commands

All host-side commands need the host write token (`--token`). Run them from the host repository.

### `gw scope link <dir> --slice S [--mode direct|delegate] --token T`

Links the tree at `<dir>` to slice `S`. The mode defaults to `delegate`. The host records the link with a new link id and writes the pointer file into `<dir>`. On success it prints:

```
linked <link_id>: slice <S> -> <absolute dir> (<mode>)
```

Failures, each printed as `gw: <message>` with exit code 1:

- `mode must be one of direct|delegate, got '<mode>'`
- `child dir does not exist: <dir>`
- `child dir is the parent repo; cannot link a tree to itself`

### `gw scope unlink --slice S --reason "..." --token T`

Removes the live link on slice `S` and records the reason. The slice is no longer held by that link. Prints `unlinked <link_id>: slice <S>`.

Failures:

- `unlink requires a non-empty reason`
- `no live link for slice '<S>'`

### `gw scope verify --slice S --citation file:line --token T`

Records the host's own verification of a direct-mode slice. The citation must be `path:line` or `path:line-line`. Only a verification recorded after the live link counts. Prints `verified slice <S>`.

Failures:

- `citation must look like path:line, got '<citation>'`
- `no live link for slice '<S>'`
- `slice '<S>' link is delegate; verify applies to direct links only`

### `gw init` in a linked tree

Run in a tree that holds a pointer, `gw init` does not create an orphan store.

- Delegate mode, first run: it registers the child with the host, creates a child store for the host motive, and prints `initialized child store: <path>` and `linked to slice <S> (delegate)`.
- Delegate mode, repeat run: it prints `already initialized: <path>` and the same `linked to slice` line.
- Direct mode: it creates no store and prints ``no child store: direct-mode link (slice <S>); verify from the parent with `gw scope verify` ``.

Failures leave no child store behind:

- `parent root not reachable: <root>`
- `parent has no work store: <root>/.groundwork/work.db`
- `pointer worktree not reachable: <path>`

### `gw gate <verdict>` in a linked tree

In a delegate child, a gate verdict is recorded in the child store as usual and then forwarded to the host through the inbox. On success it also prints `forwarded to parent: <id>`. If forwarding fails, the verdict stays recorded in the child store, the command exits with code 1, and prints:

```
gw: verdict forward failed: <reason>
(local GATE_<VERDICT> remains recorded)
```

The reason is one of the parent-unreachable messages above, `citation required`, or `base_commit required`. A forwarded verdict needs a git commit to bind to, so run the gate inside a git checkout.

Every verdict is forwarded, not only approvals. The host uses the newest one: a later `correction`, `stop`, `gaps`, or `replan` supersedes an earlier approval, and the host treats the slice as not approved until the child approves again.

### `gw slice complete <id> --token T`

On the host, before completing, `gw` reads any waiting child inbox files and then checks the live link on the slice. A slice with no link, or only unlinked links, completes as before. Otherwise a refusal prints `error: cannot complete slice '<id>': <reason>`, then one indented line per link showing its mode, the verdicts it has received, and any unlink reason, and exits with code 1. The reason is one of:

- Delegate, nothing received: `newest child link <link_id> has no APPROVE`
- Delegate, newest verdict is not an approval: `latest child verdict is <VERDICT>, not APPROVE`
- Delegate, approved commit missing from the host repository: `base_commit <sha> not found in <repo>`
- Direct, no verification: `direct mode: no host verification recorded after link <link_id>; run gw scope verify`

No flag disables this check. To free a slice whose child will never report, unlink it.

### `gw gate status [--json]`

Read-only. Reports what scope the current directory is in and where its gate stands. Plain output is one line:

```
scope: <scope>  gate: <gate>  slices: <N> complete, <M> open
```

With `--json` it prints an object with these fields:

| Field | Type | Present | Meaning |
| --- | --- | --- | --- |
| v | number | always | Schema version, currently 1. |
| scope | string | always | `child` if the tree holds a pointer, `root` if it is the main checkout, otherwise `orphan`. |
| mode | string | child only | `delegate` or `direct`, from the pointer. |
| parent | object | child only | `motive`, `slice`, `link_id`, and `root` from the pointer. |
| slices | object | always | `open` and `complete` counts. Archived slices count as complete. |
| gate | string | always | Newest gate verdict of any kind, such as `APPROVE` or `CORRECTION`; `none` if there is none or no store. |
| approved_at | string | when a verdict exists | Time of the newest gate verdict of any kind. Despite the name, it is not limited to approvals. |

### Events that cannot be appended by hand

`gw event append` refuses the link, register, gate-forward, verify, unlink, and parent-record event types. Only the commands above write them. The refusal reads:

```
error: <TYPE> is a scope event and cannot be appended directly — use `$GW scope` commands
```

## Stop-gate

A tree with a store counts as ledgered work for the stop-gate, so a child scope that did work is checked like any other. A direct-mode tree has no store of its own and does not need one: the stop-gate does not require a work store in that tree, because the host governs it.
