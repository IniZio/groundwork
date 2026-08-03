# Fixtures: UserPromptSubmit payloads

Realistic Claude Code `UserPromptSubmit` hook payloads for testing the keyword-router
spurious-injection bug (S5). Created by S1.

## Payload schema

Claude Code sends the hook as JSON on stdin:

```json
{
  "hook_event_name": "UserPromptSubmit",
  "role": "user",
  "prompt": "<the full turn text>"
}
```

Key fact from the plan (S5): **`hook_event_name` cannot discriminate** — `UserPromptSubmit`
fires for _both_ genuine user turns and background-injected turns (task notifications,
local-command stdout, compaction summaries). The `role` field is always `"user"` for all
of them. Discrimination must happen on `prompt` content only.

## Categories

| Directory | Description | Expected router behaviour |
|---|---|---|
| `genuine/` | Real user messages — bug reports, feature requests, questions | MUST route (produce `hookSpecificOutput`) |
| `notification/` | Background task-notification turns — contain `[SYSTEM NOTIFICATION - NOT USER INPUT]` or `<task-notification>` | MUST NOT route even when body contains "fail", "error", "broke", "PR" |
| `local-command/` | Local command stdout turns — wrapped in `<local-command-stdout>` | MUST NOT route |
| `compaction/` | Context-window compaction/summary turns — wrapped in `<context_window_compaction>` | MUST NOT route |

## File count

- `genuine/`: 6 fixtures
- `notification/`: 4 fixtures
- `local-command/`: 3 fixtures
- `compaction/`: 2 fixtures

Total: 15 fixtures

## Usage (S5)

```ts
import bugReport from '../fixtures/user-prompt-submit/genuine/bug-report-broken.json'
import taskNotif from '../fixtures/user-prompt-submit/notification/task-notification-with-failure.json'

// Genuine prompt must produce hookSpecificOutput
// Notification must produce { continue: true } with no hookSpecificOutput
```
