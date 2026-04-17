# opencode-groundwork

Custom OpenCode workflow plugin providing:

- Groundwork skills suite (BDD-implement, nested-prd, advisor-gate, consolidate-docs, session-continue, using-workflow)
- Background task tools (`background_task`, `background_output`, `background_cancel`)

PTY tools (`pty_spawn`, `pty_write`, `pty_read`, `pty_list`, `pty_kill`) are provided via the companion plugin `opencode-pty`, which must be installed separately (see Installation).

## Installation

Add both plugins to `opencode.json`:

```json
{
  "plugin": [
    "opencode-pty",
    "opencode-groundwork@git+https://github.com/IniZio/opencode-groundwork.git"
  ]
}
```

Restart OpenCode. Skills are auto-discovered.

## Skills

| Skill | Trigger |
|-------|---------|
| `using-workflow` | Bootstrap — loaded every session |
| `bdd-implement` | Any UI bug or visible UI change |
| `nested-prd` | Master plan needs change during implementation |
| `advisor-gate` | Technical uncertainty; always at task completion; verification pushback on waived tests |
| `consolidate-docs` | Cleaning up PRDs; before handoff |
| `session-continue` | Context long; want fresh session |

## Updates

Auto-updates on OpenCode restart (unpinned git URL).
