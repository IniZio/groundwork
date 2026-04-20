# Installing groundwork

Add both plugins to `opencode.json` plugin array:

```json
{
  "plugin": [
    "opencode-pty",
    "groundwork@git+https://github.com/IniZio/groundwork.git"
  ]
}
```

Restart OpenCode. That's it.

> **Note:** `opencode-pty` provides PTY tools (`pty_spawn`, `pty_write`, `pty_read`, `pty_list`, `pty_kill`) used for long-running and interactive commands. It cannot be bundled into opencode-groundwork due to its native Bun dependency (`bun-pty`).

## Verify

Ask: "What groundwork skills do you have?"
The agent should describe the available skills and PTY tools should be listed.

## Updating

Updates automatically on restart (unpinned git URL).
To pin: `groundwork@git+https://github.com/IniZio/groundwork.git#v1.0.0`
