# Task Scoping Reference (Codex)

Use the Codex host's available delegation and background-agent surfaces. Treat
specialist names as roles and describe each slice with:

- one objective;
- bounded files or artifacts;
- relevant context and constraints;
- observable acceptance criteria;
- dependencies and the planned wave.

For multi-step work, keep independent slices separate in the host plan and
dispatch them through the host-native surface. Keep dependent slices in later
waves. Do not invent dispatch syntax that the active Codex host does not expose.

Keep planning prompts self-contained and concise. Do not include secrets,
unbounded file dumps, or assumptions about session history.

## Collecting a slice's result — the host-native two-path contract

Codex completion events may be surfaced to the conversation. Use a completion
notification when available, but workflow correctness must not depend on
automatic reinvocation of the main agent.

1. **Independent slices — dispatch without blocking.** Use the completion
   notification when available. Ending the turn is acceptable when no current
   workflow action needs the result, but do not promise automatic continuation.
2. **Immediate dependency — use the host's explicit wait/result mechanism.**
   When the very next action needs the result, collect it before continuing.
3. **Never poll, spin, sleep-loop, or busy-wait** for completion.

This keeps result collection host-native without treating notification delivery
as automatic control flow.
