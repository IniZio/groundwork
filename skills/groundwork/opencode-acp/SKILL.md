---
name: opencode-acp
description: Control another OpenCode instance via the Agent Client Protocol (ACP). Start an ACP server, send prompts (single-turn or multi-turn), capture responses. Use for testing workflows, delegating work to isolated agents, or running tasks in separate projects.
disable-model-invocation: true
---

# OpenCode ACP

Control another OpenCode instance via ACP (HTTP-based Agent Client Protocol). Supports single prompts and multi-turn conversations.

## Architecture

```
Your session (calling agent)
  ├── pty_spawn → ACP server (opencode acp --port 9090)
  └── bash → opencode run --attach http://localhost:9090 ...
```

The ACP server is a **headless OpenCode instance** — it loads plugins (including groundwork), has its own session context, and processes prompts autonomously. The calling agent sends prompts and reads responses.

## Lifecycle

### 1. Start Server

```
pty_spawn(command: "opencode", args: ["acp", "--port", "9090"], title: "ACP Server")
```

Wait for readiness. Check with:
```
bash(command: "sleep 3 && curl -sf http://localhost:9090/health || echo 'NOT READY'")
```

If not ready after 5 seconds, read PTY output for errors:
```
pty_read(id: "<pty-id>")
```

### 2. Send Prompts

```
bash(command: 'opencode run "Your prompt" --attach http://localhost:9090 --dir /path/to/project --format json', timeout: 120000)
```

### 3. Stop Server

```
pty_kill(id: "<pty-id>", cleanup: true)
```

## Single-Turn (Fire and Forget)

For autonomous tasks that need no follow-up:

```
bash(command: 'opencode run "Create a util function that validates emails" --attach http://localhost:9090 --dir /path/to/project', timeout: 120000)
```

**Use `--format json`** for structured output. The response is a stream of JSON events. Parse the last event for the final result.

**Timeout guidance:** Default `timeout: 120000` (2 min). For complex tasks (multi-file features, debugging): `timeout: 300000` (5 min). The `opencode run` command blocks until the agent completes or the timeout fires.

## Multi-Turn (Conversation)

For interactive workflows that need follow-up questions or multi-step reasoning:

### Session Management

```
# Turn 1: Start a new session (captures session ID from output)
bash(command: 'opencode run "What skills are available?" --attach http://localhost:9090 --dir /path/to/project --format json', timeout: 120000)
# → Response includes session ID

# Turn 2: Continue that session
bash(command: 'opencode run "Now implement the interview skill" --attach http://localhost:9090 --session <session-id> --dir /path/to/project --format json', timeout: 300000)

# Or continue the last session (no ID needed)
bash(command: 'opencode run "Fix the build errors" --attach http://localhost:9090 --continue --dir /path/to/project --format json', timeout: 120000)

# Fork a session (creates a copy, doesn't modify original)
bash(command: 'opencode run "Try a different approach" --attach http://localhost:9090 --session <id> --fork --dir /path/to/project --format json', timeout: 120000)
```

### Session ID Extraction

From JSON output, the session ID appears in the response metadata. Capture it for multi-turn:

```bash
# Extract session ID from the first turn
SESSION_ID=$(opencode run "..." --attach http://localhost:9090 --format json --dir /path | jq -r '.session_id // .sessionId // empty' | tail -1)
```

If session ID extraction fails from JSON, use `--continue` instead of `--session <id>` to continue the last session.

## Complete CLI Reference

### `opencode run` Options

| Flag | Purpose | Notes |
|------|---------|-------|
| `--attach <url>` | Target ACP server | Required for remote execution |
| `--dir <path>` | Working directory | **Always set this** — defaults to CWD |
| `-m provider/model` | Select model | e.g. `kimi-for-coding/k2p5` |
| `--format json` | JSON event stream | Easier to parse than formatted text |
| `--agent <name>` | Select agent | e.g. `general-purpose`, `advisor`, `explore` |
| `--session <id>` | Resume specific session | For multi-turn |
| `--continue` | Continue last session | Alternative to `--session` |
| `--fork` | Fork before continuing | Safe branching |
| `-f, --file <path>` | Attach file(s) | For context |
| `--title <text>` | Session title | For identification |
| `--variant <level>` | Reasoning effort | `high`, `max`, `minimal` |
| `--thinking` | Show thinking blocks | Debug visibility |
| `--pure` | No external plugins | Isolated execution |

### `opencode acp` Options

| Flag | Purpose | Default |
|------|---------|---------|
| `--port <n>` | Listen port | 0 (random) |
| `--hostname <host>` | Listen address | 127.0.0.1 |
| `--mdns` | Enable mDNS discovery | false |
| `--cors <domain>` | Allow CORS domains | [] |
| `--cwd <path>` | Working directory | CWD |
| `--pure` | No external plugins | false |

