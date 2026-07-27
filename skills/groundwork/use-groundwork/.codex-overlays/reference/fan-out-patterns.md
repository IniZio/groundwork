# Fan-Out Patterns Reference (Codex)

Use Codex's host-native delegation and **background agent** surfaces to preserve
the shape of fan-out: group independent slices into one wave, dispatch them
together, and keep dependent slices in a later wave.

Each slice should have one behavior, explicit file ownership, acceptance
criteria, and dependencies. Review all completed slices after the wave. Keep
ordinary-turn reminders to one or two lines; do not repeat the full bootstrap.

For long-running shell commands, prefer watch/follow modes or one streamed
process over repeated one-shot polling.

## Collecting results — the host-native two-path contract

Codex completion events may be surfaced to the conversation. Use a completion
notification when available, but workflow correctness must not depend on
automatic reinvocation of the main agent.

1. **Independent work — dispatch without blocking.** Use the completion
   notification when available. Ending the turn is acceptable when no current
   workflow action needs the result, but do not promise automatic continuation.
2. **Immediate dependency — use the host's explicit wait/result mechanism.**
   When the very next action needs the result, collect that result before
   continuing.
3. **Never poll, spin, or sleep-loop** to wait for completion.

"Prefer watch/follow over polling" governs streaming shell commands; it is a
separate concern from collecting a background agent's result through a
completion notification or the explicit wait/result surface.
