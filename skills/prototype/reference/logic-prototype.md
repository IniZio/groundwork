# Logic Prototype — Process

When exploring state machines, algorithms, business rules, or data flow.

## Process

1. **State the question** — one paragraph about what you're trying to learn.
2. **Isolate logic** in a portable module behind a pure interface (reducer, state machine, pure function set). The TUI is throwaway; the logic module may survive.
3. **Build lightweight TUI** — clear screen each frame, current state pretty-printed, keyboard shortcuts listed. Read one keystroke, dispatch, re-render, loop.
4. **Walk through cases** — exercise the state model through normal paths, edge cases, and error states.
5. **Capture the answer** — document the finding. Delete the TUI; absorb the logic module if it is reusable, otherwise delete it too.

## Anti-patterns

- Tests, error handling, or generalization in the prototype
- Real database or external service connections
- Business rules blurred into the TUI loop (the logic module goes with the TUI when you delete it)
- Spending more than one hour — if the question takes longer, split it