### Session Management

```
opencode session list               # List all sessions
opencode session delete <id>        # Delete a session
opencode export <id>                # Export session as JSON
```

## Patterns

### Pattern: Test a Skill Flow

Test that the agent follows a specific routing path:

```
# 1. Start ACP
pty_spawn(command: "opencode", args: ["acp", "--port", "9090"], title: "ACP Test")

# 2. Send a trivial task (should skip interview, implement directly)
bash(command: 'opencode run "Add a semicolon to line 5 of src/index.ts" --attach http://localhost:9090 --dir /path/to/project --format json', timeout: 120000)

# 3. Verify agent classified correctly (check output for skill invocations)

# 4. Send a small change (should trigger interview)
bash(command: 'opencode run "Add a search feature to the todo list" --attach http://localhost:9090 --dir /path/to/project --format json', timeout: 300000)

# 5. Cleanup
pty_kill(id: "<pty-id>", cleanup: true)
```

### Pattern: Delegate Work to Isolated Agent

Run a coding task in a separate project without polluting your session:

```
pty_spawn(command: "opencode", args: ["acp", "--port", "9090"], title: "ACP Worker")
bash(command: 'sleep 3 && opencode run "Refactor the auth module to use composition over inheritance" --attach http://localhost:9090 --dir /other/project --agent general-purpose --format json', timeout: 300000)
pty_kill(id: "<pty-id>", cleanup: true)
```

### Pattern: Multi-Turn with Agent Selection

```
# Turn 1: Explore codebase
bash(command: 'opencode run "Map out the authentication system" --attach http://localhost:9090 --agent explore --dir /path/to/project --format json', timeout: 120000)

# Turn 2: Continue with implementation
bash(command: 'opencode run "Based on your analysis, add OAuth2 support" --attach http://localhost:9090 --continue --dir /path/to/project --format json', timeout: 300000)
```

## Process Safety

**CRITICAL:** Never use `pkill opencode` or `killall opencode`. These kill ALL OpenCode instances, including your own session and any other user sessions.

**Safe cleanup:**
1. Use `pty_kill(id: "<pty-id>", cleanup: true)` to stop YOUR ACP server
2. If PTY is lost, find the specific process: `lsof -i :9090` then `kill <PID>`
3. Clean up orphaned servers: `opencode session list` → `opencode session delete <id>`

**Port conflicts:** If port 9090 is already in use:
```
bash(command: "lsof -i :9090 -t")  # Find PID using the port
# Kill only that specific PID, never pkill
```

## Timeout Strategy

`opencode run` blocks until the agent finishes. Complex tasks (especially with groundwork bootstrap + exploration) can take 2-5 minutes.

| Task type | Recommended timeout |
|-----------|-------------------|
| Trivial (typo, rename) | 60s |
| Small change | 120s |
| Feature with implementation | 300s |
| Debugging session | 180s |
| Multi-step with tests | 300s |

**If timeout fires:** The `bash` call returns with timeout error. The ACP server is still running — you can continue the session or kill it. Don't assume the agent failed; it may just be slow.

## What NOT to Do

- **NEVER** `pkill opencode`, `killall opencode`, or any broad process kill — kills other sessions
- **NEVER** forget `--dir` — without it, the agent runs in the wrong directory
- **NEVER** send prompts immediately after `pty_spawn` — wait 2-3 seconds minimum
- **NEVER** use old `process.write`/`process.poll` JSON-RPC — ACP is HTTP-based
- **NEVER** assume `opencode run` is fast — always set explicit timeouts
- **NEVER** ignore JSON parse errors — fall back to `--format default` if `json` fails

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `connection refused` | Server not ready | Wait longer, check `lsof -i :PORT` |
| Timeout | Agent is slow or stuck | Increase timeout, or continue session |
| Empty output | Agent returned nothing | Try `--format default` for raw output |
| Wrong directory | Missing `--dir` | Always specify `--dir` explicitly |
| Skills not loading | Plugin not installed in target | Use `--pure` to skip, or install plugin |
| Port in use | Another ACP server | `lsof -i :PORT` then kill specific PID |

## Minimal Example

```
# Start → Send → Stop
pty_spawn(command: "opencode", args: ["acp", "--port", "9090"], title: "ACP")
bash(command: "sleep 3")
bash(command: 'opencode run "Hello" --attach http://localhost:9090 --dir /tmp/test-project', timeout: 60000)
pty_kill(id: "<pty-id>", cleanup: true)
```
